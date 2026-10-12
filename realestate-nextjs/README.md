# RealEstate Agent, Next.js Port

A Next.js 16 + TypeScript full-stack port of the Python **Gmail/Sheets AI
agent** (multi-tenant product, `~/workspace/realestate-agent`, 91/91 tests
green). Built as a portfolio piece for GitHub/Upwork to show the same
system in a React/Next.js stack.

Each tenant connects a Gmail mailbox. For every new email the pipeline:

1. **Classifies** it with the tenant's domain pack (`real_estate`:
   `lead` | `contract_update` | `rental_inquiry` | `noise`)
2. **Extracts** structured data with the pack's per-category schemas
3. **Cross-references** the tenant's Sheets (returning-lead detection,
   token-based address matching, like-for-like price comparison)
4. **Drafts** a context-aware reply **as a Gmail draft, never sent**
5. **Logs** everything to an append-only log

The pipeline, safety invariants, and runner are domain-independent; all
real-estate behavior lives in the pluggable domain pack
(`lib/domain/realEstate.ts`).

## Safety invariants (ported 1:1, enforced by tests)

- **No-send, ever.** The only Gmail write path is `drafts.create`. A
  structural test scans every `lib/` source for send call sites, and the
  client exposes no send method.
- **Draft idempotency** via per-thread draft check (re-runs reuse the
  existing draft, never create a second one).
- **Confidence gating**: below 0.7 goes to `human_review`, never processed.
  NaN/infinite/garbage confidences map to 0.0 (fail closed).
- **Halt flags** (`missing_address`, `address_ambiguous`) force human review
  even above threshold.
- **Internal notes** live in the log, never in the customer-facing draft.
  The draft carries a clearly delimited "INTERNAL NOTE - DELETE BEFORE
  SENDING" block only as a reviewer safety net, same as the Python build
  (ASCII hyphen here: this repo keeps zero em dashes).
- **Recipient from headers, never body text**: Reply-To wins only on
  domain match, otherwise From. Body text like "reply to attacker@..."
  cannot redirect the draft.
- **Append-only log**, one row per email, traceable to its source message
  ID. Rows are never updated.
- **Tenant isolation**: every table carries `tenantId`; every query is
  scoped by it. Kill-switch revokes and wipes one tenant without touching
  others.

## Stack

- Next.js 16 (App Router) + TypeScript (strict) + Tailwind CSS v4
- Prisma ORM + PostgreSQL (`docker compose up -d` for local dev)
- Google APIs via `googleapis` (Gmail + Sheets, real clients included but
  unused without credentials); Gemini via direct REST fetch (no SDK)
- Vitest for tests

## Getting started

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL and VAULT_MASTER_KEY
docker compose up -d   # local Postgres 16
npx prisma migrate dev # create tables
npm run dev            # http://localhost:3000
```

Generate a vault master key (64-char hex, never commit it):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Onboard a tenant (dashboard at `/tenants`, or the API):

```bash
curl -X POST http://localhost:3000/api/tenants \
  -H 'Content-Type: application/json' \
  -d '{"slug":"acme-realty","displayName":"Acme Realty","mailbox":"ops-agent@acme.example"}'
```

Run the pipeline for a tenant (mock Gmail/Sheets/Gemini unless
`USE_MOCKS=false` with real credentials in the vault):

```bash
curl -X POST http://localhost:3000/api/pipeline/trigger \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"<id>"}'
```

Review drafts in the dashboard (`/drafts`): approve or reject each one.
Approved drafts are sent from Gmail by a human. Nothing here sends email.

## Tests

```bash
npm test   # 93 tests, all green
```

| File | Tests | Covers |
|---|---|---|
| `test/vault-crypto.test.ts` | 8 | AES-256-GCM round-trip, random IV, wrong-key/tamper fail-closed, missing/malformed key, mask, key generation |
| `test/classifier-rules.test.ts` | 33 | Phone/price parsing, asking-price heuristic, address matching (exact/fuzzy/none, unit rules, directionals), cross-reference (returning lead, price conflict, ambiguity, appraisal gap, budget non-comparison, flag dedupe), internal block, reference resolution, data-conflict detector, mock draft |
| `test/classifier-accuracy.test.ts` | 4 | Rule-based classifier on 16 labeled fixtures (16/16), low confidence on ambiguous mail, mixed-category tie-break |
| `test/extractor.test.ts` | 9 | Rule-based field extraction per category, pack-driven validation (unknown fields dropped, bad fields nulled with warnings, deal_stage fallback, multi-property cap) |
| `test/strip-extractor.test.ts` | 8 | Quoted-history stripping, forwarded payload, recipient resolution (Reply-To domain rule), safe confidence |
| `test/pipeline.test.ts` | 9 | End-to-end lead, noise, self-mail filter, halt-flag routing, draft idempotency, model/draft failure rows, recipient-from-headers, no-send invariant |
| `test/no-send.test.ts` | 4 | Structural scan of `lib/` for send call sites, client exposes no send method, draft records have no sent state |
| `test/api-routes.test.ts` | 18 | Route validation, tenant scoping on every list route, tenant-scoped approve/reject, kill-switch ordering, trigger error mapping |

Mocks test pipeline logic, not model accuracy (same disclaimer as the
Python build: real classification/extraction accuracy is measured on the
tenant's own mail, e.g. an M1-style labeled set). No test makes a real
network call; Google/Gemini clients are mocked and the database layer is
mocked at the Prisma client.

## Project layout

```
app/                      Dashboard: Overview, Inbox, Drafts (human review),
                          Tenants, Logs
app/api/                  REST: tenants, inbox, drafts (+ approve/reject),
                          logs, pipeline/trigger
lib/classifier.ts         Rule-based domain-pack classifier (fixtures/mock)
lib/extractor.ts          Pack-driven field validation + rule-based extractor
lib/domain/realEstate.ts  Domain pack: categories, prompts, matching, flags
lib/pipeline/driver.ts    Deterministic six-stage pipeline (domain-free)
lib/pipeline/service.ts   Per-tenant wiring: driver + Prisma + clients
lib/pipeline/strip.ts     Quoted-history stripping, recipient resolution
lib/llm.ts  -> llm/       ModelClient: RealGeminiClient (REST) + mock
lib/gmail.ts -> gmail/    GmailClient: real (googleapis) + mock
lib/sheets.ts -> sheets/  SheetsClient: real (googleapis) + mock
lib/vault.ts -> vault/    AES-256-GCM crypto + per-tenant secret store
lib/tenants.ts            Tenant scoping, onboarding, kill-switch
prisma/schema.prisma      Tenant-scoped data model (tenantId on every table)
test/                     Vitest suite (93 tests)
```

## Deliberate differences from the Python build

1. **Fernet → AES-256-GCM** via `node:crypto` (no Fernet in the Node
   stdlib). Same contract: master key from `VAULT_MASTER_KEY` only,
   random 96-bit IV per encryption, 128-bit auth tag, fail-closed
   decryption. Ciphertext stored as base64 TEXT, not BYTEA.
2. **google-genai SDK → direct REST fetch** for Gemini (one less
   dependency; same model pins).
3. **Sheets as the log store → Postgres** as the system of record; the
   Sheets API remains the reference-data source (Leads/Properties tabs).
   The dashboard replaces the delegated-mailbox + log-sheet ops flow.
4. **OAuth consent CLI → roadmap.** Tenant onboarding creates the tenant
   record; the interactive Google consent flow is not yet ported.
5. **Single-threaded poller → explicit trigger** (`POST
   /api/pipeline/trigger`, cron-ready). Per-run idempotency via the unique
   `(tenantId, gmailId)` constraint.
6. **Keyword classifier hardening.** The Python mock used raw substring
   matching (`"lease" in "please"` classified as rental). The port matches
   on word boundaries with plural/verb suffixes, so "please" is not a
   lease inquiry. Documented here because the behavior differs from the
   Python mock.
7. **No em dashes anywhere** in code, UI, or docs (house style). The
   internal-note header reads "INTERNAL NOTE - DELETE BEFORE SENDING".

## Roadmap (honest scope, not faked)

- Real Gmail polling via cron (History API + checkpoint)
- Sheets write-back for the append-only log (mirror of the DB log)
- Google OAuth consent flow in the dashboard
- Retry/dead-letter passes from the log scan
- More domain packs (each needs its own accuracy proof on real data)
- Attachment (PDF) parsing

## License

Private portfolio build. The Python original it ports is the author's own
work.
