# HANDOFF, realestate-nextjs

Next.js 16 + TypeScript full-stack port of the Python `realestate-agent`
(Gmail/Sheets AI agent, multi-tenant). Working project at
`~/workspace/realestate-nextjs/`. Local git repo, clean tree, NOT pushed.

## What was ported

- **Domain pack** (`lib/domain/realEstate.ts`): categories
  (lead|contract_update|rental_inquiry|noise), stages, flags, halt/block
  flags, all three LLM prompts (meaning preserved; em dashes replaced per
  house style), extraction schemas, token-based address matching
  (house-number gate, Jaccard >= 0.8, unit rules, city/zip confirmer),
  returning-lead detection, like-for-like price comparison (asking-price
  heuristic), appraisal-gap detection, internal-block renderer, mock draft
  template, counterparty reference fallback, data-conflict detector.
- **Classifier** (`lib/classifier.ts`): standalone rule-based classifier
  extracted from the old inline mock. Word-boundary matching (fixes the
  Python mock's "lease" in "please" substring trap); single-hint mail
  scores below the 0.7 gate so ambiguous mail goes to human review.
- **Extractor** (`lib/extractor.ts`): pack-driven field validation moved
  out of the driver (unknown fields dropped, invalid nulled with warnings,
  deal_stage falls back to "unknown") plus the rule-based extractor used
  by the mock client.
- **Pipeline driver** (`lib/pipeline/driver.ts`): the deterministic six
  stages (ingest, classify, extract, cross-ref, draft, log), self-mail
  filter, confidence gating (NaN-safe), noise path, halt-flag routing,
  idempotent draft creation, fail-safe error rows (never raises),
  From-header contact fallback, recipient resolution in code.
- **Vault** (`lib/vault/` + `lib/vault.ts` barrel): AES-256-GCM per-tenant
  secret store (DB-backed), rotation, kill-switch (revoke + wipe), masked
  inventory.
- **Clients** (`lib/gmail.ts`, `lib/sheets.ts`, `lib/llm.ts` barrels):
  Gmail (real via googleapis + mock), Sheets (real + mock, RAW writes with
  formula-injection sanitization), Gemini (direct REST + rule-based mock).
- **Tenants** (`lib/tenants.ts`): tenant scoping helpers, onboarding,
  kill-switch ordering (revoke, wipe, delete).
- **Service wiring** (`lib/pipeline/service.ts`): per-tenant isolated
  stacks, Prisma persistence for emails/drafts/logs, sheet-cache for
  reference rows in mock mode, idempotent trigger.
- **API routes**: tenants (create/list/get/kill-switch DELETE), inbox,
  drafts (list + tenant-scoped approve/reject), logs, pipeline trigger.
- **Dashboard** (App Router, Tailwind): Overview stats, Inbox table with
  category badges, Drafts human-review queue with approve/reject and
  internal notes, Tenants onboarding, Logs table.

## Test count: 93/93 green (Vitest, 8 files)

- vault-crypto (8), classifier-rules (33), classifier-accuracy (4),
  extractor (9), strip-extractor (8), pipeline (9), no-send (4),
  api-routes (18).

Also verified: `npx tsc --noEmit` clean, `npm run build` succeeds
(13 routes). No em dashes in any file (grep-verified). No real
credentials; `.env.example` has placeholders only. Tests make zero real
network calls and use a mocked Prisma client (pg-mem was available but
unnecessary; the task allowed falling back to clean mocks).

## Deliberate differences (documented in README)

Fernet to AES-256-GCM, google-genai SDK to direct REST, Sheets log store to
Postgres system of record, OAuth CLI to roadmap, single-threaded poller to
explicit cron-ready trigger, keyword classifier hardened to word-boundary
matching, zero em dashes everywhere.

## Descoped (honest, marked roadmap, never faked)

- Google OAuth consent flow (onboarding creates the DB record only)
- Real Gmail polling cron (History API + checkpoint); trigger is manual
- Sheets write-back of the append-only log (DB is the log)
- Retry/dead-letter passes, attachment (PDF) parsing
- Additional domain packs (only real_estate ships, like Python v3.0)
- Prisma migrate has not been run against a live database here (schema
  written; run `npx prisma migrate dev` with Postgres up)

## Suggested next phases

1. `docker compose up -d` then `npx prisma migrate dev` + seed script
   (demo tenant + mock reference rows)
2. OAuth consent flow in the dashboard (store tokens in the vault)
3. Cron trigger (Vercel Cron or similar) calling `/api/pipeline/trigger`
4. Sheets log mirror + retry/dead-letter passes
5. E2E test with dockerized Postgres
