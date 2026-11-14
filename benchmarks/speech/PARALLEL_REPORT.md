# Production parallel Kokoro evaluation

Measured 2026-11-14 from Sydney using the completed GPT-2-in-CSS video's narration: 22 segments, 2,381 characters, 163.691 seconds of audio. Voice `af_heart`, speed 1, full-precision ONNX, four threads per standard-4 container. Same frozen text, model and API for both modes; no audio cache. Every inference worker reported a cold model. Containers are destroyed after each request; no warm pool.

## Results

Three alternating serial/parallel trials: single-worker median **87.01 seconds** (59.39–97.01); four-worker median **42.18 seconds** (30.33–43.13). This is **2.06× faster**, a 51.5% reduction in median elapsed time. Small samples and uncontrolled host placement do not establish production percentiles.

| Request | End-to-end seconds | Queue seconds | Pipeline seconds |
|---|---:|---:|---:|
| serial-0 | 97.01 | 0.02 | 95.72 |
| parallel-0 | 42.18 | 0.02 | 39.59 |
| parallel-1 | 30.33 | 0.02 | 29.30 |
| serial-1 | 59.39 | 0.02 | 58.57 |
| serial-2 | 87.01 | 0.02 | 85.53 |
| parallel-2 | 43.13 | 0.02 | 41.83 |
| concurrent-0 | 74.98 | 35.77 | 37.36 |
| concurrent-1 | 36.58 | 0.03 | 34.33 |

End-to-end includes authentication, queueing, cold container/model startup, synthesis, internal transfer, remote assembly, container destruction and download. Pipeline excludes authentication, queueing and final cleanup. Audio decoding for validation is outside the elapsed measure.

The two concurrent requests used normal user authentication (the same account), no admin worker override and no retries. Both succeeded. The second waited 35.77 seconds because the first reserved all four slots. This validates bounded queueing at the configured cap, not unlimited concurrency or a multi-user load test. The pool ended with zero active and zero pending requests. Queue waits exceeding 45 seconds return a retryable busy response.

## Where the time goes

For the three parallel trials, the slowest chunk took 17.92–24.42 seconds to synthesize. Maximum model-load time across workers was 2.84–3.97 seconds. Final lossless decoding, joining and MP3 encoding took 0.90–1.23 seconds. Remaining elapsed time includes startup, transport and cleanup; stage metrics overlap and should not be summed as independent totals. Synthesis and startup dominate; moving final video stitching is not justified by this audio assembly measurement.

Single-worker synthesis varied from 51.22 to 88.29 seconds. The workload is unchanged, so these results expose infrastructure variability rather than a guaranteed latency. Earlier warm/client-side parallel results are separate experiments and are not used in this comparison. No full video or Claude workflow was rerun here.

## Implementation and validation

The public API still accepts ordered narration segments and returns one MP3/WAV plus segment timestamps. The service chooses up to four available workers, preserves segment boundaries, transports lossless FLAC internally, offsets timestamps using PCM sample counts, and encodes the final audio once. No client-side inference or audio joining is required. Final video assembly remains local.

All eight requests passed decoded audio duration, finite/non-silent PCM, original text and indices, contiguous timestamps, and first/last boundary checks. These automated checks do not assess pronunciation or listening quality. Six Python server tests and twelve Worker tests cover assembly, validation, authentication, bounded FIFO admission and cleanup after failures; TypeScript checks passed.

During rollout, old Durable Object slot identities retained the earlier image and returned 404 for the new private endpoints. Versioned slot identities resolved this before the recorded benchmark. Those rollout failures are not part of the successful trial table.

## Reproduction and deployment

Run `python benchmarks/speech/bench_parallel.py --out <fresh-results-directory>` with NumPy and FFmpeg installed, a current Manim Cloud login, and the benchmark admin token in `~/.config/manimate-speech/benchmark-token`. The admin token is used only to force single-worker comparisons. Run against an idle service; the evaluation consumes real cloud compute.

- [Raw measurements](results/parallel-production-cold/results.json)
- [Frozen narration](realistic-narration.json)
- [Evaluation tool](bench_parallel.py)
- Benchmark Worker version: `c28bd3cd-e09c-46cc-a101-d1003c4bc092`.
- Image digest: `sha256:94a231991cf8b9f10bef6d4e926fce91865ff80d3d8fe7219fc789f01f79eb4a`.
- Final Worker version: `d5b81268-1cde-47f3-a264-ea43d9fddc79`.
- Final deployment extends the abandoned-lease expiry from 400 to 600 seconds to cover inference plus assembly deadlines; this does not alter the successful-request execution path.

The endpoint and client command are unchanged; no client release is needed for this service update. Cloud compute still costs the service operator even when users are not charged. This benchmark does not measure the bill.

## Final deployment smoke checks

After the lease-expiry update, the repository helper and the packaged standalone helper both ran with `python3 -S` (no site packages/local inference dependencies), fresh inputs and normal authentication. Two simultaneous nine-segment requests used two cold workers each and produced 53.568 seconds of audio in 21.749 seconds (dev) and 22.149 seconds (packaged). Both MP3s decoded to the exact reported duration with nine timestamps. The raw WAV endpoint also succeeded (2.709 seconds of audio). Final pool status was zero active/zero pending.

## Capacity increase: four simultaneous narrations

The speech ceiling was subsequently increased from 4 to 128 on-demand containers, with at most four workers per narration (capacity for 32 full parallel narrations). Manim rendering remains at its existing 32-instance ceiling. Neither ceiling preallocates warm workers.

Cloudflare's authenticated account usage API confirmed account limits of 15,000 vCPUs, 62,914,560 MiB memory and 300,000,000 MB disk. With standard-4, CPU limits imply at most 3,750 simultaneous containers if no other workloads use the account. Rendering shares those account limits. This is an account resource ceiling, not a demonstrated throughput figure.

The first test immediately after the capacity deployment still showed old four-slot behavior, with two busy responses. Those results are retained in `results/capacity-128-four-concurrent`; the precise propagation cause was not established. Added configured capacity to the admin status response and redeployed. Verified live status reported capacity 128, four active requests and zero pending during the next test.

The final test used four simultaneous normal-auth requests, each with the full 22-segment, 163.691-second narration. All four used four cold workers and passed audio/timing validation:

| Request | End-to-end seconds | Queue seconds |
|---|---:|---:|
| concurrent-0 | 25.39 | 0.034 |
| concurrent-1 | 35.39 | 0.035 |
| concurrent-2 | 32.84 | 0.032 |
| concurrent-3 | 26.79 | 0.032 |

All 16 workers were released; final status was capacity 128, active 0, pending 0. This tests four simultaneous narrations, not 32 complete video pipelines. The unchanged API needs no client release.

Reproduce with `python benchmarks/speech/bench_parallel.py --repeats 0 --concurrency 4 --out <fresh-directory>`. [Raw results](results/capacity-128-four-concurrent-verified/results.json). Final Worker version: `86a1e99f-594e-4f23-8ff2-49497be34685`. Thirteen Worker tests and TypeScript checking passed, including allocation of 32 disjoint four-worker jobs and matching scheduler/platform capacity.
