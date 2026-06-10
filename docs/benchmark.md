# Kokoro Voiceover Benchmark

Date: 2026-06-09, updated 2026-06-10

## Purpose

Manimate Studio now uses Kokoro as the default local/free voiceover provider, with ElevenLabs kept as the legacy provider. This benchmark checks Kokoro worker count, warmed Kokoro performance, and ElevenLabs comparison.

## Environment

- Machine: local Apple Silicon Mac
- Repo default `python3`: Python 3.13.2
- Benchmark Python: Python 3.12.7 virtualenv
- Manimate local `python`: Python 3.10.13 with `kokoro==0.9.4`
- Kokoro: `kokoro==0.9.4`
- Torch: `torch==2.12.0`
- Required system dependency: `espeak-ng`
- Audio output path: Kokoro 24 kHz audio -> temporary WAV -> MP3 via `ffmpeg`

Important setup note: Kokoro `0.9.4` does not install on Python 3.13 because its package requires Python `<3.13`. Use a Manimate TTS Python below 3.13. On this machine, `python` is the working interpreter and `python3.12` does not have Kokoro installed.

## Benchmark Input

The benchmark used an 8-line Manimate-style `SubtitleSpec` totaling 42.82 seconds of generated audio.

The first warmup run was excluded because it installed/downloaded runtime assets:

- spaCy English model
- Kokoro model weights from Hugging Face
- initial Torch/Kokoro model setup

That cold path took 215.1 seconds for a single short line and should not be used for steady-state worker selection.

Kokoro's official README format uses one `KPipeline`, a multi-line `text`, and `split_pattern=r"\n+"`. Manimate's Kokoro path now follows that format so all subtitles run through one loaded CPU pipeline while still producing one cached MP3 per subtitle.

## Kokoro Results

CPU steady-state runs:

| Device | Workers | Wall Time | Audio Duration | Realtime Factor |
| --- | ---: | ---: | ---: | ---: |
| CPU | 1 | 34.72s | 42.82s | 0.81x |
| CPU | 2 | 30.56s | 42.82s | 0.71x |
| CPU | 1 | 23.27s | 42.82s | 0.54x |
| CPU | 4 | 45.65s | 42.82s | 1.07x |
| CPU | 1 | 31.63s | 42.82s | 0.74x |
| CPU | 2 | 34.15s | 42.82s | 0.80x |

MPS test runs:

| Device | Workers | Wall Time | Audio Duration | Realtime Factor |
| --- | ---: | ---: | ---: | ---: |
| MPS | 1 | 40.90s | 42.82s | 0.96x |
| MPS | 2 | 49.46s | 42.82s | 1.15x |

Warmed Kokoro, same Python process, model loaded before timing:

| Device | Workers | Format | Wall Time | Audio Duration | Realtime Factor |
| --- | ---: | --- | ---: | ---: | ---: |
| CPU | 1 | per-line pipeline calls | 24.82s | 42.82s | 0.58x |
| CPU | 1 | per-line pipeline calls | 16.56s | 42.82s | 0.39x |
| CPU | 1 | per-line pipeline calls | 17.01s | 42.82s | 0.40x |
| CPU | 1 | README-style multi-line text | 14.01s | 42.82s | 0.33x |
| CPU | 1 | README-style multi-line text | 12.84s | 42.82s | 0.30x |
| CPU | 1 | README-style multi-line text | 13.04s | 42.82s | 0.30x |

## Decision

Use CPU with one worker by default:

```python
KOKORO_DEFAULT_WORKERS = 1
KPipeline(..., device="cpu")
```

Parallel Kokoro generation is not consistently faster on this machine. Two workers was sometimes slightly faster and sometimes slower, while four workers was clearly worse. Each parallel process has to load its own model and competes for local compute resources.

MPS was slower than CPU in this benchmark and emitted additional Torch warnings, so the implementation intentionally does not use MPS.

Best next speedup: keep a persistent Kokoro worker/process warm while Studio is open. The warmed README-style path generated 42.82 seconds of audio in 12.84-14.01 seconds, which is much closer to ElevenLabs than fresh-process Kokoro.

Manimate now starts a Kokoro worker after Send for Kokoro voices. The worker:

- uses CPU only
- warms the selected voice
- serves TTS requests over a local Unix socket
- shuts down after 10 minutes idle
- keeps `tts-generate.py --plan plan.md --voice af_heart` as the agent-facing command

Worker test:

| Scenario | Wall Time | Notes |
| --- | ---: | --- |
| Worker prewarm after dependencies/model cached | 9.75s | Runs while agent is planning |
| Warm worker TTS, 8 subtitles | 13.8s | 42.8s generated audio |
| Full `manimate` CLI smoke run | completed | Produced `video.mp4` with Kokoro voiceover |
| Full `manimate` CLI worker run | 1.7s | 3 subtitles, 4.925s generated audio, realtime factor 0.35x |

The worker health check uses a `status` command, not a bare `ping`. A reusable worker must:

- speak the current worker protocol
- run under the same Python interpreter as the calling TTS script
- have Kokoro importable in that interpreter

If a stale worker is already bound to the socket but cannot synthesize, `tts-generate.py` restarts the worker and retries once before falling back to in-process Kokoro. This avoids a bad benchmark, old environment, or post-sleep stale socket keeping the app on the slow path.

## ElevenLabs Comparison

The same 8-line `SubtitleSpec` was also benchmarked with the legacy ElevenLabs provider using voice `Lci8YeL6PAFHJjNKvwXq`.

| Provider | Device | Workers | Wall Time | Audio Duration | Realtime Factor |
| --- | --- | ---: | ---: | ---: | ---: |
| Kokoro fresh process | CPU | 1 | 23.27s-34.72s | 42.82s | 0.54x-0.81x |
| Kokoro warm process | CPU | 1 | 12.84s-14.01s | 42.82s | 0.30x-0.33x |
| ElevenLabs | Cloud API | 1 | 6.8s | 38.5s | 0.18x |
| ElevenLabs | Cloud API | 5 | 4.5s | 40.3s | 0.11x |

ElevenLabs is materially faster for uncached generation because the work runs remotely and the API requests can be issued in parallel. The current ElevenLabs default of 5 workers is still appropriate for the legacy provider.

Kokoro remains the default for Manimate Studio because it is local and free, not because it is faster.

If Studio keeps Kokoro loaded in the background as the user types or while the app is idle, the relevant comparison is warmed Kokoro vs ElevenLabs: roughly 13 seconds vs 4.5 seconds for this test.

## Commands

Warmup:

```bash
python3.12 -m venv .venv-kokoro-bench-py312
.venv-kokoro-bench-py312/bin/python -m pip install 'kokoro>=0.9.4' soundfile
brew install espeak-ng
.venv-kokoro-bench-py312/bin/python scripts/tts-generate.py \
  --plan /tmp/manimate-kokoro-bench/warmup/plan.md \
  --provider kokoro \
  --voice af_heart
```

Worker benchmark:

```bash
.venv-kokoro-bench-py312/bin/python scripts/tts-generate.py \
  --plan /tmp/manimate-kokoro-bench/run/plan.md \
  --provider kokoro \
  --voice af_heart \
  --workers 2 \
  --benchmark-kokoro-parallel
```

```bash
.venv-kokoro-bench-py312/bin/python scripts/tts-generate.py \
  --plan /tmp/manimate-kokoro-bench/run/plan.md \
  --provider kokoro \
  --voice af_heart \
  --workers 4 \
  --benchmark-kokoro-parallel
```

ElevenLabs comparison:

```bash
python scripts/tts-generate.py \
  --plan /tmp/manimate-elevenbench/plan.md \
  --provider elevenlabs \
  --voice Lci8YeL6PAFHJjNKvwXq \
  --workers 5
```

```bash
python scripts/tts-generate.py \
  --plan /tmp/manimate-elevenbench/plan.md \
  --provider elevenlabs \
  --voice Lci8YeL6PAFHJjNKvwXq \
  --workers 1
```
