import assert from 'node:assert/strict';

import { buildContinuityLedger } from '../src/services/continuityLedgerService.ts';
import { resolveShotReferencePolicy } from '../src/services/referencePolicyService.ts';
import { routeScreenwritingModules } from '../src/services/ai/screenwritingModuleRouter.ts';
import { applyIncomingSeriesContinuity, buildIncomingSeriesContinuity, updateOutgoingSeriesContinuity } from '../src/services/seriesContinuityService.ts';

const baseAgent = {
  directorPurpose: 'advance',
  emotionalBeat: 'alert',
  visualHook: 'petal',
  timeline: [],
  executionPlan: {
    coreBeat: '渔人拿起竹篙撑船',
    actionPhases: [{ startSeconds: 0, endSeconds: 5, action: '渔人拿起竹篙撑船', camera: 'tracking', sound: 'water' }],
    subjectBlocking: '渔人在船尾',
    propBlocking: '竹篙在手中',
    cameraPlan: 'tracking',
    endState: '木舟向右前方行进',
    soundPlan: ['water'],
  },
  continuity: { entryState: 'start', exitState: 'end', screenDirection: 'left to right', mustPreserve: [] },
  audioIntent: 'ambience',
  h3FeasibilityNotes: 'one action',
};

const shot = {
  id: 'shot-1',
  sceneId: 'scene-1',
  actionSummary: '渔人拿起竹篙撑船',
  cameraMovement: 'left to right tracking',
  characters: ['char-1'],
  props: ['prop-pole', 'prop-basket'],
  propUsages: { 'prop-pole': { mode: 'handheld', actorId: 'char-1', action: '撑船' } },
  keyframes: [],
  agent: baseAgent,
};

const policy = resolveShotReferencePolicy(shot, [
  { image: 'char.png', type: 'character', label: '渔人', assetId: 'char-1' },
  { image: 'scene.png', type: 'scene', label: '溪流', assetId: 'scene-1' },
  { image: 'pole.png', type: 'prop', label: '竹篙', assetId: 'prop-pole' },
  { image: 'basket.png', type: 'prop', label: '鱼篓', assetId: 'prop-basket' },
]);
assert.equal(policy.entries.length, 3);
assert.equal(policy.decisions.find((item) => item.assetId === 'prop-pole')?.policy, 'required');
assert.equal(policy.decisions.find((item) => item.assetId === 'prop-basket')?.policy, 'textOnly');

const scriptData = {
  title: 'test', genre: 'drama', logline: 'test', characters: [
    { id: 'char-1', name: '渔人', gender: '男', age: '成年', personality: '谨慎', wardrobe: '蓑衣', variations: [] },
    { id: 'char-2', name: '老人', gender: '男', age: '老年', personality: '平静', wardrobe: '布衣', variations: [] },
  ],
  scenes: [{ id: 'scene-1', location: '溪流', time: '清晨', atmosphere: '晨雾冷光' }],
  props: [{ id: 'prop-pole', name: '竹篙', category: '工具', description: '竹制', presentationMode: 'handheld' }],
  storyParagraphs: [],
};
const secondShot = {
  ...shot,
  id: 'shot-2',
  actionSummary: '老人站在船尾',
  cameraMovement: 'right to left tracking',
  characters: ['char-2'],
  propUsages: { 'prop-pole': { mode: 'handheld', actorId: 'char-2' } },
  agent: {
    ...baseAgent,
    continuity: { ...baseAgent.continuity, screenDirection: 'right to left' },
  },
};
const ledger = buildContinuityLedger([shot, secondShot], scriptData);
assert.equal(ledger.length, 2);
assert.ok(ledger[1].issues.some((issue) => issue.includes('持有人')));
assert.ok(ledger[1].issues.some((issue) => issue.includes('屏幕运动方向')));

const modules = routeScreenwritingModules({
  script: '第1集，角色通过一段对白建立伏笔。',
  targetDuration: '60秒',
});
const moduleIds = modules.map((item) => item.id);
assert.ok(moduleIds.includes('dialogue'));
assert.ok(moduleIds.includes('shortform-pacing'));
assert.ok(moduleIds.includes('series-structure'));

const priorEpisode = {
  id: 'episode-1',
  episodeNumber: 1,
  scriptData: { ...scriptData, continuityLedger: ledger, seriesContinuity: { openThreads: [{ id: 'thread-1', label: '桃花线索', status: 'open' }], updatedAt: 1 } },
  shots: [shot, secondShot],
};
const incoming = buildIncomingSeriesContinuity({ id: 'episode-2', episodeNumber: 2 }, [priorEpisode]);
assert.equal(incoming?.sourceEpisodeId, 'episode-1');
assert.equal(incoming?.openThreads[0]?.label, '桃花线索');
const withIncoming = applyIncomingSeriesContinuity({ ...scriptData, continuityLedger: ledger }, incoming);
const withOutgoing = updateOutgoingSeriesContinuity(withIncoming);
assert.equal(withOutgoing.seriesContinuity?.outgoingState?.scene.sceneId, 'scene-1');

console.log('Production intelligence checks passed.');
