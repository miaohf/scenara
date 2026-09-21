import assert from 'node:assert/strict';

import { validateAndRepairH3Prompt } from '../src/services/ai/h3PromptValidator.ts';

const ref2vaPrompt = `subject_definitions:
<Subject 1> is the fisherman from <Picture 1>, preserving identity and costume.

summary:
[reference generation] The target video is a 5-second, 16:9 continuous shot.

retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - identity remains stable.

detailed_description:
The target video uses a cinematic look. Total duration is exactly 5 seconds.
[Shot 1] <Subject 1> stands in a boat.
Action timeline:
[0.0–2.0s]
Action: "The fisherman notices one petal and pauses."
Camera: "A stable tracking shot."
SFX: "Water and net sounds; no music."

[2.0–5.0s]
Action: "The fisherman plants the pole and the boat moves upstream."
Camera: "Maintain the same framing."
SFX: "Pole and water sounds."
The shot lands on the fisherman and boat remaining clearly visible.

overall_soundscape:
Diegetic environmental sound only; no music.

non_diegetic_music:
A sparse atmospheric underscore.`;

const repaired = validateAndRepairH3Prompt(ref2vaPrompt, {
  durationSeconds: 5,
  expectedWorkflow: 'ref2va',
  referenceImageCount: 1,
  audioIntent: 'Diegetic ambience only; no music.',
});

assert.equal(repaired.canProceed, true);
assert.match(repaired.prompt, /non_diegetic_music:\s*N\/A\s*$/m);
assert.ok(repaired.autoFixes.includes('forced-non-diegetic-music-na'));

const mismatched = validateAndRepairH3Prompt(ref2vaPrompt, {
  durationSeconds: 5,
  expectedWorkflow: 'base',
});
assert.equal(mismatched.canProceed, false);
assert.ok(mismatched.issues.some((issue) => issue.code === 'h3-workflow-mismatch'));

const overPhased = validateAndRepairH3Prompt(
  ref2vaPrompt.replace(
    '[2.0–5.0s]',
    `[2.0–3.0s]\nAction: "The fisherman looks upstream."\nCamera: "Maintain framing."\nSFX: "Water."\n\n[3.0–5.0s]`,
  ),
  {
    durationSeconds: 5,
    expectedWorkflow: 'ref2va',
  },
);
assert.equal(overPhased.canProceed, false);
assert.ok(overPhased.issues.some((issue) => issue.code === 'h3-too-many-action-phases'));

const denseAction = validateAndRepairH3Prompt(
  ref2vaPrompt.replace(
    'The fisherman notices one petal and pauses.',
    'The fisherman pulls the net, drops it, grabs the pole, raises it, and plants it.',
  ),
  {
    durationSeconds: 5,
    expectedWorkflow: 'ref2va',
  },
);
assert.equal(denseAction.canProceed, false);
assert.ok(denseAction.issues.some((issue) => issue.code === 'h3-action-density'));

const cameraConflict = validateAndRepairH3Prompt(
  ref2vaPrompt.replace('A stable tracking shot.', 'A tracking shot combines dolly and pan movement.'),
  {
    durationSeconds: 5,
    expectedWorkflow: 'ref2va',
  },
);
assert.ok(cameraConflict.issues.some((issue) => issue.code === 'h3-multiple-camera-motions'));

const visibilityConflict = validateAndRepairH3Prompt(
  ref2vaPrompt.replace(
    'The shot lands on the fisherman and boat remaining clearly visible.',
    'The boat disappears into dense fog while a tiny detail remains clearly visible.',
  ),
  {
    durationSeconds: 5,
    expectedWorkflow: 'ref2va',
  },
);
assert.ok(visibilityConflict.issues.some((issue) => issue.code === 'h3-end-state-visibility-conflict'));

console.log('H3 prompt validator checks passed.');
