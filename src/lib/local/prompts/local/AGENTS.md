# Manimate

Create distinctive animations with Manim Community. Work in the supplied project directory (already cwd). Deliver local `plan.md`, `script.py`, and playable `video.mp4`; continue through rendering and verification unless blocked or the user asks otherwise. Report real blockers plainly.

## Plan and code

- Keep `plan.md` brief: a `# Title`, scene outline, visual direction, and narration when enabled. Use one descriptively named class per scene in `script.py`.
- Honor the supplied **Aspect Ratio** and **Render Profile**, with user requests taking precedence. Set pixel dimensions, frame dimensions, and frame rate in `script.py`; keep their aspect ratios matched. Defaults: 16:9 = 854×480, 9:16 = 480×854, 1:1 = 480×480, all at 15 fps. `hq_1080_30` and `uhd_4k_30` use 1080 and 2160 on the short side at 30 fps, preserving aspect ratio.
- Use `Tex` for labels and `MathTex` for formulas; use `Text` only when there is a specific non-TeX reason.
- Use project-relative asset paths. Put generated assets in `assets/`; attached files are in `inputs/`. Absolute paths supplied for attachments are for local inspection, not portable scene code.

## Narration

Only generate narration/subtitles when **Voice ID** is provided and the user has not disabled narration, TTS, or captions. Otherwise omit TTS and `add_subcaption()`.

For narration, include this in `plan.md`:

```text
subtitles:
- First narration line.
- Next narration line.
```

Run `python tts-generate.py --plan plan.md --voice <Voice ID>`. Use the generated `timestamps.json` durations as literal timing budgets in the scene code, including waits and transitions. Add matching subcaptions, and run `python lint-subtitles.py script.py`; fix timing errors before rendering. The helper caches unchanged narration.

## Render and deliver

Use normal Manim arguments locally from the project directory:

```sh
manim script.py Scene1_Introduction
```

Check `command -v manim` and `manim --version`; if unavailable, report the setup blocker. Use Manim Community 0.21.0. Read local project-relative assets directly. Manim writes clips under `media/`; use the output paths reported by Manim. Do not call the cloud renderer in local mode.

Choose scene grouping and parallelism yourself (up to six concurrent jobs). Inspect error logs, fix code, and re-render only affected scenes; reuse previously downloaded clips. Stitch scenes in narrative order with local FFmpeg. Mux `voiceover.mp3` when narration is enabled; otherwise produce a silent `video.mp4`.

Verify the final file with `ffprobe` and inspect representative frames for layout/readability before finishing. The app previews local `video.mp4`; a remote URL alone is not the deliverable.
