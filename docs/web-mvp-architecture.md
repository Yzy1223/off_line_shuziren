# Duix Web MVP

## Goal

Build the first web-based MVP around the workflow below:

1. User pastes a Douyin share string or short URL.
2. Backend downloads the video or asks the user to upload a fallback file.
3. Backend extracts audio.
4. Backend sends audio to Bailian `qwen3-asr-flash-filetrans`.
5. Extracted transcript is shown in the source copy box.
6. User can manually refine the source copy.
7. Backend rewrites the copy with a track-aware prompt template.
8. Backend submits audio/video jobs to the local avatar services.

## New folders

- `apps/web`
  - Vue 3 + Vite website
- `apps/server`
  - Express backend orchestrator
- `docs/web-mvp-architecture.md`
  - This document

## MVP pages

### Creation page

- Track input
- Douyin URL input
- Source copy textarea
- Rewritten copy textarea
- Avatar generation status panel

### Avatar training page

- Voice training material
- Reference text editing
- Avatar video training material

## Required runtime inputs

- Bailian API key
- Bailian ASR model id
- Bailian rewrite model id
- OSS credentials
- Optional Douyin download cookies if the lightweight flow is not enough
- Final local service endpoints for TTS and avatar generation
