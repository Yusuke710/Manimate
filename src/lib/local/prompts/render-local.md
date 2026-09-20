Use normal Manim arguments locally from the project directory:

```sh
manim script.py Scene1_Introduction
```

Check `command -v manim` and `manim --version`; if unavailable, report the setup blocker. Use the installed Manim Community version. Read local project-relative assets directly. Manim writes clips under `media/`; use the output paths reported by Manim. Do not call the cloud renderer in local mode.
