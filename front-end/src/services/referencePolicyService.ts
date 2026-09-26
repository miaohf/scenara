import type {
  Shot,
  ShotReferencePolicyItem,
  ShotReferencePolicyLevel,
} from '../types';
import type { ReferenceImageEntry } from './referenceImagePack';

export interface ResolvedReferencePolicy {
  entries: ReferenceImageEntry[];
  decisions: ShotReferencePolicyItem[];
  textOnlyEntries: ReferenceImageEntry[];
  omittedEntries: ReferenceImageEntry[];
}

const normalize = (value?: string): string => String(value || '').trim().toLocaleLowerCase();

const entryKey = (entry: Pick<ReferenceImageEntry, 'type' | 'assetId' | 'label'>): string =>
  `${entry.type}:${entry.assetId || normalize(entry.label)}`;

const policyRank: Record<ShotReferencePolicyLevel, number> = {
  required: 4,
  supportive: 3,
  textOnly: 2,
  omitted: 1,
};

const baseScore = (entry: ReferenceImageEntry, index: number): number => {
  if (entry.type === 'character') return index === 0 ? 100 : 90;
  if (entry.type === 'scene') return 88;
  if (entry.type === 'storyboard') return 86;
  if (entry.type === 'turnaround') return 82;
  return 55;
};

/**
 * Apply a semantic reference budget before model slot packing. The policy is
 * deterministic so prompt text, uploaded images, and editor inspection always
 * agree even when an Agent response omits referencePolicy.
 */
export const resolveShotReferencePolicy = (
  shot: Shot,
  inputEntries: ReferenceImageEntry[],
  maxVisualReferences = 9,
): ResolvedReferencePolicy => {
  const explicit = new Map(
    (shot.agent?.executionPlan.referencePolicy || []).map((item) => [
      `${item.assetType}:${item.assetId || normalize(item.label)}`,
      item,
    ]),
  );
  const actionText = normalize([
    shot.actionSummary,
    shot.agent?.executionPlan.coreBeat,
    shot.agent?.executionPlan.propBlocking,
    ...(shot.agent?.executionPlan.actionPhases || []).map((phase) => phase.action),
  ].filter(Boolean).join(' '));

  const evaluated = inputEntries.map((entry, index) => {
    const matching = explicit.get(entryKey(entry));
    const mentioned = normalize(entry.label) && actionText.includes(normalize(entry.label));
    const usage = entry.assetId ? shot.propUsages?.[entry.assetId] : undefined;
    const activeProp = entry.type === 'prop' && (
      // shot.props is the structured visibility declaration. Do not downgrade a
      // listed prop merely because the natural-language actionSummary omitted it.
      (entry.assetId ? (shot.props || []).some((propId) => String(propId) === String(entry.assetId)) : false)
      || mentioned
      || !!usage?.action
      || ['handheld', 'used', 'placed', 'mounted'].includes(String(usage?.mode || ''))
    );
    let policy: ShotReferencePolicyLevel = matching?.policy
      || (entry.type === 'character' && index === 0 ? 'required'
        : entry.type === 'scene' ? 'required'
          : activeProp ? 'required'
            : entry.type === 'character' || entry.type === 'storyboard' ? 'supportive'
              : 'textOnly');
    if (matching?.lockedByUser && policy === 'omitted') policy = 'required';
    const score = baseScore(entry, index)
      + (mentioned ? 24 : 0)
      + (activeProp ? 18 : 0)
      + (matching?.lockedByUser ? 100 : 0)
      + policyRank[policy] * 10;
    const reason = matching?.reason || (
      policy === 'required'
        ? mentioned || activeProp
          ? 'Visible identity or action-critical asset in this shot.'
          : 'Primary character/environment anchor.'
        : policy === 'supportive'
          ? 'Supports continuity but is not the dominant visual beat.'
          : 'Kept as text because a dedicated image would compete for model attention.'
    );
    return {
      inputIndex: index,
      entry: { ...entry, policy, policyReason: reason, priorityScore: score },
      decision: {
        assetType: entry.type === 'turnaround' ? 'character' as const : entry.type,
        assetId: entry.assetId,
        label: entry.label,
        policy,
        reason,
        visiblePhaseIndexes: matching?.visiblePhaseIndexes,
        lockedByUser: matching?.lockedByUser,
      },
      score,
    };
  }).sort((left, right) => right.score - left.score);

  let visualCount = 0;
  evaluated.forEach((item) => {
    if (item.decision.policy === 'required' || item.decision.policy === 'supportive') {
      if (visualCount < maxVisualReferences || item.decision.lockedByUser) {
        visualCount += 1;
      } else {
        item.decision.policy = 'textOnly';
        item.decision.reason = 'Downgraded to text to stay within the semantic reference budget.';
        item.entry.policy = 'textOnly';
        item.entry.policyReason = item.decision.reason;
      }
    }
  });

  return {
    entries: evaluated
      .filter((item) => item.decision.policy === 'required' || item.decision.policy === 'supportive')
      // Ranking decides what fits the semantic budget. It must not overwrite the
      // caller's workflow order (for example, a Qwen/keyframe scene canvas at Image 1).
      .sort((left, right) => left.inputIndex - right.inputIndex)
      .map((item) => item.entry),
    decisions: evaluated.map((item) => item.decision),
    textOnlyEntries: evaluated.filter((item) => item.decision.policy === 'textOnly').map((item) => item.entry),
    omittedEntries: evaluated.filter((item) => item.decision.policy === 'omitted').map((item) => item.entry),
  };
};
