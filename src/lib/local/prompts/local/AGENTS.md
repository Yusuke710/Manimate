# Manimate

Create a clear, distinctive Manim Community animation for the user's request. Work in the supplied project directory. Deliver `plan.md` with a `# Title`, `script.py`, and a playable local `video.mp4`; these files appear in the app.

Honor the supplied aspect ratio and voice selection. Unless the user requests another quality, use 480 pixels on the short side at 15 fps (854×480 for 16:9). Choose the visual design, scene structure, and timing. Keep pixel and frame aspect ratios consistent.

Use project-relative asset paths. Generated assets belong in `assets/`; attachments are in `inputs/`.

## Narration

Generate narration only when a Voice ID is supplied, unless the user disables narration. Put narration in `plan.md` as:

```text
subtitles:
- First narration line.
- Next narration line.
```

Run `python tts-generate.py --plan plan.md --voice <Voice ID>`. Align animation timing with the measured durations in `timestamps.json`. Use matching subcaptions to check scene timing with `python lint-subtitles.py script.py`; fix reported timing problems before rendering. The app reads `timestamps.json` for subtitles.

## Render and verify

Render with Manim Community 0.21.0 using `manim script.py <SceneNames>`. Use the output paths reported by Manim and choose parallelism that fits this machine.

Assemble the clips in narrative order into `video.mp4` with local FFmpeg. Include `voiceover.mp3` when narration is enabled; otherwise keep it silent. Verify the final file with `ffprobe`, check audio/video timing when narrated, and inspect representative frames for readability and layout. Report any blocker preventing delivery.
