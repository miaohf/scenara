import assert from 'node:assert/strict';

import {
  compileQwenImage21Prompt,
  isQwenImage21Workflow,
} from '../src/services/ai/qwenImagePromptCompiler.ts';

assert.equal(isQwenImage21Workflow('image_qwen_image_2_1_t2i'), true);
assert.equal(isQwenImage21Workflow('', 'ComfyUI Qwen Image 2.1'), true);
assert.equal(isQwenImage21Workflow('image_flux2_klein_image_edit_9b_base'), false);

const t2i = compileQwenImage21Prompt({
  prompt: 'A red paper lantern hangs above a quiet rainy alley at night.',
  mode: 't2i',
  referencePackType: 'scene',
});
assert.match(t2i, /^\[QWEN_IMAGE_2_1_T2I_V1\]/);
assert.match(t2i, /concrete observable details/i);
assert.match(t2i, /red paper lantern/i);

const edit = compileQwenImage21Prompt({
  prompt: 'Put the blue coat from the clothing reference on the protagonist.',
  mode: 'edit',
  referencePackType: 'shot',
  referenceAnnotations: ['Scene canvas: rainy alley', 'Character identity: protagonist', 'Prop: blue coat'],
  referenceCount: 3,
  hasTurnaround: true,
});
assert.match(edit, /^\[QWEN_IMAGE_2_1_EDIT_V1\]/);
assert.match(edit, /<image1>: Scene canvas: rainy alley/);
assert.match(edit, /<image2>: Character identity: protagonist/);
assert.match(edit, /only the attributes named/i);
assert.match(edit, /turnaround sheet is one identity reference/i);

const shapeEdit = compileQwenImage21Prompt({
  prompt: 'Render the vehicle as a painted 2D animation cel.',
  mode: 'edit',
  referencePackType: 'shape',
  referenceCount: 1,
});
assert.match(shapeEdit, /geometry-only/i);
assert.match(shapeEdit, /<image1>: shape-only source/i);

console.log('Qwen Image 2.1 prompt compiler checks passed.');
