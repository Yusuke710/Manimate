# Manimate

Create Manim videos with Claude Code or Codex in a local browser app.
Describe your animation, watch the result, and refine it in chat. Render locally or with Manim Cloud.

## Install

On macOS or Linux:

```bash
curl -fsSL https://manimate.ai/install.sh | bash
manimate
```

The installer uses Node.js 22+ if available, or downloads a private Node runtime. You do not need to install npm first or run `npm start`.

Already have Node.js 22+ and npm? Install with:

```bash
npm install -g manimate
manimate
```

## Create and refine

1. Describe a video in chat and choose the aspect ratio and optional voice.
2. The agent writes `script.py`, renders the scenes, and produces `video.mp4`.
3. Watch the preview and send timestamped feedback to refine it.
4. Click **Download** to save the current MP4.

**Share** uploads a completed video session and creates a Manim Cloud link. **Handoff** starts a fresh conversation with the current code, video, and chapter timings.

## From the terminal

```bash
manimate "Animate the Laplace transform"
```

Use `-s <session-id>` to continue a session, `-v <voice-id>` for narration, and `--show-events` for progress. Voice is off by default. Generation returns JSON with the session ID, review URL, video URL, and completion status.

## Your files

Sessions live in `~/.manimate/sessions/<session-id>/`, with generated files inside `project/`. Set `MANIMATE_LOCAL_ROOT` to use another location.

Cloud mode automatically backs up completed sessions while the app is open. Local mode keeps them on your machine.

## Develop

```bash
git clone https://github.com/Yusuke710/Manimate.git
cd Manimate
npm install
npm run dev
```
