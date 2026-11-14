# Speech performance evaluation

Latest production implementation: [cold parallel evaluation](PARALLEL_REPORT.md).
Run `python benchmarks/speech/bench_parallel.py --out benchmarks/speech/results/parallel-production-cold`
with the benchmark admin token configured and a current Manim Cloud login.
This exercises the unchanged API, remote assembly, shutdown, and two simultaneous callers.
The older measurements below describe the serial implementation and include warm reuse.

[Measured results](REPORT.md). Selected: full-precision ONNX, four threads on
Cloudflare standard-4. Warm end-to-end medians were 2.69 / 15.54 / 20.28 /
50.77 seconds for short / medium / technical / long narration, versus
3.99 / 28.05 / 30.10 / 95.57 seconds locally. All 15 final cloud requests
passed automated audio and timing checks. Three cold short requests took
6.27–8.46 seconds. These are small-sample measurements, not latency guarantees.

Run from the Manimate repository. Requires Python, NumPy and FFmpeg for
validation. The local baseline also needs the existing Kokoro installation.

```sh
python benchmarks/speech/bench.py --local --repeats 3 --out benchmarks/speech/results/local-m2
# Set SPEECH_API_KEY securely to the benchmark admin secret first.
python benchmarks/speech/bench.py --url https://manimate-speech.youfu1202mo.workers.dev --threads 2 --repeats 3 --out benchmarks/speech/results/cloud-fp32-t2
```

Repeat with `--threads 1`, `--threads 4`, and `--quantized` to compare settings.
The remote benchmark resets slot 0, so only run it against an idle service.
It stops its container in a finally block. Credentials are never recorded.

Four fixed workloads: short, medium, technical and long educational narration.
Identical text and voice (`af_heart`) for all engines. No audio-result cache is
used. The initial short request is cold; subsequent requests reuse the model.
The JSON results separate client elapsed time (including download), container
elapsed time, model load, synthesis, CPU process time, output duration and
real-time factor. RTF 0.1 means ten seconds of speech synthesized per second.

Each output is decoded and checked for finite samples, non-silent audio,
continuous subtitle boundaries and agreement with the reported duration.
MP3s and timing JSON are retained for listening and reproduction. These
checks do not establish pronunciation accuracy or perceptual equivalence.
Median and maximum are reported for small samples; no claim of a reliable
production p95 from three trials. Network errors remain in the results.

Keep heavyweight local builds stopped during the final local baseline.
Cloud tests include network latency from the machine running the benchmark.
The cold test includes startup after deliberate stop, not a first image pull
on every possible Cloudflare host. Throughput under many simultaneous users
needs a separate load test.

## Recorded environment and selection

Local baseline: Apple M2, 8 CPU cores, 16 GiB RAM, macOS 26.1.
`local-m2-idle` is the final baseline with local builds stopped; older local
runs overlapped build/upload work and are retained for transparency. The
local path is the existing persistent PyTorch worker with its normal settings.
All clients ran in Sydney; Cloudflare container placement was not controlled.

`cloud-fp32-4cpu-t4-auth` tests the deployed baked-model image through normal
Manim Cloud authentication. Earlier `*-bootstrap` runs downloaded models on
first boot; warm inference uses the same model and runtime. INT8 trials were
stopped after short requests proved slower than full precision. Failed auth
runs remain saved and are excluded from latency summaries. Authentication was
fixed by using supported manual redirect handling and a render service binding.
The render-probe experiment is diagnostic only: setup attempts failed and the
long sweep timed out; its recovered partial data is not the final API benchmark.

Run `report.py <results.json> ... --out REPORT.md` to reproduce tables from
saved data. Review both elapsed time and audio duration: ONNX and PyTorch
produce different segment trimming/tokenization and are not bit-identical.
