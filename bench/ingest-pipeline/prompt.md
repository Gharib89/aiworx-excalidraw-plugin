---
model: claude-sonnet-5
runs: 1
max_turns: 150
timeout_seconds: 2700
allowed_tools: ["Bash(node:*)", "Bash(mkdir:*)", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"]
---
Draw our telemetry ingestion pipeline for the platform runbook. Agents on hosts ship metrics to a Collector fleet. The Collector validates and writes raw batches to an S3 landing bucket and, in parallel, pushes to a Kafka stream. A Flink job reads the stream, enriches with host metadata from the Inventory API, and writes to ClickHouse. A nightly Spark job reads the S3 landing bucket and also writes to ClickHouse for backfill. Grafana reads ClickHouse. An Alerting service reads Flink's output directly, before ClickHouse, and also reads ClickHouse for long-window rules. Audience: on-call SREs. Full-width figure in the runbook (doc-wide).
