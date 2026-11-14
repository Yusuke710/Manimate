# Workflow elapsed-time profiling

This evaluation runs the normal Manimate CLI with the original prompt and
settings. The application and Claude prompts are unchanged. A separate app
instance runs the published 0.1.28 standalone build, keeping the user's running
0.1.26 instance untouched. The repository CLI has the same 0.1.28 code and uses
its installed dependencies; directly invoking the unpacked CLI initially
failed because an extracted tarball alone has no top-level npm dependencies.
That setup attempt did not start generation and is retained separately.

The `gpt2-css` directory records the exact invocation, timestamped CLI output,
passive subprocess markers, and derived profile. The native Claude transcript
remains in the normal session's `transcripts` directory. No reasoning text is
included in the derived profile.

`analyze.py <run-directory>` matches tool calls/results by ID and unions
intervals rather than adding overlapping tasks. `tools.csv` contains the tool
ledger. `commands.jsonl` records actual speech/render/FFmpeg process boundaries,
including tasks that Claude started in the background. Command wrappers pass
arguments, stdin, stdout and stderr through and preserve exit status. Their
small process-launch overhead is included in elapsed time. Signed URLs and
credentials are not recorded by the command markers.

Claude response gaps include generation, reasoning, API/network wait, runtime
startup and orchestration; they are **not measured CPU time**. Assigning a gap
to the next tool's purpose is a heuristic. It cannot independently measure
private reasoning time versus output-token generation. Background speech and
render spans can overlap these gaps, so category totals must not be added
without accounting for overlap. WebFetch timing includes its fetch and summary
work. A single run diagnoses this workflow, not production percentiles.

Recompute the profile:

```sh
python benchmarks/workflow/analyze.py benchmarks/workflow/gpt2-css
```
