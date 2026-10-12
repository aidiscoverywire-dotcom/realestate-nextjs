<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## realestate-nextjs: Next.js port of the Gmail/Sheets AI agent

- Stack: Next 16.4 (App Router) + TypeScript strict + Tailwind v4 + Prisma 6
  + Postgres 16 (docker-compose) + Vitest 5. See README.md for the full
  picture; HANDOFF.md carries the port status.
- House style: NO em dashes anywhere (code, UI, docs). The internal-note
  header uses an ASCII hyphen: "INTERNAL NOTE - DELETE BEFORE SENDING".
  No AI-tell words ("delve", "moreover") in copy.
- lib/ entry points: vault.ts, gmail.ts, sheets.ts, llm.ts, pipeline.ts,
  classifier.ts, extractor.ts, tenants.ts. Barrels re-export the
  subdirectory implementations.
- Tests: `npm test` (93 green). No real network or DB in tests: Google/
  Gemini clients are mocked and Prisma is mocked at the client. The
  rule-based classifier in lib/classifier.ts uses word-boundary matching
  (deliberate fix of the Python mock's "lease" in "please" substring trap).
- Quality gates before finishing: `npx tsc --noEmit`, `npm run build`,
  `npm test`, grep for em dashes, grep for secrets.
- Never push to GitHub; local git only.
