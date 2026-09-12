# Prompt architecture

Scenara keeps creative intent and model constraints separate.

## Layers

1. Narrative layer: characters, scene, action, dialogue, style and target duration.
2. Director layer: shot size, camera angle, camera movement, start state and end state.
3. Model policy layer: Sora, Veo, ComfyUI or generic capability rules.
4. Consistency layer: identity, scene lighting, clothing and prop anchors.
5. Team template layer: project overrides, reviewable template changes and future server-side ownership.

The first three layers are assembled by the frontend. The model policy is appended
after the creative prompt so that a custom template can still control the narrative
without accidentally opting out of safety and continuity constraints.

## Model policy routing

`front-end/src/services/ai/videoPromptPolicy.ts` maps model IDs to policies:

- Sora-compatible models: start-frame-first, storyboard guidance only, no visible grid.
- Veo models: start/end-frame transitions when available, with the same single-screen output rules.
- ComfyUI models: preserve the workflow input contract and avoid cloud-only restrictions.
- Unknown models: conservative generic continuity and single-shot rules.

Custom models can set `params.promptPolicy` in the model registry when their ID
cannot be inferred reliably.

## Team usage guidance

Project templates should be treated as versioned production assets. Keep the
narrative fields editable, but review and lock policy blocks such as identity,
reference-image priority, no-collage rules and model capability constraints.

The next server-side collaboration step is to move template overrides from browser
storage into project-scoped records with author, version, review status and rollback.
