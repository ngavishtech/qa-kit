---
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
tags: [verify-coverage]
---

I have a test plan in qa-kit-artifacts/ABC-1-test-plan.md and the Playwright tests are under src/tests. Before we write anything, tell me which of the plan's scenarios are already covered by the existing tests, which are only partly covered, and which are new.
