# Manimate

Create Manim videos with Claude Code or Codex, using local or cloud rendering.

- Claude Code or Codex runs locally; Manim rendering can run in the cloud or locally
- sessions are stored locally as session.json and project files
- choose local rendering without sign-in, or connect with Google for cloud rendering

## Requirements

- Node.js 22+
- Claude Code 2.1.277+ (`claude`) authenticated locally, with native `AGENTS.md` loading enabled
- optional: Codex CLI (`codex`) authenticated locally for `-m codex`
- FFmpeg (`ffmpeg` and `ffprobe`) for stitching and frame inspection
- cloud rendering: the [Manim Cloud CLI](https://github.com/Yusuke710/manim-cloud#use-the-cli), available on your PATH; connect with Google during terminal setup
- local rendering: Manim CE 0.21.0 (`manim`), LaTeX, and `dvisvgm`
- optional: `ELEVENLABS_API_KEY` for voiceover, or paste it in the Studio voice menu

## Install

Recommended full install:

```bash
curl -fsSL https://manimate.ai/install.sh | bash
```

The updated installer runs terminal setup: choose **Local** to install Manim, or **Cloud** to open Google sign-in. Both modes use local FFmpeg for stitching and frame inspection. Change your choice later with `manimate --setup`.

The updated installer is currently in `scripts/install.sh`; the hosted installer still serves the previous release until publication.

CLI-only npm install:

```bash
npm install -g manimate
```

Running `manimate` after npm installation starts the same terminal setup.

Then run:

```bash
manimate
```

## Rendering instructions

Claude and Codex use the same project `AGENTS.md`. Manimate copies one complete file—`prompts/cloud/AGENTS.md` or `prompts/local/AGENTS.md`—into the project based on the selected render mode. Both agents load that single file natively. No `CLAUDE.md` is generated.

On first launch, choose **Local** or **Cloud**. Local installs or upgrades Manim to 0.21.0 before opening. Cloud connects through the same Google sign-in page as the MCP connector at `cloud.manimate.ai`. Change modes with `manimate --setup`; the local-mode sidebar also offers a cloud connection. The saved choice is in `~/.manimate/config.json`; `MANIMATE_RENDER_MODE` can override it.

Cloud mode uses the `manim-cloud` CLI; local mode uses `manim`. Both use local FFmpeg for stitching and frame inspection. The app reads `plan.md`, `script.py`, and the final `video.mp4` from each project. Narrated projects keep the fast `lint-subtitles.py` timing check. Completed cloud-mode sessions are automatically backed up privately to Manim Cloud R2 using the same Google connection. Automatic backup runs only while Cloud mode is selected; selecting Cloud also backs up existing library videos. Backups include session history, source, assets, and final outputs; generated media caches and hidden files are excluded. Each compressed backup is limited to 100 MB. Hosted sharing and its separate connection flow have been removed.

## From Source

```bash
git clone https://github.com/Yusuke710/Manimate.git
cd Manimate
npm install
```

Optional API features:

```bash
cp .env.example .env.local
# then set ELEVENLABS_API_KEY in .env.local if needed
```

You can also open the voice menu in Studio and paste your ElevenLabs API key there. Manimate saves it locally in `~/.manimate/config.json`, so users do not need to edit `.env.local` by hand.

## Run

```bash
manimate
```

In this repo, the equivalent command is:

```bash
npm run manimate
```

This starts the local app and opens the browser. Cloud rendering uses the saved Google connection to Manim Cloud.

For direct local development:

```bash
npm run dev
```

Then open `http://localhost:32179`.

## CLI

Open the app:

```bash
manimate
manimate --no-open
```

Stop the local app:

```bash
manimate stop
```

Generate from the shell:

```bash
manimate "Animate Laplace transform"
manimate "Animate Laplace transform" -m claude -a 16:9
manimate "Animate Laplace transform" -m codex
manimate "Animate Laplace transform" -v Lci8YeL6PAFHJjNKvwXq
manimate "Animate eigenvectors" --no-voice
manimate -p "--animate a prompt that starts with a dash"
```

Generation returns one JSON object on `stdout`. `--show-events` prints readable progress to `stderr`. Voice is off by default, so only pass `-v` when voiceover is wanted. Do not pass `--json`.

Generate flags:

- `-p`, `--prompt <text>` use this when the prompt starts with `-`
- `-s`, `--session <id>` continue an existing session
- `-m`, `--model <claude|codex>` choose the logical runtime model
- `-a`, `--aspect <16:9|9:16|1:1>`
- `-v`, `--voice <voice_id>`
- `--no-voice`
- `--base-url <url>`
- `--show-events`
- `--quiet`

Open flags:

- `--no-open`
- `--restart`
- `--mode <auto|standalone|dev|start>`
- `--port <number>`
- `--host <hostname>`

Repo entrypoints:

```bash
npm run tool:open
npm run tool:generate -- "Animate Laplace transform"
node scripts/manimate-tool.mjs "Animate Laplace transform"
```

Example generation output:

```json
{
  "ok": true,
  "status": "completed",
  "session_id": "b92794d1-2279-477b-b818-064d78d272b1",
  "run_id": "6fea0020-7f6a-4d97-bcb9-44327b3fdee9",
  "video_url": "/api/files?session_id=...&path=.../video.mp4&_v=...",
  "review_url": "http://localhost:32179/?session=b92794d1-2279-477b-b818-064d78d272b1",
  "message": "Complete"
}
```

Useful output fields:

- `status`: `completed` | `canceled` | `failed`
- `session_id`: session to inspect later
- `review_url`: browser review link
- `video_url`: rendered video URL, if present

Troubleshooting:

- If Manimate cannot be reached, start it with `manimate` or pass `--base-url`.
- If `status=failed`, inspect `/api/sessions/<session_id>/messages`.
- If cloud auth expired, run `manim-cloud login` to reconnect.

## HTTP API

Generate with:

- `POST /api/tool/generate`

Example request:

```json
{
  "prompt": "Animate eigenvectors in 2D",
  "model": "claude",
  "aspect_ratio": "16:9"
}
```

The endpoint materializes or reuses a session and streams SSE events from the same local generation pipeline used by the UI.

## Deep Links

The welcome screen supports:

- `prompt` or `q`
- `send=1`
- `model`
- `voice_id` or `voice`
- `aspect_ratio`

Examples:

- `http://localhost:32179/?prompt=Animate%20Taylor%20series`
- `http://localhost:32179/?prompt=Animate%20Bayes%20rule&send=1`

## Local Data

Default root: `~/.manimate/`

- `sessions/<session_id>/session.json`
- `sessions/<session_id>/project/`
- `sessions/<session_id>/project/inputs/`
- `sessions/<session_id>/artifacts/`

Override with `MANIMATE_LOCAL_ROOT`.

In Cloud mode, Manimate automatically backs up this machine’s library to Manim Cloud R2 while the app is open. It uploads existing videos and changed sessions, skips unchanged backups, and retries failures. Local mode disables automatic backup. Other installations’ sessions are not downloaded.
