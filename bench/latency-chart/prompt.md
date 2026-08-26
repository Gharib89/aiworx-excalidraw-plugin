---
model: claude-sonnet-5
runs: 1
max_turns: 150
timeout_seconds: 2700
allowed_tools: ["Bash(node:*)", "Bash(mkdir:*)", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"]
---
For the Q3 performance write-up, draw a chart of p95 latency before and after the caching change for our five hottest endpoints. Before → after, in ms: GET /orders 420 → 180; GET /orders/{id} 310 → 95; POST /checkout 890 → 610; GET /catalog 260 → 70; GET /me 150 → 140. Audience: engineering leadership reading the write-up inline (doc-inline).
