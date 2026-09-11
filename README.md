# Triage Control

Triage Control is the runnable implementation of `TECHNICAL_PRD.md`: a desktop observability app that turns a privacy-safe browser incident into a parallel RocketRide agent race, verifies the winning patch, and publishes a draft PR.

## Sponsor stack

Every sponsor technology owns a distinct stage of the live incident-to-PR path:

- **RocketRide.ai — orchestration and motion layer:** runs the parallel multi-agent pipeline and streams each agent's lifecycle, FLOW, OUTPUT, and SSE activity into the observability interface.
- **HydraDB — durable knowledge-graph memory:** stores verified incidents, relationships, fixes, and retrieval evidence across runs so similar failures compound into reusable operational knowledge.
- **hotdata.dev — live telemetry and ad-hoc query layer:** receives the shared event stream and supports live queries that compare agent activity and time-to-fix across runs.
- **Cognee.ai — memory-construction layer:** converts privacy-safe session telemetry into structured Error, UserAction, UIComponent, RootCause, and Fix entities and relationships.
- **Modiqo.ai (Rote) — muscle-memory and reliability layer:** captures successful remediation sequences as Plays and replays the method for structurally similar incidents while retaining fresh safety checks.
- **Snyk — security and judging gate:** scans the selected patch before execution or publication; discovered vulnerabilities make the candidate ineligible and prevent an unsafe draft PR.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Fill every sponsor credential in `.env` before starting the patch flow, then open `http://127.0.0.1:5173`. Every normal application run uses the live sponsor stack. Missing credentials, unavailable sponsor services, invalid receipts, Snyk errors, failed replay, or base drift fail closed and produce `needs_human`; the application never substitutes a fake success.

The current GitHub publication target is `SanjayMarathe/demo-shop` on an immutable `main` SHA. Candidate generation reads `app/api/checkout/route.ts` from that exact GitHub snapshot, and the local replay fixture must byte-match it. Cognee supports the hosted tenant API (`COGNEE_API_URL`, `COGNEE_API_KEY`, `COGNEE_TENANT_ID`) as the primary path and the Python package as a fallback when no hosted URL is configured.

### For demo purposes

For demo purposes, the target bug and replay environment are intentionally pre-seeded so the complete live sponsor pipeline can be demonstrated reliably within the hackathon timebox. Clone `https://github.com/SanjayMarathe/demo-shop`, check out the configured `GITHUB_BASE_SHA`, run `npm ci && npm run dev`, and open `http://127.0.0.1:3001`. The primary demonstration incident is the HTTP 500 produced by a valid checkout over $500.

## Demo path

1. Open **Telemetry logs**.
2. Select the terminal `network_failure` row.
3. Click **Patch with agents →**.
4. Pipeline 03 opens with Agents 1–5 feeding the Synthesizer in the interactive 3D graph.
5. Click any node. The right panel can switch between that agent's RocketRide VM console and the Synthesizer's bounded decision loop.
6. Watch the Synthesizer update proposal weights, gate the winner through Snyk and one sandbox, then create a draft-PR receipt.
7. Open **Knowledge map** to see the verified telemetry → cause → fix → PR path.

## Mandatory sponsor path

There is no application-level sponsor on/off switch. The critical path always invokes:

- RocketRide's official TypeScript SDK and `TASK`, `SUMMARY`, `FLOW`, `OUTPUT`, and `SSE` observability events.
- HydraDB exact/hybrid recall and durable verified-incident ingestion.
- Cognee through `scripts/cognee_ingest.py`.
- Modiqo/Rote through the pinned Play CLI contract.
- Snyk Code through the CLI.
- hotdata.dev append microbatches and query-ready event rows.
- GitHub branch, content commit, and draft pull-request publication.

Set `GITHUB_BASE_SHA` to the immutable demo-repository base used to generate candidates; a changed branch head is rejected before publication.

### Local Rote Play

The remediation method is a real, repository-local Rote Play at `rote/triage-remediation/main.ts`. `ROTE_PLAY_URI` is intentionally a local target: use `rote play info` for its local contract and `rote play run` for execution. Setup does not reserve a registry handle or publish anything.

```bash
rote deps check rote/triage-remediation/deps.toml
rote play info triage-remediation --json -d ./rote/triage-remediation
rote play run ./rote/triage-remediation/main.ts \
  incident_id=INC-DEMO \
  error_shape=checkout.receipt.undefined \
  patch_hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  snyk_status=clean \
  replay_status=passed \
  --output=json
```

The Play fails closed unless the exact candidate has both a clean Snyk status and a passed replay status. Its parameters and output contain no credentials or raw keystroke content. Keep the target local for the hackathon; publishing can be a later, explicit decision.

Automated tests run deterministic sponsor stand-ins only because Vitest sets `NODE_ENV=test`. Those stand-ins are unreachable from a normal development or production server.

## Verification

```bash
npm test
npm run build
```

The RocketRide pipeline is at `pipeline/triage.pipe`. Open it with the RocketRide VS Code extension and validate it against the provider set available in your engine before the event.
