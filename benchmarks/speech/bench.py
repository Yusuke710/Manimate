#!/usr/bin/env python3
"""Uncached end-to-end speech evaluation; retains audio, timing data and errors.
Remote token comes from SPEECH_API_KEY, never an argument or result file.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parents[2]


def request(base, path, body):
    req = urllib.request.Request(base + path, json.dumps(body).encode(), headers={
        'Authorization': 'Bearer ' + (os.environ.get('SPEECH_USER_TOKEN') if path.startswith('/v1/') and os.environ.get('SPEECH_USER_TOKEN') else os.environ['SPEECH_API_KEY']),
        'X-Manimate-Auth-Origin': os.environ.get('SPEECH_AUTH_ORIGIN', 'https://manimate.ai'),
        'Content-Type': 'application/json', 'User-Agent': 'manimate-render/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            return json.load(response), dict(response.headers)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f'HTTP {exc.code}: {exc.read().decode(errors="replace")[:1000]}') from None


def validate_audio(audio, timestamps):
    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(audio)]))
    stream = probe['streams'][0]
    pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(audio), '-f', 'f32le', '-ac', '1', 'pipe:1'])
    import numpy as np
    samples = np.frombuffer(pcm, dtype='<f4')
    rms = float(np.sqrt(np.mean(samples ** 2)))
    duration = len(samples) / int(stream['sample_rate'])
    expected = timestamps['total_duration_s']
    entries = timestamps['subtitles']
    contiguous = all(abs(a['end_s'] - b['start_s']) < .002 for a,b in zip(entries, entries[1:]))
    valid = bool(np.isfinite(samples).all() and rms > .001 and abs(duration-expected) < .3 and contiguous)
    if not valid:
        raise RuntimeError(f'Audio validation failed: duration={duration}, expected={expected}, rms={rms}')
    return {'decoded_seconds': duration, 'rms': rms, 'timings_contiguous': contiguous, 'valid': valid}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--url')
    p.add_argument('--local', action='store_true')
    p.add_argument('--user-auth', action='store_true', help='Include normal Manim Cloud account verification (owner uses slot 0)')
    p.add_argument('--threads', type=int, default=2)
    p.add_argument('--slot', type=int, choices=range(4), default=0)
    p.add_argument('--instance-type', default='standard-3')
    p.add_argument('--max-rtf', type=float, default=1.0, help='Stop slow configurations after short warm trials; 0 disables')
    p.add_argument('--quantized', action='store_true')
    p.add_argument('--repeats', type=int, default=3)
    p.add_argument('--cold-repeats', type=int, default=1)
    p.add_argument('--out', required=True)
    args = p.parse_args()
    if args.user_auth:
        sys.path.insert(0, str(ROOT / 'scripts/manim-cloud'))
        import cloud_auth
        origin = json.loads(cloud_auth.credential_path().read_text())['base_url']
        os.environ['SPEECH_USER_TOKEN'] = cloud_auth.token(origin)
        os.environ['SPEECH_AUTH_ORIGIN'] = origin
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    cases = json.loads((Path(__file__).parent / 'cases.json').read_text())
    cases['long'] = cases['medium'] + cases['technical'] + cases['medium']
    report = {'started_at': datetime.now(timezone.utc).isoformat(), 'environment': {'platform': platform.platform(), 'machine': platform.machine()},
              'backend': 'local-pytorch' if args.local else 'cloudflare-onnx',
              'threads': args.threads, 'quantized': args.quantized, 'user_auth': args.user_auth, 'instance_type': args.instance_type, 'slot': args.slot, 'rows': []}
    if args.local:
        spec = importlib.util.spec_from_file_location('tts', ROOT / 'scripts/tts-generate.py')
        tts = importlib.util.module_from_spec(spec); spec.loader.exec_module(tts)
        os.environ['KOKORO_WORKER_SOCKET'] = str(out.resolve() / 'worker.sock')
        tts.stop_kokoro_worker()
    else:
        request(args.url, '/admin/configure', {'slot': args.slot, 'threads': args.threads, 'quantized': args.quantized})
    try:
        schedule = [('short', -i-1, True) for i in range(args.cold_repeats)]
        schedule += [(name, i, False) for name in cases for i in range(args.repeats)]
        for name, repeat, cold in schedule:
            lines = cases[name]
            if cold:
                if args.local: tts.stop_kokoro_worker()
                else: request(args.url, '/admin/stop', {'slot': args.slot})
            row = {'case': name, 'repeat': repeat, 'cold': cold,
                   'characters': sum(map(len, lines)), 'input_sha256': hashlib.sha256(json.dumps(lines).encode()).hexdigest()}
            stem = f'{name}-{repeat}'
            audio_path = out / (stem + '.mp3')
            start = time.perf_counter()
            try:
                if args.local:
                    with tempfile.TemporaryDirectory() as directory:
                        parts, _, _, synth = tts.generate_parts(lines, 'kokoro', 'af_heart', '', 1, Path(directory), True)
                        durations = [tts.ffprobe_duration(part) for part in parts]
                        tts.concat_mp3s(parts, str(audio_path))
                        at = 0; entries = []
                        for i, (text, duration) in enumerate(zip(lines, durations)):
                            entries.append({'index': i, 'text': text, 'start_s': at, 'end_s': at+duration, 'duration_s': duration}); at += duration
                        timestamps = {'total_duration_s': at, 'subtitles': entries}
                        row['metrics'] = {'synthesis_seconds': synth, 'audio_seconds': at, 'real_time_factor': synth / at}
                else:
                    data, headers = request(args.url, f'/v1/audio/narrations?slot={args.slot}', {'model': 'kokoro', 'voice': 'af_heart', 'input': lines})
                    audio_path.write_bytes(base64.b64decode(data['audio']['base64'], validate=True))
                    timestamps = data['timestamps']; row['metrics'] = data['metrics']
                    row['container_seconds'] = float(headers.get('X-Speech-Container-Seconds', headers.get('x-speech-container-seconds', '0')))
                row['end_to_end_seconds'] = time.perf_counter() - start
                row['audio_validation'] = validate_audio(audio_path, timestamps)
                (out / (stem + '.json')).write_text(json.dumps(timestamps, indent=2))
            except Exception as exc:
                row['error'] = str(exc)
                row['end_to_end_seconds'] = time.perf_counter() - start
            report['rows'].append(row)
            (out / 'results.json').write_text(json.dumps(report, indent=2))
            print(json.dumps(row), flush=True)
            if name == 'short' and not cold and repeat == args.repeats - 1 and args.max_rtf > 0 and row.get('metrics', {}).get('real_time_factor', 0) > args.max_rtf:
                report['aborted_reason'] = 'Short warm trials exceeded maximum RTF; longer workloads skipped'
                break
        summary = {}
        for name in cases:
            rows = [r for r in report['rows'] if r['case'] == name and not r['cold'] and 'error' not in r]
            if rows:
                values = sorted(r['end_to_end_seconds'] for r in rows)
                summary[name] = {'n': len(values), 'median_seconds': statistics.median(values), 'max_seconds': max(values),
                                 'median_rtf': statistics.median(r['metrics']['real_time_factor'] for r in rows)}
        report['summary'] = summary
        (out / 'results.json').write_text(json.dumps(report, indent=2))
    finally:
        if args.local: tts.stop_kokoro_worker()
        else: request(args.url, '/admin/stop', {'slot': args.slot})


if __name__ == '__main__':
    main()
