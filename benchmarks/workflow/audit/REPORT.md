# Lightweight harness and CPU-service audit

No production deployment, application prompt change, workflow restriction or
new model-facing helper was made. Tests used existing remote APIs. The temporary
render CPU evaluation job was deleted after its results were downloaded.

## Harness: keep decisions with the model

The Manimate-specific cloud instruction file is 505 words. The request wrapper
adds the project directory, aspect ratio, selected voice, user prompt and any
attachments. The app launches Claude and observes files/events; it does not
implement a custom research/planning/code-generation state machine. This is a
light execution architecture. It does not mean the entire Claude context is
505 words: the CLI has its own system context, user settings and available tools.

The trace does show missing interface context. Claude inspected the TTS and
subtitle-linter implementation, discovered the timestamp JSON shape, then
printed individual timings. The current prompt names files but does not state
the timestamp schema. Its initial `ls` plus helper reads took about 3 seconds;
subsequent small inspection commands took fractions of a second. The 97 seconds
previously attributed to inspection are model-response gaps around those
operations, including visual review, not 97 seconds of filesystem I/O. There
is no evidence that suppressing `ls` would yield a large speedup.

A minimal contract could provide:

- Installed command names and required inputs.
- TTS outputs: `voiceover.mp3` and `timestamps.json`, with
  `total_duration_s` and `subtitles[]` entries containing `index`, `text`,
  `start_s`, `end_s`, `duration_s`.
- Render stdout is JSON; progress is stderr. The agent combined them using
  `2>&1`, then wrote code to strip the log prefix. This is optional complexity,
  not a defect in the CLI's stdout contract.
- Render results have `status`, error logs, and `files[]` with `path`/`url`.
- Files needed remotely must be explicitly included when not auto-bundled.

These are API facts, not instructions about how to think. Keep the context
compact rather than loading all helper source or prohibiting discovery.

The existing prompt is more prescriptive than the user's stated preference:
it forbids a separate plan, mandates a subtitle-lint step and representative
frame inspection, and prescribes a typography helper pattern. Those are
product instructions, not necessary properties of the execution architecture.
An autonomy-first revision would retain output/API contracts and genuine
runtime constraints, while allowing the model to choose planning, scene design,
research, review and iteration. This audit leaves the prompt unchanged.

## TTS: parallelize within the service

Used the exact 22 narration segments from the realistic GPT-2/CSS run, same
voice and speed, no audio-result caching. Split into four contiguous groups
balanced by character count. Requests used normal Manim authentication and the
existing four speech workers. Serial/parallel order was alternated.

| Trial | One request | Four parallel requests |
|---|---:|---:|
| 1 | 51.74 s | 24.46 s (three workers loaded cold models) |
| 2 | 50.13 s | 14.67 s (warm) |
| 3 | 50.13 s | 16.41 s (warm) |

Times include synthesis and audio download. All outputs decoded successfully;
combined PCM duration matched 163.6907 seconds within 10 ms. Decoding and joining
added approximately 0.4–0.8 seconds. A final production MP3 encoding/response is
not included: this is a client-side experimental fan-out/PCM join, not a shipped
server-side implementation. Perceptual equivalence was not formally evaluated.

Warm generation was about 3.1–3.4× faster. Implementing this behind the existing
narration API would require no model prompt or calling-command change. The
service should preserve segment order, offset timing records, encode once,
and bound per-request fan-out. Four-way generation currently occupies the
whole four-worker pool, so fair scheduling/available capacity matters when
several users generate videos. It also increases simultaneous memory residency
and startup/idle cost; the same speech workload is not automatically four times
the total CPU work.

In the profiled video, speech already overlapped model work. This change would
improve the speech API's latency but would not automatically remove 35 seconds
from that particular video's total duration.

## Render: correct the queue interpretation first

The API's `queue_seconds` measures `started_at - created_at`. `started_at` is
written AFTER container readiness and input loading. Therefore that field is
**scheduler admission wait plus container startup/input loading**, not pure
queue delay. The prior report has been annotated to correct this interpretation.

| First render pass, nine jobs | Observed range |
|---|---:|
| Scheduler admission wait | 1.16–14.42 s |
| Container startup and input loading | 1.01–31.24 s |
| Actual remote render command | 5.90–39.62 s |

The critical Attention job spent 14.42 s awaiting admission, 24.35 s in
startup/input handling, and 39.62 s executing. The first batch took 83.53 s at
the CLI. In the second pass, startup/input handling was 0.67–1.42 s; it was not
the same workload, so this is not a controlled warm/cold speed comparison.

Increasing concurrency cannot eliminate cold-start time. The highest-value
backend investigation is prewarmed isolated render capacity and smaller/faster
startup, followed by admission pacing. Preserve isolation for arbitrary scene
Python; do not blindly reuse a process/container across users. A warmed,
single-use capacity pool is one possible design, with an idle-cost tradeoff.

The source config uses standard-3 (2 vCPU, 8 GiB) and max_instances=32. The
scheduler defaults to 16 active jobs and 1-second start spacing, with persistent
configuration and capacity backoff. These are source defaults; this audit did
not read or change the persisted live scheduler configuration. Cloudflare
account limits still apply. One scene per independent container already matches
the user's desired model; that does not require exactly one CPU per scene.

## Render CPU experiment

Ran the final generated code in one existing two-vCPU render container, with
Manim animation caching disabled and separate media directories. Alternated
one logical CPU via Linux affinity and normal two-CPU affinity. The host exposed
two CPUs. This tests CPU affinity, not a separately provisioned one-vCPU instance
or concurrent multi-user throughput. Library/filesystem warmup can still vary.

| Scene | One-CPU runs | Normal two-CPU runs |
|---|---|---|
| CssMath | 9.70 s first, 6.97 s warm | 6.83 s, 6.81 s |
| Attention | 16.98 s, 17.43 s | 17.17 s, 16.77 s |

All eight executions succeeded. These scenes gained little from a second CPU
once warm. The first one-CPU CssMath run had additional warmup overhead and
should not be presented as a clean CPU-only comparison. Actual one-vCPU instance
performance/memory limits and sustained concurrency still need measurement
before changing the production instance size. No claim that these values
predict every scene or eliminate host variability.

## Priority

1. Keep the agent execution loop light; supply a small, accurate API/artifact
   contract, not more planning or scene helpers.
2. Prototype server-side speech fan-out with fair capacity allocation behind
   the same API. Measured latency gain is substantial.
3. Reduce render cold-start/admission delay while preserving per-job isolation.
4. Benchmark an actual one-vCPU instance under scene concurrency before using
   smaller containers to improve cost/parallel capacity. More cores per scene
   is not supported as the first speed lever by these tests.

Evidence: `tts-parallel-results.json`, `render-breakdown.json`,
`render-cpu-results.json`; executable experiments are alongside this report.
Cloudflare instance definitions and limits:
https://developers.cloudflare.com/containers/platform/limits/
