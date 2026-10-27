#!/usr/bin/env bash
set -euo pipefail

# Shooter - Native Linux App Launcher
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SHOOTER_PORT:-8080}"
export SHOOTER_PORT="${PORT}"
SERVER_BIN="${ROOT_DIR}/server/target/release/shooter-server"

echo "=== Starting Shooter Launcher ==="

# Check if server is already running on port
if ! curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "Starting local game server on port ${PORT}..."
    if [[ -f "${SERVER_BIN}" ]]; then
        "${SERVER_BIN}" &
        SERVER_PID=$!
    else
        echo "Building and starting server via cargo..."
        (cd "${ROOT_DIR}/server" && cargo run --release) &
        SERVER_PID=$!
    fi

    # Wait for server to become healthy
    for i in {1..30}; do
        if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
            echo "Server ready!"
            break
        fi
        sleep 0.5
    done
fi

URL="http://127.0.0.1:${PORT}"
echo "Launching Shooter window at ${URL}..."

# Launch in user's browser (prefer zen-browser in new window, fallback to xdg-open)
if command -v zen-browser >/dev/null 2>&1; then
    zen-browser --new-window "${URL}" &
elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${URL}" &
else
    echo "Game server active at ${URL}. Please open in your browser."
fi

# If we spawned a server process, trap termination signals to clean it up
if [[ -n "${SERVER_PID:-}" ]]; then
    trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT INT TERM
    wait "${SERVER_PID}"
fi
