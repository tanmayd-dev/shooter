#!/usr/bin/env node
// End-to-end multi-client integration verification script
//
// Exercises the real HTTP + WebSocket surface of the release server:
//   - /health and static client bundle
//   - room create/join, car_type preservation (apex/titan), readiness
//   - tournament GameStart synchronization (map/round/total_rounds)
//   - in-room WebRTC VoiceSignal routing (target only, no sender echo)
//   - server-authoritative turnaround (angle flip of ~PI)
//
// Requires a server listening on 127.0.0.1:8080.

const http = require('http');

const BASE_URL = 'http://127.0.0.1:8080';
const WS_URL = 'ws://127.0.0.1:8080/ws';

const WebSocketImpl =
  global.WebSocket ||
  (() => {
    try {
      return require('ws');
    } catch {
      throw new Error(
        'No WebSocket implementation available (need Node >= 22 global WebSocket or the "ws" package)'
      );
    }
  })();

const KNOWN_MAPS = ['neon_stadium', 'cyber_canyon', 'orbital_foundry'];
const VALID_CAR_TYPES = ['stadium', 'desert', 'rally', 'apex', 'titan'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`${BASE_URL}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      })
      .on('error', reject);
  });
}

async function testHttpEndpoint() {
  const { statusCode, body } = await httpGet('/health');
  assertEqual(statusCode, 200, '/health status code');
  const json = JSON.parse(body);
  assertEqual(json.status, 'ok', '/health body status');
  console.log('✓ /health responded with status: ok');
}

async function testStaticFiles() {
  const { statusCode, body } = await httpGet('/');
  assertEqual(statusCode, 200, '/ status code');
  assert(body.includes('webgl-canvas'), '/ should serve index.html with webgl-canvas');
  assert(body.includes('hud-canvas'), '/ should serve index.html with hud-canvas');
  console.log('✓ / served index.html with webgl-canvas and hud-canvas');
}

/** Minimal WebSocket test client with an inbox and predicate-based waits. */
class Client {
  constructor(label) {
    this.label = label;
    this.inbox = [];
    this.waiters = [];
    this.ws = new WebSocketImpl(WS_URL);
    this.ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      this.inbox.push(msg);
      for (const waiter of [...this.waiters]) {
        if (waiter.pred(msg)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(msg);
        }
      }
    });
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error(`${label}: WebSocket connection error`)), {
        once: true,
      });
    });
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor(pred, { timeout = 5000, since = 0, what = 'message' } = {}) {
    for (let i = since; i < this.inbox.length; i++) {
      if (pred(this.inbox[i])) return Promise.resolve(this.inbox[i]);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        pred,
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`${this.label}: timed out after ${timeout}ms waiting for ${what}`));
      }, timeout);
      this.waiters.push(waiter);
    });
  }

  count(type) {
    return this.inbox.filter((m) => m.type === type).length;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

const findPlayer = (msg, id) => (msg.players || []).find((p) => p.id === id);
const angleOf = (msg, id) => {
  const p = findPlayer(msg, id);
  assert(p, `player ${id} present in WorldState`);
  assert(typeof p.angle === 'number' && Number.isFinite(p.angle), `player ${id} has finite angle`);
  return p.angle;
};
const wrapDelta = (delta) => Math.atan2(Math.sin(delta), Math.cos(delta));

function inputWith(overrides) {
  return {
    type: 'PlayerInput',
    sequence: 1,
    throttle: 0,
    steer: 0,
    brake: false,
    fire_primary: false,
    fire_special: false,
    ability_mobility: false,
    ability_utility: false,
    turnaround: false,
    ...overrides,
  };
}

async function testWebSocketMultiplayer() {
  const A = new Client('Client A (host)');
  const B = new Client('Client B');
  try {
    await Promise.all([A.opened, B.opened]);
    console.log('✓ Both clients connected over WebSocket');

    // --- 1. Host creates a room with car_type "apex" ---
    A.send({ type: 'JoinLobby', name: 'ApexRacer', car_type: 'apex' });
    const lobbyA1 = await A.waitFor((m) => m.type === 'LobbyUpdate', { what: 'A LobbyUpdate' });
    const aId = lobbyA1.your_id;
    const roomCode = lobbyA1.room_code;
    assert(aId, 'A LobbyUpdate has your_id');
    assert(roomCode, 'A LobbyUpdate has room_code');
    assertEqual(lobbyA1.is_host, true, 'A is host');
    assertEqual(lobbyA1.players.length, 1, 'room has 1 player');
    assertEqual(lobbyA1.players[0].car_type, 'apex', 'A car_type preserved as apex');
    assertEqual(lobbyA1.players[0].id, aId, 'A player id matches your_id');
    assertEqual(lobbyA1.round, 1, 'LobbyUpdate tournament round');
    assertEqual(lobbyA1.total_rounds, 3, 'LobbyUpdate total_rounds');
    console.log(`✓ Room ${roomCode} created by ${aId} with car_type=apex (round ${lobbyA1.round}/${lobbyA1.total_rounds})`);

    // --- 2. Second client joins the same room with car_type "titan" ---
    const aSince = A.inbox.length;
    B.send({ type: 'JoinLobby', name: 'TitanBrawler', room_code: roomCode, car_type: 'titan' });
    const lobbyB = await B.waitFor((m) => m.type === 'LobbyUpdate' && m.players.length === 2, {
      what: 'B LobbyUpdate with 2 players',
    });
    const bId = lobbyB.your_id;
    assert(bId, 'B LobbyUpdate has your_id');
    assert(bId !== aId, 'clients got distinct player ids');
    assertEqual(lobbyB.is_host, false, 'B is not host');
    assertEqual(lobbyB.room_code.toUpperCase(), roomCode.toUpperCase(), 'B joined the same room');

    // A must also see the updated lobby; neither archetype may be coerced.
    const lobbyA2 = await A.waitFor((m) => m.type === 'LobbyUpdate' && m.players.length === 2, {
      since: aSince,
      what: 'A LobbyUpdate with 2 players',
    });
    for (const lobby of [lobbyA2, lobbyB]) {
      const pa = findPlayer(lobby, aId);
      const pb = findPlayer(lobby, bId);
      assert(pa && pb, 'both players appear in LobbyUpdate');
      assertEqual(pa.car_type, 'apex', 'A car_type stays apex (not coerced to stadium)');
      assertEqual(pb.car_type, 'titan', 'B car_type stays titan (not coerced to stadium)');
      assert(lobby.players.every((p) => VALID_CAR_TYPES.includes(p.car_type)), 'all car types valid');
    }
    console.log(`✓ Client B (${bId}) joined room ${roomCode} with car_type=titan; apex/titan preserved in LobbyUpdate`);

    // --- 3. Both ready up; host starts ---
    const aReadySince = A.inbox.length;
    const bReadySince = B.inbox.length;
    A.send({ type: 'SetReady', ready: true });
    B.send({ type: 'SetReady', ready: true });
    const allReady = (m) =>
      m.type === 'LobbyUpdate' && m.players.length === 2 && m.players.every((p) => p.ready);
    await Promise.all([
      A.waitFor(allReady, { since: aReadySince, what: 'all-ready LobbyUpdate on A' }),
      B.waitFor(allReady, { since: bReadySince, what: 'all-ready LobbyUpdate on B' }),
    ]);
    console.log('✓ Both players marked READY in LobbyUpdate');

    // Register GameStart watchers before triggering, so nothing is missed.
    const gsA3 = A.waitFor((m) => m.type === 'GameStart', { what: 'GameStart(countdown 3) on A' });
    const gsB3 = B.waitFor((m) => m.type === 'GameStart', { what: 'GameStart(countdown 3) on B' });
    const gsA0 = A.waitFor((m) => m.type === 'GameStart' && m.countdown === 0, {
      timeout: 8000,
      what: 'GameStart(countdown 0) on A',
    });
    const gsB0 = B.waitFor((m) => m.type === 'GameStart' && m.countdown === 0, {
      timeout: 8000,
      what: 'GameStart(countdown 0) on B',
    });

    A.send({ type: 'StartGame' });
    const [startA3, startB3, startA0, startB0] = await Promise.all([gsA3, gsB3, gsA0, gsB0]);

    for (const [label, start] of [
      ['A countdown 3', startA3],
      ['B countdown 3', startB3],
      ['A countdown 0', startA0],
      ['B countdown 0', startB0],
    ]) {
      assertEqual(start.round, 1, `${label} round`);
      assertEqual(start.total_rounds, 3, `${label} total_rounds`);
      assert(KNOWN_MAPS.includes(start.map), `${label} map is a known tournament map (got ${start.map})`);
    }
    assertEqual(startA3.map, startB3.map, 'both clients got the same map');
    assertEqual(startA0.map, startB0.map, 'both clients got the same countdown-0 map');
    assertEqual(startA0.map, startA3.map, 'map stable between countdown 3 and 0');
    assertEqual(startA0.round, startA3.round, 'round stable between countdown 3 and 0');
    assert(
      typeof (startA0.match_time_remaining ?? startA0.matchTimeRemaining) === 'number',
      'GameStart has numeric match_time_remaining'
    );
    console.log(
      `✓ Synchronized GameStart on both clients: map=${startA0.map}, round=${startA0.round}/${startA0.total_rounds}, countdown 3 -> 0`
    );

    // --- 4. WorldState stream (authoritative, same round + archetypes) ---
    const stateA = await A.waitFor((m) => m.type === 'WorldState' && m.players.length === 2, {
      timeout: 8000,
      what: 'WorldState on A',
    });
    const stateB = await B.waitFor((m) => m.type === 'WorldState' && m.players.length === 2, {
      timeout: 8000,
      what: 'WorldState on B',
    });
    for (const state of [stateA, stateB]) {
      assertEqual(state.round, 1, 'WorldState round');
      assertEqual(state.total_rounds, 3, 'WorldState total_rounds');
      assertEqual(findPlayer(state, aId).car_type, 'apex', 'WorldState A car_type apex');
      assertEqual(findPlayer(state, bId).car_type, 'titan', 'WorldState B car_type titan');
      assert(
        typeof (state.match_time_remaining ?? state.matchTimeRemaining) === 'number',
        'WorldState has numeric match_time_remaining'
      );
    }
    console.log(`✓ Authoritative WorldState streamed (tick ${stateB.tick}) with round ${stateB.round}/${stateB.total_rounds}`);

    // --- 5. VoiceSignal routing: A -> B only ---
    const aVoiceCountBefore = A.count('VoiceSignal');
    const bVoiceSince = B.inbox.length;
    const signal = JSON.stringify({ type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' });
    A.send({ type: 'VoiceSignal', target_player_id: bId, signal_data: signal });

    const voice = await B.waitFor((m) => m.type === 'VoiceSignal', {
      since: bVoiceSince,
      what: 'VoiceSignal delivered to B',
    });
    assertEqual(voice.from_player_id, aId, 'VoiceSignal.from_player_id is A');
    assertEqual(voice.signal_data, signal, 'VoiceSignal payload delivered intact');

    await sleep(400);
    const aVoices = A.inbox.filter((m) => m.type === 'VoiceSignal');
    assertEqual(aVoices.length, aVoiceCountBefore, 'VoiceSignal must not be echoed back to sender A');
    console.log(`✓ VoiceSignal routed A(${aId}) -> B(${bId}) only (no sender echo)`);

    // --- 6. Turnaround: server-authoritative ~PI angle flip ---
    const baseState = await B.waitFor((m) => m.type === 'WorldState' && findPlayer(m, bId), {
      since: B.inbox.length,
      what: 'WorldState before turnaround',
    });
    const baseAngle = angleOf(baseState, bId);

    const turnSince = B.inbox.length;
    B.send(inputWith({ sequence: 1, turnaround: true }));
    let turned;
    try {
      turned = await B.waitFor(
        (m) =>
          m.type === 'WorldState' &&
          findPlayer(m, bId) &&
          Math.abs(wrapDelta(angleOf(m, bId) - baseAngle)) > 2.0,
        { timeout: 3000, since: turnSince, what: 'WorldState angle change from turnaround' }
      );
    } finally {
      // Cooldown is 1.2s, so clearing immediately cannot cause a second flip here.
      B.send(inputWith({ sequence: 2, turnaround: false }));
    }

    const delta = Math.abs(wrapDelta(angleOf(turned, bId) - baseAngle));
    assert(delta > 3.0 && delta < 3.29, `turnaround angle change should be ~PI, got ${delta}`);
    console.log(
      `✓ Turnaround accepted: angle ${baseAngle.toFixed(3)} -> ${angleOf(turned, bId).toFixed(3)} (Δ ${delta.toFixed(3)} rad)`
    );

    console.log('=== All End-to-End Tests Passed! ===');
  } finally {
    A.close();
    B.close();
  }
}

async function run() {
  try {
    await testHttpEndpoint();
    await testStaticFiles();
    await testWebSocketMultiplayer();
    process.exit(0);
  } catch (e) {
    console.error('Integration test failed:', e && e.message ? e.message : e);
    if (e && e.stack) console.error(e.stack);
    process.exit(1);
  }
}

run();
