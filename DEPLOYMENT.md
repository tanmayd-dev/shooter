# Deployment: Oracle ARM + Cloudflare Pages + Linux Native

The server is a single axum binary that serves the built client from `client/dist` and exposes the
WebSocket endpoint at `/ws`. Cloudflare Pages can host the same `dist` build, connecting back to the
Oracle server over `wss://`.

## Server configuration (environment)

| Variable | Default | Purpose |
|---|---|---|
| `SHOOTER_BIND` | `127.0.0.1` | Listener address. Keep loopback when a reverse proxy terminates TLS. |
| `SHOOTER_PORT` | `8080` | Listener port (the launcher passes this through too). |
| `SHOOTER_ALLOWED_ORIGINS` | localhost + `*.pages.dev` | Comma-separated extra WebSocket `Origin` allow-list, e.g. `https://shooter.example.com`. |

Hardening already applied in code: 64 KiB max WebSocket message, 16 KiB max frame, 8 KiB read/write
buffers, per-connection rate limits (inputs/lobby/voice/ping), 30 s idle timeout, 5 s stalled-writer
timeout, sanitized names and clamped floats, 6-character room codes, bounded room count with periodic
eviction, and origin allow-listing.

## Oracle Cloud free-tier ARM (aarch64)

```bash
sudo dnf install -y gcc gcc-c++ openssl-devel   # Oracle Linux; use apt on Ubuntu images
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

git clone <repo> shooter && cd shooter/client && npm ci && npm run build && cd ..
cd server && cargo build --release          # release profile: thin LTO, stripped
```

Run behind Caddy/nginx so the game is never exposed as plaintext `ws://`:

```bash
SHOOTER_BIND=127.0.0.1 SHOOTER_PORT=8080 \
SHOOTER_ALLOWED_ORIGINS=https://your-project.pages.dev \
  ./server/target/release/shooter-server
```

Example Caddy site (`/etc/caddy/Caddyfile`) — Caddy obtains the certificate automatically:

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Open only 80/443 in the OCI VCN security list. Keep 8080 closed. A systemd unit keeps the process
alive and passes `SHOOTER_BIND`/`SHOOTER_PORT`/`SHOOTER_ALLOWED_ORIGINS`.

Health check: `curl -sf https://game.example.com/health` returns `{"status":"ok"}`.

## Cloudflare Pages

- Build command: `npm ci && npm run build`
- Output directory: `dist`
- Root directory: `client`

Recommended project variable: `VITE_WS_URL=wss://game.example.com/ws`.

The URL is resolved in this order (`client/src/network.ts`): `?server=` → `localStorage` →
`window.SHOOTER_SERVER_URL` → `VITE_WS_URL` → host default. On Pages, the lobby also has a
**SERVER ENDPOINT** field that saves to `localStorage` and reloads. You can also share links as
`https://your-project.pages.dev/?server=wss://game.example.com/ws`.

`client/public/_headers` ships CSP/HSTS/`Permissions-Policy` headers (mic allowed for voice chat);
`client/public/_redirects` provides the SPA fallback.

### Voice chat note

Voice is a peer-to-peer WebRTC mesh using public STUN servers. Browsers require a secure context
(HTTPS or `http://127.0.0.1`) for `getUserMedia`. Symmetric NATs may need a TURN server; add it to
`PUBLIC_STUN_SERVERS` in `client/src/audio/voice.ts` if players cannot hear each other. Push-to-talk
is `V`, mute is `M`.

## Linux native launcher

```bash
make install          # installs ~/.local/bin/shooter and the .desktop entry
shooter               # starts the release server if needed, then opens the arena
SHOOTER_PORT=9090 shooter
```

The launcher waits on `curl -sf /health`, so it fails fast if the server did not start.

## Verification

```bash
(cd server && cargo test)          # 28 unit tests
(cd client && npm test)            # tsc + 26 tests
(cd client && npm run build)       # production bundle
./server/target/release/shooter-server &   # then:
node server/tests/e2e.cjs          # two-client lobby/match/voice/turnaround
```
