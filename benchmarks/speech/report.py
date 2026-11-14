#!/usr/bin/env python3
"""Summarize saved evaluations without running or paying for inference."""
import argparse
import json
from pathlib import Path
import statistics

p = argparse.ArgumentParser()
p.add_argument('results', nargs='+', type=Path)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
lines = ['# Kokoro speech benchmark', '',
         'Uncached jobs using the same narration and `af_heart` voice. Times include audio download and exclude validation. '
         'Three warm trials per workload unless indicated. RTF is synthesis time divided by audio duration; lower is better.', '',
         '| Configuration | Workload | Trials | Audio seconds | Median total seconds | Max total seconds | Median synthesis RTF |',
         '|---|---|---:|---:|---:|---:|---:|']
for path in a.results:
    data = json.loads(path.read_text()); label = path.parent.name
    for name in ['short', 'medium', 'technical', 'long']:
        rows = [r for r in data['rows'] if r['case'] == name and not r['cold'] and 'error' not in r]
        if not rows: continue
        med = lambda f: statistics.median(f(r) for r in rows)
        lines.append(f"| {label} | {name} | {len(rows)} | {med(lambda r:r['metrics']['audio_seconds']):.1f} | {med(lambda r:r['end_to_end_seconds']):.2f} | {max(r['end_to_end_seconds'] for r in rows):.2f} | {med(lambda r:r['metrics']['real_time_factor']):.3f} |")
lines += ['', '## Cold starts and failures', '']
for path in a.results:
    data = json.loads(path.read_text()); rows = [r for r in data['rows'] if r['cold'] and 'error' not in r]
    cold = ', '.join(f"{r['end_to_end_seconds']:.2f}s" for r in rows) or 'no successful samples'
    errors = [r for r in data['rows'] if 'error' in r]
    lines.append(f'- {path.parent.name}: cold short requests {cold}; {len(errors)} failures out of {len(data["rows"])} requests.')
lines += ['', '## Cost interpretation', '',
          'Results identify the tested instance type. standard-3 has 2 vCPU/8 GiB/16 GB; standard-4 has 4 vCPU/12 GiB/20 GB. Using published marginal rates, '
          'estimate compute as CPU-seconds × $0.000020 plus container-seconds × (RAM GiB × $0.0000025 + disk GB × $0.00000007). '
          'The two-minute idle window adds about $0.00253 (standard-3) or $0.00377 (standard-4) per isolated burst before CPU, Workers, Durable Objects and egress. '
          'CPU metrics measure Python process CPU during synthesis only; they exclude model load, encoding and platform overhead. '
          'This is an estimate, not an invoice. Included allowances may reduce the bill.', '',
          'Source: https://developers.cloudflare.com/containers/platform/pricing/', '',
          '## Limits of this evaluation', '',
          'Small samples do not establish production p95 or multi-user capacity. The PyTorch and ONNX pipelines use the same text and voice but different tokenization/trimming, so generated durations differ; compare both elapsed time and RTF. Cloud host variation can materially affect speed. Cold tests deliberately stop a container; '
          'they do not force every possible host/image-cache condition. Audio checks establish decodability, non-silence '
          'and timestamp continuity, not perceptual quality or pronunciation accuracy. Retain the MP3s for listening.']
a.out.write_text('\n'.join(lines)+'\n')
print(a.out)
