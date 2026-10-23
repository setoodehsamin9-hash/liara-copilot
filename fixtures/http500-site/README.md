# Local HTTP 500 regression website

This is a separate, intentionally broken local test project. It has no Liara account or cloud resources. `node server.mjs` listens on loopback 4399: `/` returns a real HTTP 500; `/?name=Sara` succeeds. Its existing regression test fails until the null-input defect is repaired. Liara Copilot snapshots this project into a separate Git worktree; it must leave this original broken fixture unchanged.
