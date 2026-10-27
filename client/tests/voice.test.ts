import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SIGNAL_BYTES,
  MAX_VOICE_PEERS_PER_ROOM,
  PUBLIC_STUN_SERVERS,
  buildIceConfiguration,
  isSignalWithinWsLimit,
  parseIceServers,
  signalByteLength,
} from '../src/audio/voice.ts';

test('Voice config: defaults to Google STUN when VITE_ICE_SERVERS is unset or blank', () => {
  assert.deepEqual(parseIceServers(undefined), PUBLIC_STUN_SERVERS);
  assert.deepEqual(parseIceServers(''), PUBLIC_STUN_SERVERS);
  assert.deepEqual(parseIceServers('   '), PUBLIC_STUN_SERVERS);
});

test('Voice config: parses STUN + TURN entries and preserves TURN credentials', () => {
  const raw = JSON.stringify([
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:turn.example.com:3478?transport=udp',
        'turns:turn.example.com:5349?transport=tcp',
      ],
      username: 'shooter',
      credential: 's3cret',
    },
  ]);

  assert.deepEqual(parseIceServers(raw), [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: [
        'turn:turn.example.com:3478?transport=udp',
        'turns:turn.example.com:5349?transport=tcp',
      ],
      username: 'shooter',
      credential: 's3cret',
    },
  ]);
});

test('Voice config: malformed VITE_ICE_SERVERS falls back to public STUN', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(parseIceServers('not json'), PUBLIC_STUN_SERVERS);
    assert.deepEqual(parseIceServers('[]'), PUBLIC_STUN_SERVERS);
    assert.deepEqual(parseIceServers('[{"username":"no-urls"}]'), PUBLIC_STUN_SERVERS);
    assert.deepEqual(parseIceServers('[{"urls":42}]'), PUBLIC_STUN_SERVERS);
  } finally {
    console.warn = originalWarn;
  }
});

test('Voice config: relay retry forces iceTransportPolicy relay', () => {
  const servers = [{ urls: 'turns:turn.example.com:5349', username: 'u', credential: 'c' }];
  const direct = buildIceConfiguration(false, servers);
  const relay = buildIceConfiguration(true, servers);

  assert.equal(direct.iceTransportPolicy, undefined);
  assert.deepEqual(direct.iceServers, servers);
  assert.equal(relay.iceTransportPolicy, 'relay');
  assert.deepEqual(relay.iceServers, servers);
});

test('Voice mesh: peer cap matches the server room cap of 8 players', () => {
  // server/src/room.rs MAX_PLAYERS_PER_ROOM = 8; each client connects to others only.
  assert.equal(MAX_VOICE_PEERS_PER_ROOM, 7);
});

test('Voice signaling: SDP offer fits the 64 KiB WebSocket message limit', () => {
  const sdpLines = [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'c=IN IP4 0.0.0.0',
    'a=rtcp:9 IN IP4 0.0.0.0',
    'a=ice-ufrag:abcd',
    `a=ice-pwd:${'x'.repeat(256)}`,
    `a=fingerprint:sha-256 ${'AB:CD'.repeat(32)}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=sendrecv',
    'a=rtpmap:111 opus/48000/2',
  ];
  // Real browsers advertise several dozen candidates; pad the offer to a
  // pessimistic multi-KiB size while staying inside the protocol cap.
  for (let i = 0; i < 200; i++) {
    sdpLines.push(
      `a=candidate:${i} 1 udp 2122260223 192.0.2.${i % 255} ${40000 + i} typ host generation 0`
    );
  }

  const signalData = JSON.stringify({ type: 'offer', sdp: sdpLines.join('\r\n') + '\r\n' });
  const envelope = JSON.stringify({
    type: 'VoiceSignal',
    target_player_id: 'p_target',
    signal_data: signalData,
  });

  assert.ok(
    signalByteLength(signalData) < MAX_SIGNAL_BYTES,
    `SDP signal must stay under ${MAX_SIGNAL_BYTES} bytes, got ${signalByteLength(signalData)}`
  );
  assert.ok(
    signalByteLength(envelope) < MAX_SIGNAL_BYTES,
    `VoiceSignal envelope must stay under ${MAX_SIGNAL_BYTES} bytes, got ${signalByteLength(envelope)}`
  );
  assert.equal(isSignalWithinWsLimit(signalData), true);
  assert.equal(isSignalWithinWsLimit('x'.repeat(MAX_SIGNAL_BYTES)), true);
  assert.equal(isSignalWithinWsLimit('x'.repeat(MAX_SIGNAL_BYTES + 1)), false);
});
