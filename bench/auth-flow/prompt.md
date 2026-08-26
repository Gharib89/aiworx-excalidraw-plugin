---
model: claude-sonnet-5
runs: 1
max_turns: 150
timeout_seconds: 2700
allowed_tools: ["Bash(node:*)", "Bash(mkdir:*)", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"]
---
I'm presenting how login works at the next engineering all-hands. Make a slide-ready diagram walking through it step by step: the user submits credentials in the SPA; the SPA posts to our Auth service; Auth checks the password hash in Postgres and, if MFA is on, sends a code by SMS through Twilio and waits for it; on success Auth mints a short-lived JWT plus a refresh token stored in Redis; the SPA calls the API with the JWT and the API verifies the signature locally without calling Auth; when the JWT expires the SPA silently exchanges the refresh token for a new one. Audience: all engineers, many not backend. Target the slide-16x9 preset.
