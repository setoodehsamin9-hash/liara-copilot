# Intentional checkout HTTP 500 baseline

Separate descendant of the Phase4 missing-input fixture; existing fixtures stay intact. Node22, no dependencies or credentials. `npm start` binds 0.0.0.0 and PORT/default3000. GET / and /health return200; GET /api/checkout without optional coupon triggers a real TypeError and returns500. Logs contain a fixed safe error event, no request values/headers/stack/environment. No runtime filesystem writes, database or external network clients; suitable for read-only root. Cloud execution is not yet verified.

`npm run test:smoke` passes characterization tests. `npm run test:regression` intentionally FAILS until later isolated Codex repair; `npm test` therefore fails on this broken baseline. Do not label it repaired/healthy. Initial deployment and later repaired deployment each require separate exact approvals. Preserve the baseline content digest/archive before repair.
