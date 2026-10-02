# Event delivery and foreground responsiveness benchmark

Run from the repository root after `pnpm install --frozen-lockfile` and `pnpm exec turbo run build --filter=@bb/server`. This is an isolated investigation harness, not a production command. It creates and removes its own temporary database. The optional last argument must be a **closed, consistent offline SQLite snapshot**; it copies that file before opening it. Never pass a live database or a database with uncheckpointed sidecars. No payload contents are read: the snapshot supplies schema, physical layout, thread/turn metadata, and payload byte lengths. New payloads contain repeated `x` characters.

```sh
node --conditions=source --import tsx apps/server/scripts/event-delivery-benchmark.mjs 10 off /tmp/before-10.json
node --conditions=source --import tsx apps/server/scripts/event-delivery-benchmark.mjs 10 on /tmp/after-10.json
node --conditions=source --import tsx apps/server/scripts/event-delivery-benchmark.mjs 64 off /tmp/before-64.json
node --conditions=source --import tsx apps/server/scripts/event-delivery-benchmark.mjs 64 on /tmp/after-64.json
```

Repeat in reverse order for two independent processes per variant. The helper's `off` mode runs the original database path unchanged; `on` starts the production checkpointer. Both retain the connection's WAL/NORMAL settings and 1,000-page automatic checkpoint. Comparing modes on the same revision isolates the helper without copying benchmark files between revisions. For sink changes, use the same harness on both revisions with `off` in both.

The default is a fresh migrated file database, one host/project/thread/turn, and a deterministic synthetic size distribution: 950 entries of 220 bytes, 40 of 3,150, and 10 of 10,885. An offline snapshot instead supplies the latest 1,000 stored event byte lengths for its most recently updated thread. The generated JSON adjusts those lengths approximately; output reports the actual synthetic payload byte total. These datasets have different physical layouts and must be reported separately. The fresh database is reproducible without private data; private copied-database timings are corroborating evidence, not a reproducible public fixture.

Each process sends six bursts of 2,000 events (12,000 total), with 20 ms between bursts. The first argument controls how many events are emitted before awaiting `sink.flush()`. Ten is a smaller delivery size; 64 is sustained burst load. Neither is a measured production arrival rate. To investigate reconnect backlogs use 2,000, explicitly labeled synthetic backlog load. Sink batching may subdivide these chunks further.

The measured path is the real host-daemon `createEventSink` through a local HTTP POST to the real database `appendDaemonEventsInTransaction` inside an immediate transaction. It includes JSON serialization, network transport, parsing, database work, commit and acknowledged drain. The small HTTP harness does **not** include production authentication, routing, notifications, or WebSocket fanout. One sequential delivery client runs alongside a separate worker issuing alternating HTTP `/ping` and `/read` requests every 5 ms, with new connections. `/read` selects the latest 50 event metadata rows through the existing thread index. Scheduling probes on a separate worker prevents the blocked server loop from suppressing probe arrivals.

Three 10-event HTTP inserts warm the database before measurement, followed by a scratch-only WAL truncate. No application/SQLite/OS cache flush is attempted; first reads are not cold. Warmup SQL/transactions are excluded. Probes and the event-loop monitor include 50 ms of settling before delivery and 50 ms after it. Drain includes six 20 ms inter-burst waits. All variants do identical logical work.

All reported times use `performance.now()` wall time, not CPU time. SQL instrumentation measures native statement calls (including transaction-controller COMMIT), and transaction time wraps the complete synchronous database transaction. These are distinct from HTTP round-trip latency and total drain time. Statement instrumentation adds the same overhead in both modes. Node's event-loop histogram uses 1 ms resolution and its own percentile estimator.

For request, SQL and transaction arrays, percentile `p` is the sorted value at zero-based index `floor(n*p)`; maximum is the final value. Each JSON records sample counts per metric. Report ranges of each independent run's statistics, not pooled percentiles or the fastest run. At small sample counts, p99 is effectively the maximum and exploratory. `maxWalBytes` samples only after bursts, so it is an observed lower bound on the true peak, not a WAL growth guarantee. Reader-held WAL can grow with either mode until readers release.

Use an exclusive advisory lock shared with other local benchmark/build jobs. This excludes those jobs only; production services, OS caching and external host load remain uncontrolled. Do not interpret warm synthetic runs as a production latency SLO or an explanation of historical slow-query logs. Compare total drain and maximum latency as well as percentile improvements.
