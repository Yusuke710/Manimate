#!/usr/bin/env python3
"""
TTS generator for Manim voiceover pipeline.

Reads SubtitleSpec from plan.md, generates per-subtitle MP3s via Kokoro or ElevenLabs,
measures exact durations with ffprobe, concatenates to voiceover.mp3,
and writes timestamps.json.

Usage:
    python tts-generate.py --plan plan.md
    python tts-generate.py --plan plan.md --provider kokoro --voice af_heart
    python tts-generate.py --plan plan.md --provider elevenlabs --voice-id <id>
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import socket
import socketserver
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from pathlib import Path

DEFAULT_KOKORO_VOICE_ID = "af_heart"  # matches src/lib/voices.ts DEFAULT_VOICE_ID
DEFAULT_ELEVENLABS_VOICE_ID = "Lci8YeL6PAFHJjNKvwXq"
ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5"
KOKORO_MODEL_ID = "hexgrad/Kokoro-82M"
ELEVENLABS_MAX_WORKERS = 5
KOKORO_DEFAULT_WORKERS = 1
KOKORO_WORKER_IDLE_TTL_S = 600
KOKORO_WORKER_CONNECT_TIMEOUT_S = 1
KOKORO_WORKER_SYNTH_TIMEOUT_S = 600
KOKORO_WORKER_PROTOCOL_VERSION = 1
CACHE_DIR = Path(".tts-cache")
KOKORO_LANG_CODES = {"a", "b", "e", "f", "h", "i", "j", "p", "z"}
_KOKORO_PIPELINES = {}


def cache_path(text: str, provider: str, voice_id: str, cache_dir: Path = CACHE_DIR) -> Path:
    model_id = KOKORO_MODEL_ID if provider == "kokoro" else ELEVENLABS_MODEL_ID
    obj: dict = {"provider": provider, "model_id": model_id, "text": text, "voice_id": voice_id}
    if provider == "kokoro":
        obj["speed"] = os.environ.get("KOKORO_SPEED", "1")
    canonical = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    key = hashlib.sha256(canonical.encode()).hexdigest()
    return cache_dir / f"{key}.mp3"


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


def normalize_provider_and_voice(provider: str, voice_id: str | None) -> tuple[str, str]:
    voice = (voice_id or "").strip()
    requested_provider = provider.strip().lower()

    if ":" in voice:
        prefix, value = voice.split(":", 1)
        if prefix in {"kokoro", "elevenlabs"}:
            voice = value
            if requested_provider == "auto":
                requested_provider = prefix

    if not voice:
        voice = DEFAULT_KOKORO_VOICE_ID if requested_provider != "elevenlabs" else DEFAULT_ELEVENLABS_VOICE_ID

    if requested_provider == "auto":
        # Existing Manimate sessions stored ElevenLabs IDs as 8-64 char alphanumeric strings.
        # Kokoro voices use names like af_heart, am_adam, bf_emma, etc.
        requested_provider = "elevenlabs" if re.fullmatch(r"[A-Za-z0-9]{8,64}", voice) else "kokoro"

    if requested_provider not in {"kokoro", "elevenlabs"}:
        sys.exit(f"Error: unsupported TTS provider {requested_provider!r}")

    return requested_provider, voice


def kokoro_lang_code_for_voice(voice_id: str) -> str:
    lang_code = voice_id[:1].lower()
    return lang_code if lang_code in KOKORO_LANG_CODES else "a"


def get_kokoro_pipeline(lang_code: str):
    pipeline = _KOKORO_PIPELINES.get(lang_code)
    if pipeline is not None:
        return pipeline

    try:
        from kokoro import KPipeline
    except ImportError as e:
        raise RuntimeError(
            "Kokoro is not installed. Install it locally with: "
            "pip install 'kokoro>=0.9.4' soundfile"
        ) from e

    pipeline = KPipeline(lang_code=lang_code, repo_id=KOKORO_MODEL_ID, device="cpu")
    _KOKORO_PIPELINES[lang_code] = pipeline
    return pipeline


def synthesize_kokoro_mp3(text: str, voice_id: str, out_path: Path) -> None:
    lang_code = kokoro_lang_code_for_voice(voice_id)
    pipeline = get_kokoro_pipeline(lang_code)
    speed = float(os.environ.get("KOKORO_SPEED", "1"))
    generator = pipeline(text, voice=voice_id, speed=speed, split_pattern=r"\n+")
    write_kokoro_mp3([result.audio for result in generator], out_path)


def write_kokoro_mp3(audio_chunks, out_path: Path) -> None:
    try:
        import numpy as np
        import soundfile as sf
    except ImportError as e:
        raise RuntimeError("Kokoro output requires numpy and soundfile") from e

    if not audio_chunks:
        raise RuntimeError("Kokoro returned no audio")

    chunks = []
    for audio in audio_chunks:
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        chunks.append(np.asarray(audio, dtype=np.float32))

    audio_out = chunks[0] if len(chunks) == 1 else np.concatenate(chunks)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav_path = f.name
    try:
        sf.write(wav_path, audio_out, 24000)
        subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path, "-codec:a", "libmp3lame", "-q:a", "2", str(out_path)],
            check=True, capture_output=True,
        )
    finally:
        if os.path.exists(wav_path):
            os.unlink(wav_path)


def synthesize_kokoro_batch_mp3(items: list[tuple[int, str, Path]], voice_id: str) -> dict[int, str]:
    if not items:
        return {}

    lang_code = kokoro_lang_code_for_voice(voice_id)
    pipeline = get_kokoro_pipeline(lang_code)
    speed = float(os.environ.get("KOKORO_SPEED", "1"))
    texts = [text for _, text, _ in items]
    text = "\n".join(texts)
    audio_by_position = {i: [] for i in range(len(items))}

    generator = pipeline(text, voice=voice_id, speed=speed, split_pattern=r"\n+")
    for result in generator:
        _, _, audio = result
        audio_by_position[result.text_index].append(audio)

    paths_by_index = {}
    for position, (index, _, out_path) in enumerate(items):
        write_kokoro_mp3(audio_by_position[position], out_path)
        paths_by_index[index] = str(out_path)
    return paths_by_index


def kokoro_worker_socket_path() -> Path:
    configured = os.environ.get("KOKORO_WORKER_SOCKET", "").strip()
    if configured:
        return Path(configured)
    user_id = os.getuid() if hasattr(os, "getuid") else "user"
    return Path(tempfile.gettempdir()) / f"manimate-kokoro-{user_id}.sock"


def kokoro_worker_log_path() -> Path:
    root = Path(os.environ.get("MANIMATE_LOCAL_ROOT", Path.home() / ".manimate"))
    return root / "logs" / "kokoro-worker.log"


def send_kokoro_worker_request(request: dict, timeout_s: float) -> dict | None:
    socket_path = kokoro_worker_socket_path()
    if not socket_path.exists():
        return None
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(timeout_s)
            client.connect(str(socket_path))
            payload = json.dumps(request, separators=(",", ":")).encode() + b"\n"
            client.sendall(payload)
            with client.makefile("rb") as reader:
                line = reader.readline()
        if not line:
            return None
        response = json.loads(line.decode())
        return response if isinstance(response, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def kokoro_worker_identity() -> dict:
    return {
        "protocol": KOKORO_WORKER_PROTOCOL_VERSION,
        "script": os.path.abspath(__file__),
        "python": sys.executable,
    }


def is_healthy_kokoro_worker() -> bool:
    response = send_kokoro_worker_request({"cmd": "status"}, KOKORO_WORKER_CONNECT_TIMEOUT_S)
    if not response or not response.get("ok"):
        return False
    identity = response.get("identity")
    if not isinstance(identity, dict):
        return False
    return (
        identity.get("protocol") == KOKORO_WORKER_PROTOCOL_VERSION
        and identity.get("python") == sys.executable
        and response.get("kokoro_available") is True
    )


def stop_kokoro_worker() -> None:
    send_kokoro_worker_request({"cmd": "shutdown"}, KOKORO_WORKER_CONNECT_TIMEOUT_S)
    try:
        kokoro_worker_socket_path().unlink()
    except FileNotFoundError:
        pass
    except OSError:
        pass


def start_kokoro_worker() -> bool:
    if is_healthy_kokoro_worker():
        return True

    socket_path = kokoro_worker_socket_path()
    if socket_path.exists():
        stop_kokoro_worker()
    try:
        socket_path.unlink()
    except FileNotFoundError:
        pass
    except OSError:
        return False

    log_path = kokoro_worker_log_path()
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = open(log_path, "ab", buffering=0)
    except OSError:
        log_file = subprocess.DEVNULL

    cmd = [
        sys.executable,
        os.path.abspath(__file__),
        "--kokoro-worker",
        "--socket",
        str(socket_path),
        "--idle-ttl",
        str(KOKORO_WORKER_IDLE_TTL_S),
    ]
    try:
        subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=log_file,
            start_new_session=True,
            close_fds=True,
        )
    except OSError:
        return False

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if is_healthy_kokoro_worker():
            return True
        time.sleep(0.1)
    return False


def restart_kokoro_worker() -> bool:
    stop_kokoro_worker()
    return start_kokoro_worker()


def prewarm_kokoro_worker(voice_id: str) -> bool:
    if os.environ.get("KOKORO_DISABLE_WORKER") == "1":
        return False
    if not start_kokoro_worker():
        return False
    request = {"cmd": "warm", "voice": voice_id, "speed": os.environ.get("KOKORO_SPEED", "1")}
    response = send_kokoro_worker_request(request, KOKORO_WORKER_SYNTH_TIMEOUT_S)
    if response and response.get("ok"):
        return True
    if not restart_kokoro_worker():
        return False
    response = send_kokoro_worker_request(request, KOKORO_WORKER_SYNTH_TIMEOUT_S)
    return bool(response and response.get("ok"))


def synthesize_kokoro_batch_with_worker(items: list[tuple[int, str, Path]], voice_id: str) -> dict[int, str] | None:
    if not items or os.environ.get("KOKORO_DISABLE_WORKER") == "1":
        return None
    if not start_kokoro_worker():
        return None

    request = {
        "cmd": "synthesize",
        "voice": voice_id,
        "speed": os.environ.get("KOKORO_SPEED", "1"),
        "items": [
            {"index": index, "text": text, "path": str(out_path.resolve())}
            for index, text, out_path in items
        ],
    }
    response = send_kokoro_worker_request(request, KOKORO_WORKER_SYNTH_TIMEOUT_S)
    if response and not response.get("ok") and restart_kokoro_worker():
        response = send_kokoro_worker_request(request, KOKORO_WORKER_SYNTH_TIMEOUT_S)
    if not response or not response.get("ok"):
        return None
    paths = response.get("paths")
    if not isinstance(paths, dict):
        return None
    return {int(index): str(path) for index, path in paths.items()}


def run_kokoro_worker(socket_path: Path, idle_ttl_s: int) -> None:
    try:
        socket_path.unlink()
    except FileNotFoundError:
        pass

    state = {"last_used": time.monotonic()}

    class KokoroWorkerHandler(socketserver.StreamRequestHandler):
        def handle(self) -> None:
            line = self.rfile.readline()
            try:
                request = json.loads(line.decode())
                if not isinstance(request, dict):
                    raise ValueError("request must be an object")
                response = handle_kokoro_worker_request(request)
            except Exception as e:
                response = {"ok": False, "error": str(e)}
            self.wfile.write(json.dumps(response, separators=(",", ":")).encode() + b"\n")

    def handle_kokoro_worker_request(request: dict) -> dict:
        cmd = request.get("cmd")
        if cmd in {"ping", "status"}:
            return {
                "ok": True,
                "identity": kokoro_worker_identity(),
                "kokoro_available": importlib.util.find_spec("kokoro") is not None,
                "warmed": sorted(_KOKORO_PIPELINES.keys()),
                "idle_ttl_s": idle_ttl_s,
                "seconds_since_use": time.monotonic() - state["last_used"],
            }
        if cmd == "shutdown":
            state["last_used"] = 0
            return {"ok": True}

        voice_id = str(request.get("voice") or DEFAULT_KOKORO_VOICE_ID)
        os.environ["KOKORO_SPEED"] = str(request.get("speed") or "1")
        started = time.perf_counter()

        if cmd == "warm":
            synthesize_kokoro_batch_mp3(
                [(0, "Ready.", Path(tempfile.gettempdir()) / "manimate-kokoro-warmup.mp3")],
                voice_id,
            )
        elif cmd == "synthesize":
            raw_items = request.get("items")
            if not isinstance(raw_items, list):
                raise ValueError("items must be a list")
            items = []
            for item in raw_items:
                if not isinstance(item, dict):
                    raise ValueError("item must be an object")
                items.append((int(item["index"]), str(item["text"]), Path(str(item["path"]))))
            paths = synthesize_kokoro_batch_mp3(items, voice_id)
            state["last_used"] = time.monotonic()
            return {"ok": True, "elapsed_s": time.perf_counter() - started, "paths": paths}
        else:
            raise ValueError(f"unsupported command: {cmd}")

        state["last_used"] = time.monotonic()
        return {"ok": True, "elapsed_s": time.perf_counter() - started}

    class KokoroUnixServer(socketserver.UnixStreamServer):
        allow_reuse_address = True

    with KokoroUnixServer(str(socket_path), KokoroWorkerHandler) as server:
        server.timeout = 1
        while time.monotonic() - state["last_used"] < idle_ttl_s:
            server.handle_request()

    try:
        socket_path.unlink()
    except FileNotFoundError:
        pass


def synthesize_elevenlabs_mp3(text: str, voice_id: str, api_key: str, out_path: Path) -> None:
    try:
        import requests
    except ImportError as e:
        raise RuntimeError("ElevenLabs provider requires requests. Install it with: pip install requests") from e

    body: dict = {"text": text, "model_id": ELEVENLABS_MODEL_ID}
    resp = None
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
    if resp is None:
        raise RuntimeError("ElevenLabs request failed")
    out_path.parent.mkdir(exist_ok=True)
    out_path.write_bytes(resp.content)


def tts_one(
    index: int,
    text: str,
    provider: str,
    voice_id: str,
    api_key: str,
    cache_dir_str: str,
    force: bool = False,
) -> tuple[int, str, bool]:
    cache_dir = Path(cache_dir_str)
    cached = cache_path(text, provider, voice_id, cache_dir)
    if force and cached.exists():
        cached.unlink()
    if cached.exists():
        return index, str(cached), True  # cache hit

    if provider == "kokoro":
        synthesize_kokoro_mp3(text, voice_id, cached)
    else:
        synthesize_elevenlabs_mp3(text, voice_id, api_key, cached)
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


def env_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    try:
        return max(1, int(value))
    except ValueError:
        return default


def generate_parts(
    subtitles: list[str],
    provider: str,
    voice_id: str,
    api_key: str,
    workers: int,
    cache_dir: Path = CACHE_DIR,
    force: bool = False,
) -> tuple[list[str], int, int, float]:
    parts: list[str] = [""] * len(subtitles)
    hits = misses = 0
    started = time.perf_counter()

    if provider == "kokoro" and workers == 1:
        missing: list[tuple[int, str, Path]] = []
        for i, text in enumerate(subtitles):
            cached = cache_path(text, provider, voice_id, cache_dir)
            if force and cached.exists():
                cached.unlink()
            if cached.exists():
                parts[i] = str(cached)
                hits += 1
                print(f"  [{i}] cached")
            else:
                missing.append((i, text, cached))

        generated = synthesize_kokoro_batch_with_worker(missing, voice_id)
        if generated is None:
            generated = synthesize_kokoro_batch_mp3(missing, voice_id)
        for idx, path in generated.items():
            parts[idx] = path
            misses += 1
            print(f"  [{idx}] done")

        return parts, hits, misses, time.perf_counter() - started

    executor_cls = ThreadPoolExecutor if provider == "elevenlabs" else ProcessPoolExecutor
    with executor_cls(max_workers=workers) as pool:
        futures = {
            pool.submit(tts_one, i, t, provider, voice_id, api_key, str(cache_dir), force): i
            for i, t in enumerate(subtitles)
        }
        for future in as_completed(futures):
            idx, path, from_cache = future.result()
            parts[idx] = path
            if from_cache:
                hits += 1
                print(f"  [{idx}] cached")
            else:
                misses += 1
                print(f"  [{idx}] done")

    return parts, hits, misses, time.perf_counter() - started


def run_kokoro_benchmark(subtitles: list[str], voice_id: str, parallel_workers: int) -> None:
    print(f"Benchmarking Kokoro sequential vs parallel. Voice: {voice_id}")
    with tempfile.TemporaryDirectory(prefix="kokoro-bench-") as tmp:
        tmp_path = Path(tmp)
        worker_sets = [1]
        if parallel_workers > 1:
            worker_sets.append(parallel_workers)

        results = []
        for workers in worker_sets:
            print(f"\nKokoro benchmark: workers={workers}")
            parts, _, _, elapsed = generate_parts(
                subtitles,
                provider="kokoro",
                voice_id=voice_id,
                api_key="",
                workers=workers,
                cache_dir=tmp_path / f"workers-{workers}",
                force=True,
            )
            durations = [ffprobe_duration(p) for p in parts]
            audio_duration = sum(durations)
            realtime_factor = elapsed / audio_duration if audio_duration > 0 else 0
            results.append((workers, elapsed, audio_duration, realtime_factor))
            print(
                f"workers={workers}: wall={elapsed:.2f}s, "
                f"audio={audio_duration:.2f}s, realtime_factor={realtime_factor:.2f}x"
            )

    if len(results) == 2:
        best = min(results, key=lambda r: r[1])
        print(f"\nFastest Kokoro setting for this plan: workers={best[0]}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate TTS voiceover from plan.md SubtitleSpec")
    parser.add_argument("--plan", default="plan.md")
    parser.add_argument("--provider", choices=["auto", "kokoro", "elevenlabs"], default=os.environ.get("TTS_PROVIDER", "auto"))
    parser.add_argument("--voice", default=None, help="TTS voice name/id (overrides provider env)")
    parser.add_argument("--voice-id", default=None, help="Legacy alias for --voice")
    parser.add_argument("--workers", type=int, default=None, help="Generation workers. Kokoro defaults to 1; ElevenLabs defaults to 5.")
    parser.add_argument("--out-audio", default="voiceover.mp3")
    parser.add_argument("--out-timestamps", default="timestamps.json")
    parser.add_argument("--prewarm-kokoro", action="store_true", help="Start and warm the local Kokoro worker, then exit")
    parser.add_argument("--kokoro-worker", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--socket", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--idle-ttl", type=int, default=KOKORO_WORKER_IDLE_TTL_S, help=argparse.SUPPRESS)
    parser.add_argument(
        "--benchmark-kokoro-parallel",
        action="store_true",
        help="Run Kokoro sequential and parallel generation in temp dirs, then print timing and exit"
    )
    parser.add_argument(
        "--bust", metavar="INDEX_OR_TEXT",
        help="Bust cache for a subtitle by 0-based index (e.g. 3) or exact text match, then exit"
    )
    args = parser.parse_args()

    if args.kokoro_worker:
        run_kokoro_worker(Path(args.socket or kokoro_worker_socket_path()), args.idle_ttl)
        return

    voice_arg = args.voice or args.voice_id or os.environ.get("TTS_VOICE_ID") or os.environ.get("ELEVENLABS_VOICE_ID")
    provider, voice_id = normalize_provider_and_voice(args.provider, voice_arg)

    if args.prewarm_kokoro:
        if provider != "kokoro":
            print(f"Skipping Kokoro prewarm for provider: {provider}")
            return
        if prewarm_kokoro_worker(voice_id):
            print(f"Kokoro worker warmed. Voice: {voice_id}")
            return
        sys.exit("Error: failed to warm Kokoro worker")

    api_key = os.environ.get("ELEVENLABS_API_KEY", "") if provider == "elevenlabs" else ""
    if provider == "elevenlabs" and not api_key:
        sys.exit("Error: ELEVENLABS_API_KEY must be set")
    default_workers = ELEVENLABS_MAX_WORKERS if provider == "elevenlabs" else env_int("KOKORO_MAX_WORKERS", KOKORO_DEFAULT_WORKERS)
    workers = max(1, args.workers or default_workers)

    subtitles = parse_subtitles(args.plan)

    if args.benchmark_kokoro_parallel:
        if provider != "kokoro":
            sys.exit("Error: --benchmark-kokoro-parallel requires --provider kokoro or a Kokoro voice")
        run_kokoro_benchmark(subtitles, voice_id, max(2, workers))
        return

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
        cp = cache_path(target, provider, voice_id)
        if cp.exists():
            cp.unlink()
            print(f"Busted cache for: {target!r}")
        else:
            print(f"No cache entry for: {target!r}")
        return
    print(f"Found {len(subtitles)} subtitle(s). Provider: {provider}. Voice: {voice_id}. Workers: {workers}. Generating TTS...")

    parts, hits, misses, generation_elapsed = generate_parts(subtitles, provider, voice_id, api_key, workers)
    print(f"  {hits} cached, {misses} generated in {generation_elapsed:.1f}s")

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
    realtime_factor = generation_elapsed / start if start > 0 else 0
    print(
        f"Done. {args.out_audio} + {args.out_timestamps} written. "
        f"Total: {start:.1f}s audio. Generation realtime factor: {realtime_factor:.2f}x"
    )


if __name__ == "__main__":
    main()
