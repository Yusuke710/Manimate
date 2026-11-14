# Kokoro speech benchmark

Uncached jobs using the same narration and `af_heart` voice. Times include audio download and exclude validation. Three warm trials per workload unless indicated. RTF is synthesis time divided by audio duration; lower is better.

| Configuration | Workload | Trials | Audio seconds | Median total seconds | Max total seconds | Median synthesis RTF |
|---|---|---:|---:|---:|---:|---:|
| local-m2-idle | short | 3 | 7.3 | 3.99 | 4.49 | 0.503 |
| local-m2-idle | medium | 3 | 50.2 | 28.05 | 28.73 | 0.528 |
| local-m2-idle | technical | 3 | 65.8 | 30.10 | 35.45 | 0.439 |
| local-m2-idle | long | 3 | 166.1 | 95.57 | 127.26 | 0.551 |
| cloud-fp32-t2-bootstrap | short | 3 | 6.8 | 3.54 | 3.80 | 0.487 |
| cloud-fp32-t2-bootstrap | medium | 3 | 46.8 | 22.52 | 23.09 | 0.471 |
| cloud-fp32-t2-bootstrap | technical | 3 | 63.4 | 29.01 | 29.26 | 0.449 |
| cloud-fp32-t2-bootstrap | long | 3 | 156.9 | 71.72 | 72.57 | 0.451 |
| cloud-int8-t1-bootstrap | short | 3 | 6.8 | 19.21 | 20.04 | 2.765 |
| cloud-int8-t2-bootstrap | short | 3 | 6.8 | 17.30 | 19.49 | 2.472 |
| cloud-fp32-4cpu-t2 | short | 3 | 6.8 | 9.33 | 9.76 | 1.267 |
| cloud-fp32-4cpu-t4-auth | short | 3 | 6.8 | 2.69 | 2.84 | 0.328 |
| cloud-fp32-4cpu-t4-auth | medium | 3 | 46.8 | 15.54 | 15.68 | 0.319 |
| cloud-fp32-4cpu-t4-auth | technical | 3 | 63.4 | 20.28 | 20.91 | 0.309 |
| cloud-fp32-4cpu-t4-auth | long | 3 | 156.9 | 50.77 | 51.06 | 0.312 |

## Cold starts and failures

- local-m2-idle: cold short requests 13.66s, 14.91s, 15.93s; 0 failures out of 15 requests.
- cloud-fp32-t2-bootstrap: cold short requests 9.59s; 0 failures out of 13 requests.
- cloud-int8-t1-bootstrap: cold short requests 30.42s; 0 failures out of 4 requests.
- cloud-int8-t2-bootstrap: cold short requests 29.39s; 0 failures out of 4 requests.
- cloud-fp32-4cpu-t2: cold short requests 31.67s; 0 failures out of 4 requests.
- cloud-fp32-4cpu-t4-auth-failed: cold short requests no successful samples; 15 failures out of 15 requests.
- cloud-fp32-4cpu-t4: cold short requests no successful samples; 15 failures out of 15 requests.
- cloud-fp32-4cpu-t4-auth: cold short requests 8.46s, 6.27s, 8.25s; 0 failures out of 15 requests.

## Cost interpretation

Results identify the tested instance type. standard-3 has 2 vCPU/8 GiB/16 GB; standard-4 has 4 vCPU/12 GiB/20 GB. Using published marginal rates, estimate compute as CPU-seconds × $0.000020 plus container-seconds × (RAM GiB × $0.0000025 + disk GB × $0.00000007). The two-minute idle window adds about $0.00253 (standard-3) or $0.00377 (standard-4) per isolated burst before CPU, Workers, Durable Objects and egress. CPU metrics measure Python process CPU during synthesis only; they exclude model load, encoding and platform overhead. This is an estimate, not an invoice. Included allowances may reduce the bill.

Source: https://developers.cloudflare.com/containers/platform/pricing/

## Limits of this evaluation

Small samples do not establish production p95 or multi-user capacity. The PyTorch and ONNX pipelines use the same text and voice but different tokenization/trimming, so generated durations differ; compare both elapsed time and RTF. Cloud host variation can materially affect speed. Cold tests deliberately stop a container; they do not force every possible host/image-cache condition. Audio checks establish decodability, non-silence and timestamp continuity, not perceptual quality or pronunciation accuracy. Retain the MP3s for listening.
