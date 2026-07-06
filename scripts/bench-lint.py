#!/usr/bin/env python3
"""Benchmark lint-subtitles.py against every real session script.

Usage:
  python3 scripts/bench-lint.py <candidate.py> [baseline] [--save results.json]

`baseline` is either another linter .py (it gets run too) or a results .json
saved from an earlier run. Runs each linter over every
~/.manimate/sessions/*/project/script.py with cwd set to the project dir
(scripts read timestamps.json relative to cwd).

With a baseline, paired safety checks gate the result: the candidate must not
lose a flagged file, report fewer findings, verify fewer subtitles, or crash
more scenes on ANY file the baseline handled. Exit 1 on regression.
"""

import concurrent.futures
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

SESSIONS = Path(os.environ.get("MANIMATE_LOCAL_ROOT", Path.home() / ".manimate")) / "sessions"


def run_one(linter, script):
    start = time.time()
    try:
        proc = subprocess.run(
            [sys.executable, linter, "script.py"],
            cwd=script.parent, capture_output=True, text=True, timeout=120,
        )
        out = proc.stdout + proc.stderr
        code = proc.returncode
    except subprocess.TimeoutExpired:
        out, code = "", -1
    summary = re.search(r"No issues found \((\d+) subtitles in \d+ scenes\)", out)
    return {
        "exit": code,
        "crashed": len(re.findall(r"^Warning: Error", out, re.M)),
        "findings": len(re.findall(r"^  (?:Overlap|Overflow):", out, re.M)),
        "subs": int(summary.group(1)) if summary else None,
        "secs": round(time.time() - start, 3),
    }


def bench(linter, scripts):
    linter = str(Path(linter).resolve())  # run_one changes cwd per project
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(run_one, linter, s): s for s in scripts}
        for future in concurrent.futures.as_completed(futures):
            results[futures[future].parent.parent.name] = future.result()
    return results


def metrics(results):
    vals = list(results.values())
    return {
        "files flagged (exit 1)": sum(v["exit"] == 1 for v in vals),
        "hard errors (exit 2 / timeout)": sum(v["exit"] not in (0, 1) for v in vals),
        "files with unchecked scenes": sum(v["crashed"] > 0 for v in vals),
        "crashed scene simulations": sum(v["crashed"] for v in vals),
        "findings reported": sum(v["findings"] for v in vals),
        "subtitles verified (clean files)": sum(v["subs"] or 0 for v in vals),
        "lint cpu seconds (sum)": round(sum(v["secs"] for v in vals), 1),
    }


def safety(base, cand):
    shared = set(base) & set(cand)
    checks = {
        "detections lost": [s for s in shared if base[s]["exit"] == 1 and cand[s]["exit"] != 1],
        "new hard errors": [s for s in shared if cand[s]["exit"] not in (0, 1)
                            and base[s]["exit"] in (0, 1)],
        "fewer findings (both flag)": [s for s in shared if base[s]["exit"] == cand[s]["exit"] == 1
                                       and cand[s]["findings"] < base[s]["findings"]],
        "fewer subtitles verified": [s for s in shared
                                     if base[s]["subs"] is not None and cand[s]["subs"] is not None
                                     and cand[s]["subs"] < base[s]["subs"]],
        "more crashed scenes": [s for s in shared if cand[s]["crashed"] > base[s]["crashed"]],
    }
    ok = True
    for label, sids in checks.items():
        status = "ok" if not sids else "REGRESSION"
        ok &= not sids
        print(f"  {label:<32}{len(sids):>4}  {status}" + (f"  e.g. {sids[:3]}" if sids else ""))
    gained = [s for s in shared if base[s]["exit"] == 0 and cand[s]["exit"] == 1]
    print(f"  {'new detections':<32}{len(gained):>4}  {gained[:5] if gained else ''}")
    return ok


def main():
    args = [a for a in sys.argv[1:] if a != "--save"]
    save = sys.argv[sys.argv.index("--save") + 1] if "--save" in sys.argv else None
    if save in args:
        args.remove(save)
    if len(args) not in (1, 2):
        print(__doc__, file=sys.stderr)
        return 2

    scripts = sorted(SESSIONS.glob("*/project/script.py"))
    print(f"{len(scripts)} scripts from {SESSIONS}\n")

    candidate = bench(args[0], scripts)
    if save:
        Path(save).write_text(json.dumps(candidate))

    baseline = None
    if len(args) == 2:
        if args[1].endswith(".json"):
            baseline = json.loads(Path(args[1]).read_text())
        else:
            baseline = bench(args[1], scripts)

    cand_metrics = metrics(candidate)
    base_metrics = metrics(baseline) if baseline else {}
    width = max(len(k) for k in cand_metrics)
    header = f"{'metric':<{width + 2}}{'baseline':>10}{'candidate':>11}" if baseline else ""
    if header:
        print(header)
    for key, value in cand_metrics.items():
        if baseline:
            print(f"{key:<{width + 2}}{base_metrics[key]:>10}{value:>11}")
        else:
            print(f"{key:<{width + 2}}{value:>11}")

    if baseline:
        print("\nsafety checks (candidate vs baseline):")
        if not safety(baseline, candidate):
            print("\nFAIL: candidate regresses the baseline")
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
