# kanban-custom

Single-board, single-user kanban on Cloudflare Workers. Svelte 5 SPA + one SQLite-backed
Durable Object (`BoardRoom`) with Hibernation WebSockets for live multi-device sync.

Features: columns (collapsible, renameable), items with title / description / optional
deadline (YYYY-MM-DD) / color, drag & drop.

## Layout

```
src/worker.ts       entry: API-key auth (timing-safe), /api/board, /ws -> DO, rest -> assets
src/board-room.ts   DurableObject: SQLite storage, WS hibernation, op validation + broadcast
src/shared/         types + op validation shared by client and server
src/app/            Svelte 5 SPA (Vite root)
tests/              integration tests (vitest-pool-workers, real workerd + DO)
```

## Commands

```
npm install
npm run dev          # vite dev (proxies /api + /ws to wrangler dev on :8787)
npm run dev:backend  # wrangler dev (serves UI + API + real DO)
npm run build        # vite build -> dist/
npm test             # build, then integration tests
npm run deploy       # build + wrangler deploy
```

## Auth

One API key, checked on every API request and the WS handshake.

- local dev: `cp .dev.vars.example .dev.vars` (set your own key)
- production: `wrangler secret put API_KEY`
- HTTP: `Authorization: Bearer <key>`; WS: `?key=<key>` (browsers can't set WS headers)

## Ops protocol

Client sends `{...op}` over WS; the DO validates (`src/shared/validate.ts`), applies it to
SQLite, and broadcasts the full board snapshot to every connected socket. Clients also
apply ops optimistically and reconcile on the next snapshot. Unknown `/api/*` paths 404
instead of serving the SPA.

## Deploy

```
npx wrangler secret put API_KEY
npm run deploy
```

Local dev state lives in `.wrangler/` (gitignored) and is wiped by deleting that folder.
