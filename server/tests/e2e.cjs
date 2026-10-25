#!/usr/bin/env node
// End-to-end multi-client integration verification script

const http = require('http');

async function testHttpEndpoint() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8080/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'ok') {
            console.log('✓ /health responded with status: ok');
            resolve();
          } else {
            reject(new Error(`Unexpected status: ${data}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function testStaticFiles() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8080/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (data.includes('webgl-canvas') && data.includes('hud-canvas')) {
          console.log('✓ / served index.html with webgl-canvas and hud-canvas');
          resolve();
        } else {
          reject(new Error(`Index.html does not contain webgl-canvas and hud-canvas: ${data.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

async function testWebSocketMultiplayer() {
  const WebSocket = global.WebSocket || require('ws');

  // Client 1: Host creates lobby
  const ws1 = new WebSocket('ws://127.0.0.1:8080/ws');
  let roomCode = '';

  await new Promise((resolve, reject) => {
    ws1.onopen = () => {
      console.log('✓ Client 1 (Host) connected');
      ws1.send(JSON.stringify({
        type: 'JoinLobby',
        name: 'HostDrifter',
        car_type: 'stadium',
      }));
    };

    ws1.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'LobbyUpdate') {
        const yourId = msg.your_id || msg.yourId;
        if (!yourId) {
          return reject(new Error('Client 1 LobbyUpdate missing your_id'));
        }
        roomCode = msg.room_code || msg.roomCode;
        console.log(`✓ Lobby created with code: ${roomCode}, client 1 id: ${yourId}`);
        resolve();
      }
    };
    ws1.onerror = reject;
  });

  // Client 2: Joins lobby with roomCode
  const ws2 = new WebSocket('ws://127.0.0.1:8080/ws');
  await new Promise((resolve, reject) => {
    ws2.onopen = () => {
      console.log('✓ Client 2 connected, joining room:', roomCode);
      ws2.send(JSON.stringify({
        type: 'JoinLobby',
        name: 'DesertBrawler',
        room_code: roomCode,
        car_type: 'desert',
      }));
    };

    ws2.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'LobbyUpdate') {
        const yourId = msg.your_id || msg.yourId;
        if (!yourId) {
          return reject(new Error('Client 2 LobbyUpdate missing your_id'));
        }
        if (msg.players.length === 2) {
          console.log(`✓ Client 2 joined room! Total players: 2, client 2 id: ${yourId}`);
          resolve();
        }
      }
    };
    ws2.onerror = reject;
  });

  // Both ready up
  ws1.send(JSON.stringify({ type: 'SetReady', ready: true }));
  ws2.send(JSON.stringify({ type: 'SetReady', ready: true }));

  // Wait for both ready in lobby update
  await new Promise((resolve) => {
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'LobbyUpdate') {
        const allReady = msg.players.every(p => p.ready || p.isReady);
        if (allReady && msg.players.length === 2) {
          console.log('✓ Both players marked READY in lobby update');
          ws1.removeEventListener('message', handler);
          resolve();
        }
      }
    };
    ws1.addEventListener('message', handler);
  });

  // Host starts game
  ws1.send(JSON.stringify({ type: 'StartGame' }));

  // Verify GameStart or WorldState broadcast
  await new Promise((resolve, reject) => {
    let receivedStates = 0;
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for WorldState')), 5000);

    const onState = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'WorldState') {
        receivedStates++;
        if (receivedStates === 5) {
          console.log(`✓ Received authoritative WorldState snapshots (Tick: ${msg.tick}) with ${msg.players.length} cars`);
          clearTimeout(timeout);
          ws1.close();
          ws2.close();
          resolve();
        }
      }
    };
    ws1.addEventListener('message', onState);
  });

  console.log('=== All End-to-End Tests Passed! ===');
}

async function run() {
  try {
    await testHttpEndpoint();
    await testStaticFiles();
    await testWebSocketMultiplayer();
    process.exit(0);
  } catch (e) {
    console.error('Integration test failed:', e);
    process.exit(1);
  }
}

run();
