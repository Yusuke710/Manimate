#!/usr/bin/env python3
"""
TTS generator for Manim voiceover pipeline.

Reads SubtitleSpec from plan.md, generates per-subtitle MP3s via ElevenLabs,
measures exact durations with ffprobe, concatenates to voiceover.mp3,
and writes timestamps.json.

Usage:
    python tts-generate.py --plan plan.md [--voice-id <id>]
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

DEFAULT_VOICE_ID = "Lci8YeL6PAFHJjNKvwXq"  # matches src/lib/voices.ts DEFAULT_VOICE_ID
MAX_WORKERS = 5
CACHE_DIR = Path(".tts-cache")


def cache_path(text: str, voice_id: str) -> Path:
    obj: dict = {"model_id": "eleven_turbo_v2_5", "text": text, "voice_id": voice_id}
    canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    key = hashlib.sha256(canonical.encode()).hexdigest()
    return CACHE_DIR / f"{key}.mp3"


def parse_subtitles(plan_path: str) -> list[str]:
    """
    Parse subtitles from a plan.md SubtitleSpec block.

    Expects lines prefixed with `- ` inside a subtitles: section
    (with or without a fenced code block):
        subtitles:
        - First line
        - Second line
    """
    text = Path(plan_path).read_text()
    # Strip fenced code blocks so content is always plain text
    stripped = re.sub(r"```[^\n]*\n", "", text).replace("```", "")
    # Capture everything after `subtitles:` until a non-blank, non-list line (or EOF)
    match = re.search(r"^subtitles:\s*\n(.*?)(?=\n[^\s\-\n]|\Z)", stripped, re.MULTILINE | re.DOTALL)
    if not match:
        sys.exit(f"Error: No 'subtitles:' block found in {plan_path}")
    # Collect only `- ` prefixed lines, skip blanks
    items = [re.sub(r"^[ \t]*-\s*", "", line).strip()
             for line in match.group(1).splitlines()
             if re.match(r"^[ \t]*-", line)]
    if not items:
        sys.exit("Error: Empty subtitles list in plan.md")
    return items


def tts_one(index: int, text: str, voice_id: str, api_key: str) -> tuple[int, str, bool]:
    cached = cache_path(text, voice_id)
    if cached.exists():
        return index, str(cached), True  # cache hit

    body: dict = {"text": text, "model_id": "eleven_turbo_v2_5"}
    for attempt in range(3):
        try:
            resp = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=body,
                timeout=60,
            )
            resp.raise_for_status()
            break
        except requests.HTTPError as e:
            if attempt == 2 or e.response.status_code < 500 and e.response.status_code != 429:
                raise
            time.sleep(2 ** attempt)
        except (requests.ConnectionError, requests.Timeout):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)
    CACHE_DIR.mkdir(exist_ok=True)
    cached.write_bytes(resp.content)
    return index, str(cached), False  # cache miss


def ffprobe_duration(mp3_path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", mp3_path],
        capture_output=True, text=True, check=True,
    )
    return float(result.stdout.strip())


def concat_mp3s(parts: list[str], out_path: str) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        for p in parts:
            f.write(f"file '{os.path.abspath(p)}'\n")
        list_file = f.name
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", out_path],
            check=True, capture_output=True,
        )
    finally:
        os.unlink(list_file)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate TTS voiceover from plan.md SubtitleSpec")
    parser.add_argument("--plan", default="plan.md")
    parser.add_argument("--voice-id", default=None, help="ElevenLabs voice ID (overrides env)")
    parser.add_argument("--out-audio", default="voiceover.mp3")
    parser.add_argument("--out-timestamps", default="timestamps.json")
    parser.add_argument(
        "--bust", metavar="INDEX_OR_TEXT",
        help="Bust cache for a subtitle by 0-based index (e.g. 3) or exact text match, then exit"
    )
    args = parser.parse_args()

    api_key = os.environ.get("ELEVENLABS_API_KEY", "")
    if not api_key:
        sys.exit("Error: ELEVENLABS_API_KEY must be set")
    voice_id = args.voice_id or os.environ.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID)

    subtitles = parse_subtitles(args.plan)

    if args.bust is not None:
        # Resolve by index or exact text match
        target: str | None = None
        try:
            target = subtitles[int(args.bust)]
        except (ValueError, IndexError):
            matches = [s for s in subtitles if args.bust.lower() in s.lower()]
            if not matches:
                sys.exit(f"Error: no subtitle matching {args.bust!r}")
            target = matches[0]
        cp = cache_path(target, voice_id)
        if cp.exists():
            cp.unlink()
            print(f"Busted cache for: {target!r}")
        else:
            print(f"No cache entry for: {target!r}")
        return
    print(f"Found {len(subtitles)} subtitle(s). Voice: {voice_id}. Generating TTS...")

    parts: list[str] = [""] * len(subtitles)
    hits = misses = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(tts_one, i, t, voice_id, api_key): i for i, t in enumerate(subtitles)}
        for future in as_completed(futures):
            idx, path, from_cache = future.result()
            parts[idx] = path
            if from_cache:
                hits += 1
                print(f"  [{idx}] cached")
            else:
                misses += 1
                print(f"  [{idx}] done")
    print(f"  {hits} cached, {misses} generated")

    print("Measuring durations...")
    durations = [ffprobe_duration(p) for p in parts]

    print(f"Concatenating {len(parts)} clips → {args.out_audio}")
    # ffmpeg concat needs file:// safe paths; cache files are already on disk
    concat_mp3s(parts, args.out_audio)
    # Cache files are kept on disk; no cleanup needed.

    start = 0.0
    entries = []
    for i, (text, dur) in enumerate(zip(subtitles, durations)):
        entries.append({
            "index": i, "text": text,
            "start_s": round(start, 3), "end_s": round(start + dur, 3), "duration_s": round(dur, 3),
        })
        start += dur

    result = {"total_duration_s": round(start, 3), "subtitles": entries}
    Path(args.out_timestamps).write_text(json.dumps(result, indent=2))
    print(f"Done. {args.out_audio} + {args.out_timestamps} written. Total: {start:.1f}s")


if __name__ == "__main__":
    main()
