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
| `SHOOTER_STATIC_DIR` | probe `client/dist`, then `../client/dist` | Absolute path to the built client to serve. When set it must exist, otherwise startup fails with a clear error. |

The server logs the resolved bind address, the effective origin policy and the static directory at
startup, so `journalctl -u shooter-server` shows exactly what it is serving. `SIGINT` and `SIGTERM`
both trigger `with_graceful_shutdown` (the latter is what systemd sends), so in-flight sockets close
cleanly on restart.

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
SHOOTER_STATIC_DIR=/srv/shooter/client/dist \
  ./server/target/release/shooter-server
```

Example Caddy site (`/etc/caddy/Caddyfile`) — Caddy obtains the certificate automatically:

```caddy
game.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Open only 80/443 in the OCI VCN security list. Keep 8080 closed.

### systemd unit (recommended)

`packaging/shooter-server.service` is a hardened unit (`DynamicUser=yes`,
`ProtectSystem=strict`, `ProtectHome=yes`, `NoNewPrivileges=yes`, `Restart=on-failure`) that reads
`/etc/shooter/shooter-server.env` and serves `/srv/shooter/client/dist`. The server is **stateless**:
it only reads the client bundle and never writes files, so the unit deliberately has no
`StateDirectory=`/`RuntimeDirectory=` and `ProtectSystem=strict` is safe as-is.

```bash
sudo install -Dm0755 server/target/release/shooter-server /usr/local/bin/shooter-server
sudo mkdir -p /srv/shooter/client
sudo cp -r client/dist /srv/shooter/client/dist
sudo install -Dm0644 packaging/shooter-server.service /etc/systemd/system/shooter-server.service

# Root-owned, world-readable (DynamicUser must be able to read it). Never commit it.
sudo install -Dm0644 /dev/null /etc/shooter/shooter-server.env
sudo tee /etc/shooter/shooter-server.env >/dev/null <<'EOF'
SHOOTER_BIND=127.0.0.1
SHOOTER_PORT=8080
SHOOTER_ALLOWED_ORIGINS=https://your-project.pages.dev
SHOOTER_STATIC_DIR=/srv/shooter/client/dist
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now shooter-server
systemctl status shooter-server
journalctl -u shooter-server -b --no-pager
```

Because the server writes nothing, there is no writable state path to declare. If a future version
adds persistence, add a matching `StateDirectory=` and point the code at `$STATE_DIRECTORY`.

Health check: `curl -sf https://game.example.com/health` returns `{"status":"ok"}`. Confirm graceful
shutdown with `sudo systemctl restart shooter-server`; the log shows `SIGTERM received, shutting down`.

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

### Voice chat / TURN

Voice is a peer-to-peer WebRTC mesh. Browsers require a secure context (HTTPS or
`http://127.0.0.1`) for `getUserMedia`. Push-to-talk is `V`, mute is `M`.

ICE servers are configured at **build time** through `VITE_ICE_SERVERS`, a JSON array of
[`RTCIceServer`](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceServer) objects. If it is
unset, malformed, or empty the client falls back to the public Google STUN list. `urls` may be a
string or an array; TURN long-term credentials are `username` + `credential`.

```bash
VITE_ICE_SERVERS='[
  {"urls":["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]},
  {"urls":["turn:turn.example.com:3478?transport=udp","turns:turn.example.com:5349?transport=tcp"],
   "username":"shooter","credential":"REPLACE_ME"}
]' \
VITE_WS_URL=wss://game.example.com/ws \
npm run build
```

Cloudflare Pages: add the same JSON as a **build-time** project variable (`VITE_ICE_SERVERS`), then
redeploy. Do not put static TURN passwords in a public repository; use a project/environment secret.
`VITE_ICE_SERVERS` does not change the CSP, which already allows microphone capture via
`Permissions-Policy`.

The client tries direct ICE first. If `iceConnectionState` becomes `failed`, it retries **once** with
`iceTransportPolicy: 'relay'` through your TURN server (the lower player ID re-offers to avoid glare)
and the HUD shows `⚠ VOICE UNAVAILABLE — NO RELAY PATH` if that also fails. The mesh is capped at
**7 peers** per client because the server's room cap is 8 players (`MAX_PLAYERS_PER_ROOM`); the server
already refuses extra players, so the client only surfaces the limit in the HUD and never opens more
peer connections. Signaling is bounded by the 64 KiB WebSocket message cap; the room relay also drops
individual `signal_data` strings over 8 KiB, which is comfortably above a normal SDP/candidate
payload.

Minimal coturn example (`/etc/coturn/turnserver.conf`):

```ini
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=turn.example.com
user=shooter:REPLACE_ME
# Behind OCI NAT, advertise the public address:
external-ip=203.0.113.10
min-port=49152
max-port=65535
no-multicast-peers
no-cli
```

```bash
sudo systemctl enable --now coturn
```

Open **UDP 3478** and the relay range **UDP 49152-65535** (and **TCP 5349** for `turns:`) in the OCI
VCN security list and the host firewall. Verify TURN independently, e.g. with
`turnutils_uclient -u shooter -w REPLACE_ME turn.example.com` or the WebRTC `chrome://webrtc-internals`
candidate pair view.

## Linux native launcher

```bash
make install          # installs ~/.local/bin/shooter and the .desktop entry
shooter               # starts the release server if needed, then opens the arena
SHOOTER_PORT=9090 shooter
```

The launcher waits on `curl -sf /health`, so it fails fast if the server did not start.

## Verification

```bash
(cd server && cargo test)              # 32 unit tests
(cd server && cargo build --release)   # x86_64 host; CI cross-builds aarch64 too
(cd client && npm test)                # tsc + 37 tests (incl. voice config/size)
(cd client && npm run build)           # production bundle
./server/target/release/shooter-server &   # then:
node server/tests/e2e.cjs              # two-client lobby/match/voice/turnaround
```

`.github/workflows/server.yml` runs `cargo test`, then builds release binaries for
`x86_64-unknown-linux-gnu` and `aarch64-unknown-linux-gnu` (Rust target + `gcc-aarch64-linux-gnu`
linker), attaching each binary with a `.sha256` checksum. The `cross` project works as an
alternative if you prefer Docker-backed cross builds.
