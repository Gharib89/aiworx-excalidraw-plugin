---
model: claude-sonnet-5
runs: 1
max_turns: 150
timeout_seconds: 2700
allowed_tools: ["Bash(node:*)", "Bash(mkdir:*)", "Read", "Write", "Edit", "Glob", "Grep", "Skill", "Task"]
---
For the security review doc, draw where things run. Inside our AWS account there is a VPC with two subnets: the public subnet holds an ALB and a NAT gateway; the private subnet holds the EKS cluster running the API pods and the worker pods, plus an RDS Postgres instance and an ElastiCache Redis. Outside the VPC but still in our account: S3 buckets for uploads and Secrets Manager. Outside AWS entirely: the customer's browser hitting the ALB, Auth0 which the API calls for token validation, and SendGrid which the workers call for email. Show which components talk to which and make the trust boundaries obvious. Audience: the security reviewer and the platform team (doc-wide).
