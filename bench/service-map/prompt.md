---
model: claude-sonnet-5
runs: 1
max_turns: 150
timeout_seconds: 2700
allowed_tools: ["Bash(node:*)", "Bash(mkdir:*)", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"]
---
We're documenting the checkout service for the engineering wiki. Draw the runtime picture: the public API gateway takes requests from the web app and forwards them to the Orders service and the Payments service. Orders writes to Postgres and publishes order-placed events to a Kafka topic; Payments calls Stripe and reads customer data from a Redis cache that is warmed from Postgres. A Notifications worker consumes the Kafka topic. Audience: backend engineers new to the team. It sits inline in a Markdown page (doc-inline).
