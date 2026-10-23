# Dedicated cloud-test fixture — NOT DEPLOYED

Owned copy of the Phase 4 local HTTP 500 fixture, with a container-compatible `0.0.0.0:3000` listener and independent `/healthz` endpoint. No dependencies, database, disk, domain, environment secrets or external services. `PORT` may change only with the exact approved release port. Node 22+ compatible; the product's restricted test host still requires Node 26+.

`/` intentionally returns 500; `/?name=Sara` returns 200; `/healthz` returns 200. Existing regression intentionally fails until repaired in an isolated snapshot. `npm start` runs the test website locally and binds all interfaces; cloud creation and each initial/repaired deployment need separate explicit human approvals. No cloud action was performed by preparing these files.
