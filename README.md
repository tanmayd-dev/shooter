# shooter

Multiplayer arena shooter with Trackmania-style driving physics: a Rust/axum authoritative server
and a TypeScript/Vite web client (also used by the Linux native launcher).

- `server/` — tokio + axum, 60 Hz authoritative rooms, WebSocket at `/ws`.
- `client/` — TypeScript + Vite, canvas/WebGL renderer, WebAudio, WebRTC voice mesh.
- `launcher/` — Linux desktop entry and server bootstrap.

Development notes and invariants live in `AGENTS.md`; deployment steps live in `DEPLOYMENT.md`.

## Client build

```bash
cd client
npm ci
npm test          # tsc --noEmit + node --test
npm run build     # tsc + vite build + post-build guardrails
```

`npm run build` runs `scripts/postbuild.mjs`, which:

- derives the CSP `connect-src` from `VITE_WS_URL` instead of allowing `ws:`/`wss:` globally,
- fails if `dist/_headers` or `dist/_redirects` are missing or lost their rules,
- fails if the JS bundle exceeds `BUNDLE_BUDGET_BYTES` (default 1.5 MB).

## Backend URL contract

The client resolves the WebSocket endpoint in this order (`client/src/network.ts`):

1. `?server=` URL search parameter
2. `localStorage["shooter_server_url"]` (the lobby's **SERVER ENDPOINT** field)
3. `window.SHOOTER_SERVER_URL`
4. `VITE_WS_URL` at build time
5. same-origin default

`VITE_WS_URL` is the *build-time* value used both for that fallback and to scope the Content
Security Policy. Set it to the production endpoint, e.g.:

```bash
VITE_WS_URL=wss://game.example.com/ws npm run build
```

The generated `connect-src` then allows only `'self'`, `wss://game.example.com` and
`https://game.example.com`. Runtime overrides (`?server=` / `localStorage` / `window`) pointing at a
different host are blocked by that policy by design; add extra origins with
`VITE_CSP_CONNECT_EXTRA` (comma-separated CSP source expressions) when you need them.

If `VITE_WS_URL` is unset, the build warns and leaves `connect-src 'self'`, which only works when the
client and the server share an origin.

## CI

`.github/workflows/client.yml` runs `npm ci`, `npm test` and `npm run build` on pushes and pull
requests touching `client/`, then uploads `client/dist` as a Pages artifact. Configure the
`VITE_WS_URL` repository variable for hosted builds (and `VITE_ICE_SERVERS` for deployed TURN).

`.github/workflows/server.yml` runs `cargo test` and uploads release `x86_64` and `aarch64` binaries
with SHA-256 checksums. The hardened systemd unit lives at `packaging/shooter-server.service`.
