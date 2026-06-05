# Agent Workflow

This repository is a TypeScript card game prototype with two deploy targets:

- Cloudflare Worker backend: `worker/`, deployed by `npx wrangler deploy`.
- Cloudflare Pages frontend: `web/`, deployed from `web/dist`.

Read this file before making changes. Keep changes scoped, runnable, and ready for Cloudflare CI/CD.

## Development Flow

- Use feature branches for meaningful work. `main` is the production deploy branch.
- Before merging or pushing production changes, run:
  - `npm run build`
  - `npm test`
- If only the frontend changed, at minimum run `npm run build:pages`.
- If the Worker, shared protocol, or game authority logic changed, run:
  - `npm run build:worker`
  - `npx wrangler deploy --dry-run`
- Push to `main` only when the change is intended to deploy through Cloudflare.
- Do not commit `node_modules/`, `dist/`, `web/dist/`, `.wrangler/`, `.DS_Store`, logs, or generated local artifacts.

## Architecture Rules

- The Host/Worker is authoritative. Clients send commands only; clients must not directly mutate game results.
- Shared protocol and game types live under `src/shared/`. Update shared types before changing commands, events, or state shape.
- Gameplay results must be represented as events, for example `CARD_PLAYED`, `DAMAGE_APPLIED`, `TURN_STARTED`, and `GAME_STATE_SYNC`.
- Preserve private card information. Opponent hand contents and deck contents must not leak through snapshots or events.
- The Worker Durable Object owns online game room state for Cloudflare deployment.
- The Node host/client prototype may remain for LAN/local testing, but Cloudflare-facing code must stay compatible with Worker runtime constraints.

## Frontend Direction

- Frontend code should use TypeScript.
- Future UI work should migrate `web/` toward Vue 3 + Vite while keeping:
  - Pages build command: `npm run build:pages`
  - Pages output directory: `web/dist`
- Recommended frontend stack:
  - Vue 3 for UI components
  - Pinia for client-side UI/session state
  - VueUse for pointer utilities, long press, local preferences, and light/dark mode helpers
  - `@floating-ui/vue` for card tooltips, popovers, and anchored overlays
  - `interact.js` for draggable cards, dropzones, and touch-friendly drag interactions
  - Vue transitions, Motion for Vue, or CSS transitions for card movement and state feedback
  - CSS variables for light/dark themes and responsive layout tokens
- Use responsive layouts for desktop and mobile. Card controls must work with mouse, touch, and keyboard-friendly fallbacks where practical.
- Dragging a card should send a command only after a valid drop/action is confirmed. Do not optimistically apply game effects locally.
- Long press should reveal card detail or tooltip, not trigger gameplay by itself.
- Theme toggles should be UI preferences only and must not affect game state or network protocol.

## Cloudflare Settings

Worker project:

```txt
Project name: dnd-card-game-api
Production branch: main
Root directory: /
Build command: npm run build
Deploy command: npx wrangler deploy
```

Pages project:

```txt
Project name: dnd-card-game
Production branch: main
Root directory: /
Build command: npm run build:pages
Build output directory: web/dist
```

Pages environment variables:

```txt
NODE_VERSION=22
VITE_WORKER_WS_URL=wss://<worker-domain>/ws
```

Do not hard-code production Worker URLs in source when an environment variable is appropriate.

## Validation Checklist

- Shared/game protocol changed: update tests and run `npm run build && npm test`.
- Worker changed: run `npm run build:worker` and `npx wrangler deploy --dry-run`.
- Frontend changed: run `npm run build:pages` and manually check connection, ready, draw, play, discard, and end-turn flows.
- UI interaction changed: test at least one desktop viewport and one mobile-sized viewport.
- Deployment setting changed: update `README.md` and this file if the user-facing setup changes.
