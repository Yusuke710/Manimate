# Kokoro Voiceover Benchmark

Date: 2026-06-09, updated 2026-06-10 and 2026-07-03.

## 2026-07-03: kokoro-onnx evaluated, rejected — staying on PyTorch + worker

[`kokoro-onnx`](https://github.com/thewh1teagle/kokoro-onnx) (onnxruntime port of the same Kokoro-82M weights) was prototyped as a replacement for the PyTorch `kokoro` package to eliminate the cold-start warm-up. Measurements on this machine (Apple Silicon, CPU):

| Engine | Cold start to first audio | Warm inference |
| --- | ---: | ---: |
| PyTorch `kokoro` 0.9.4 | ~29.5s (15-16s torch/spaCy import + 9-10s load + 4s first synth) | ~0.25x realtime |
| `kokoro-onnx` fp32 | ~3.1s | ~0.65-0.9x realtime |
| `kokoro-onnx` fp16 | ~3s | ~30% faster than fp32, still ~3x slower than torch |

Other variants rejected outright: int8 was slower than fp32 on Apple Silicon; CoreML EP fragmented the graph into 129 partitions and was slower than plain CPU.

Decision: **keep PyTorch + the Unix-socket worker.** Rationale:

- The prewarm fired at chat-turn start (`prewarmLocalKokoroVoice` in `chat.ts`) overlaps the agent writing `plan.md`, which takes far longer than the 30s cold start — so the agent's TTS run hits a warm worker and only warm inference time matters. There, torch wins ~3x (8.3s vs 19-26s for a 30s-audio plan; torch benefits from Accelerate/AMX, which onnxruntime's CPU EP does not match).
- The PyTorch `kokoro` package is hexgrad's official reference implementation; kokoro-onnx is a community runtime. Staying official is better for future model updates.
- Costs accepted knowingly: torch (~2GB) + spaCy installs, Python <3.13 pin, `brew install espeak-ng`, and the ~240-line worker daemon.

If the worker's 10-minute idle TTL ever becomes a felt problem again, raise `KOKORO_WORKER_IDLE_TTL_S` before revisiting ONNX.

## 2026-07-03 (later): mlx-audio and kokoro-js evaluated (Mac install-target scenario)

Benchmarked on an idle M2 / 16GB (load avg ~2; the earlier ONNX numbers above were taken under load avg 30-76, which inflated them — the torch cold start re-measured idle is ~11s, not ~29.5s). Same 8-line / 34s-audio plan, same `af_heart` voice. Full-audio samples: engines produce equivalent output — Whisper-base WER 3.4% for all three, no NaN/clipping/silence anomalies.

| | PyTorch `kokoro` (current) | mlx-audio 0.4.1 (MLX, bf16) | kokoro-js (Node, ORT CPU, fp32) |
| --- | --- | --- | --- |
| Clean setup | pip + brew espeak-ng, Python <3.13 pin; ~440MB packages (torch macOS wheel is 381MB, not the 2GB CUDA size) | ~70s pip, 1.1GB venv (misaki drags spaCy back in); no brew deps | 11s `npm install`, 408MB node_modules; zero system deps (espeak via WASM) |
| Model download (one-time) | 313MB / ~30s + spaCy model | 353MB / ~25s | 321MB / ~14s |
| Cold start → first audio | 11.1s | 5.7s | **1.5s** |
| Warm inference (34s audio) | 7.3s (RTF 0.215) | 3.8-6.6s (RTF 0.111-0.195) | 36s (RTF ~1.03; q8 worse at 1.22) |
| Fresh-process total, 34s audio | 18.4s cold / ~7.6s via warm worker | **9.4-12.3s, no worker needed** | ~37s (in-process, no spawn at all) |

Reliability findings (the deciding factor, not speed):

- **mlx-audio 0.4.4 (current PyPI release) is broken**: ~10% of ordinary sentences crash with a `broadcast_shapes` error in the vocoder ([issue #784](https://github.com/Blaizzy/mlx-audio/issues/784), regression from 0.4.2-0.4.4; fix merged to main 2026-07-01 but unreleased, and main has fresh NaN/silent-audio reports #813/#815). 0.4.1 passes all inputs. The mlx-community quantized model repos (4bit/8bit) are weight-layout incompatible with 0.4.1. Conclusion: usable only with hard-pinned package + model-repo versions.
- **kokoro-js** is stable but unmaintained since May 2025, and inherits the ORT-CPU-slow-on-Apple-Silicon penalty (~5x slower than torch warm).
- int8/q8 quantization was slower than fp32/bf16 in every runtime tested (python ORT, sherpa numbers, kokoro-js) — do not revisit.

Takeaway: mlx-audio is the only engine that beats torch on BOTH cold start and warm inference on Apple Silicon (fresh-process total ≈ the current warm-worker fast path, which would let the worker daemon be deleted), but its release quality as of July 2026 is not trustworthy enough to ship as the default. Re-evaluate when 0.4.5+ ships with the SineGen fix and the NaN issues closed. kokoro-js is the best "npm install and it just works" story if inference time is not critical.

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
