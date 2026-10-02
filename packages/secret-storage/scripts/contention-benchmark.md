# Concurrent secret creation benchmark

From the repository root after `pnpm install --frozen-lockfile`:

```sh
node --import tsx packages/secret-storage/scripts/contention-benchmark.mjs 2 200
node --import tsx packages/secret-storage/scripts/contention-benchmark.mjs 8 200
```

The first argument is concurrent child processes, the second measured rounds. Each round uses a new temporary directory and synchronizes already-started children through IPC before they call the real `readOrCreateSecretFile` with32randombytes encoded as base64. Two creators represent the smallest race; eight is synthetic startup contention. No production files or secrets are used. Children send only digests for equality comparison; the report includes neither digests nor secret values. Children and all temporary data are removed afterwards.

Ten warmup rounds are excluded. Operation latency is each child's `performance.now()` elapsed wall time around the complete API call (including mkdir, reads, random generation, file creation, publication and cleanup). Round latency is the parent wall time from sending IPC messages until every child responds; process-launch time is excluded. The benchmark reports failed calls, rounds with any failure, disagreements among successful readers, and temporary-file leaks. Failed calls are included in baseline latency statistics: returning an error quickly is not successful startup throughput.

Percentile `p` is sorted zero-based index `floor(n*p)`; maximum is the last sample. Report failure totals across runs, but ranges of per-run latency statistics, not pooled percentiles. For200rounds, p99 reflects only the top few samples and is exploratory. Files are new each round; filesystem/OS caches are not flushed and must not be described as cold.

Use three independent process groups per revision and client count, in order before/after/after/before/before/after. On the baseline revision, copy this same script into the same relative path so it imports that revision's implementation. Run the groups serially under the shared host benchmark lock. The lock excludes participating heavyweight jobs, not unrelated services or OS load.

This is a load-reliability benchmark: the fix is expected to eliminate partial-publication failures, with additional filesystem operations during first creation. It is not a claim that authentication or normal existing-secret reads become faster. Production failure frequency is unknown; synchronized creation deliberately increases contention.
