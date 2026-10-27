#!/usr/bin/env node
// Post-build guardrails for the Pages artifact.
//
// 1. Rewrite the CSP `connect-src` so it only allows the backend configured at
//    build time (VITE_WS_URL) instead of the global `ws: wss:` wildcard.
// 2. Assert `_headers` and `_redirects` actually landed in `dist/` with the
//    rules we expect (Cloudflare/Netlify silently ignore missing files).
// 3. Enforce a bundle-size budget so a stray import cannot ship a huge bundle.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(clientRoot, 'dist');
const budget = Number(process.env.BUNDLE_BUDGET_BYTES ?? 1_500_000);
const failures = [];

function fail(message) {
  failures.push(message);
}

/** Turn a ws(s):// or http(s):// URL into CSP source expressions. */
function connectSources(rawUrl) {
  const sources = ["'self'"];
  if (!rawUrl) return sources;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    fail(`VITE_WS_URL is not a valid URL: ${rawUrl}`);
    return sources;
  }

  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    sources.push(`${url.protocol}//${url.host}`);
    // Cloudflare Pages may proxy the API over https on the same host.
    sources.push(`${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`);
  } else if (url.protocol === 'http:' || url.protocol === 'https:') {
    sources.push(`${url.origin}`);
    sources.push(`${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`);
  } else {
    fail(`VITE_WS_URL must use ws, wss, http or https (got ${url.protocol})`);
  }

  for (const extra of (process.env.VITE_CSP_CONNECT_EXTRA ?? '').split(',')) {
    const trimmed = extra.trim();
    if (trimmed) sources.push(trimmed);
  }

  return [...new Set(sources)];
}

function rewriteCsp() {
  const headersPath = join(dist, '_headers');
  if (!existsSync(headersPath)) {
    fail('dist/_headers is missing - the Pages security headers did not ship');
    return;
  }

  const headers = readFileSync(headersPath, 'utf8');
  const cspLine = headers
    .split('\n')
    .find((line) => line.trim().toLowerCase().startsWith('content-security-policy:'));

  if (!cspLine) {
    fail('dist/_headers has no Content-Security-Policy directive');
    return;
  }

  const configured = process.env.VITE_WS_URL ?? '';
  if (!configured) {
    console.warn(
      'warning: VITE_WS_URL is not set; connect-src will be limited to \'self\'. ' +
        'Set it to your backend WebSocket URL (e.g. wss://game.example.com/ws) for a hosted build.',
    );
  }

  const sources = connectSources(configured).join(' ');
  const rewritten = cspLine.replace(/connect-src[^;]*/, `connect-src ${sources}`);
  if (rewritten.includes('connect-src ws:') || rewritten.includes('connect-src wss:')) {
    fail('CSP still permits a wildcard WebSocket scheme');
  }

  writeFileSync(headersPath, headers.replace(cspLine, rewritten));
  console.log(`CSP connect-src: ${sources}`);

  const bundled = readFileSync(headersPath, 'utf8');
  if (!/x-frame-options:\s*deny/i.test(bundled)) {
    fail('dist/_headers lost the X-Frame-Options rule');
  }
}

function checkRedirects() {
  const redirectsPath = join(dist, '_redirects');
  if (!existsSync(redirectsPath)) {
    fail('dist/_redirects is missing - the SPA fallback did not ship');
    return;
  }
  const body = readFileSync(redirectsPath, 'utf8');
  if (!/^\s*\/\*\s+\/index\.html\s+200\s*$/m.test(body)) {
    fail('dist/_redirects does not contain the `/* /index.html 200` SPA fallback');
  }
}

function checkBundleBudget() {
  const assets = join(dist, 'assets');
  if (!existsSync(assets)) {
    fail('dist/assets is missing');
    return;
  }

  let total = 0;
  for (const entry of readdirSync(assets)) {
    if (entry.endsWith('.js')) total += statSync(join(assets, entry)).size;
  }

  console.log(`JS bundle: ${(total / 1024).toFixed(1)} KiB (budget ${(budget / 1024).toFixed(1)} KiB)`);
  if (total > budget) {
    fail(`JS bundle exceeds the ${budget} byte budget: ${total} bytes`);
  }
}

rewriteCsp();
checkRedirects();
checkBundleBudget();

if (failures.length > 0) {
  for (const message of failures) console.error(`error: ${message}`);
  process.exit(1);
}

console.log('postbuild checks passed');
