import { sfx } from './audio/sfx';
import {
  activateMobilityAbility,
  activateSpecialAbility,
  activateTacticalGadget,
  resolveCarCollisions,
  updateCarAbilities,
} from './combat/abilities';
import { firePrimaryWeapon, updateProjectiles } from './combat/weapons';
import { NetworkClient, ServerLobbyUpdate, ServerWorldState } from './network';
import { CAR_CONFIGS } from './physics/configs.ts';
import { InputController } from './physics/input.ts';
import { getTrack } from './physics/maps.ts';
import { normalizeAngle, resolveTrackCollisions, stepVehicle } from './physics/vehicle.ts';
import { HUDRenderer } from './render/hud';
import { ParticleSystem } from './render/particles';
import { Renderer3D } from './render3d/scene';
import {
  CarArchetype,
  CarState,
  LobbyPlayer,
  Projectile,
  RoomState,
} from './types';
import { LobbyUI } from './ui/lobby';
import { VoiceChatManager } from './audio/voice.ts';

// ============================================================================
// Game Initialization & Main Loop
// ============================================================================

function main(): void {
  const webglCanvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
  const hudCanvas = document.getElementById('hud-canvas') as HTMLCanvasElement;
  if (!webglCanvas || !hudCanvas) throw new Error('Game canvas elements not found');

  const particles = new ParticleSystem();
  const renderer3d = new Renderer3D(webglCanvas);
  const hud = new HUDRenderer();
  const inputController = new InputController('vim-arrows');
  let track = getTrack('neon_stadium');
  const lobby = new LobbyUI();
  const network = new NetworkClient();
  const voiceChat = new VoiceChatManager((targetPlayerId, signalData) => {
    network.sendVoiceSignal(targetPlayerId, signalData);
  });
  network.onVoiceSignal = (fromPlayerId, signalData) => {
    void voiceChat.handleSignal(fromPlayerId, signalData);
  };

  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    webglCanvas.width = w;
    webglCanvas.height = h;
    hudCanvas.width = w;
    hudCanvas.height = h;
    renderer3d.resize(w, h);
  };
  window.addEventListener('resize', resize);
  resize();

  // Camera toggle (KeyC) handler
  inputController.setCameraToggleCallback(() => {
    renderer3d.toggleCameraMode();
  });

  let activeProjectiles: Projectile[] = [];
  let matchActive = false;
  let countdown: number | null = null;
  let matchTimeRemaining = 180; // 3 minutes
  let isOnline = false;
  let inputSequence = 0;
  let currentOnlineRoomCode: string | null = null;
  let botEngagementTimer = 2.0;
  let turnaroundCooldown = 0;
  let forceSnapOnFocus = false;
  const padCooldowns = new Map<string, number>();

  // Offline Practice Tournament Progression
  let offlineRound = 1;
  const offlineTotalRounds = 3;
  const offlineMapRotation = ['neon_stadium', 'cyber_canyon', 'orbital_foundry'];

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      forceSnapOnFocus = true;
      lastTime = performance.now();
    } else {
      // Background tab safety: immediately send neutral input so car doesn't ghost-drive
      if (isOnline && network.getConnected()) {
        inputSequence++;
        network.sendNeutralInput(inputSequence);
      }
    }
  });

  inputController.onBlur = () => {
    if (isOnline && network.getConnected()) {
      inputSequence++;
      network.sendNeutralInput(inputSequence);
    }
  };

  // Stadium Safe Spawn Points
  const STADIUM_SPAWN_POINTS = [
    { x: 800, y: 380, angle: 0 },
    { x: 2800, y: 2020, angle: Math.PI },
    { x: 2800, y: 380, angle: Math.PI },
    { x: 800, y: 2020, angle: 0 },
  ];

  function getSafeSpawnPoint(car: CarState, candidates: CarState[]): { x: number; y: number; angle: number } {
    const livingOpponents = candidates.filter((c) => c.id !== car.id && c.isAlive);
    if (livingOpponents.length === 0) {
      return STADIUM_SPAWN_POINTS[0];
    }

    let bestSpawn = STADIUM_SPAWN_POINTS[0];
    let maxMinDist = -1;

    for (const spawn of STADIUM_SPAWN_POINTS) {
      let minDist = Infinity;
      for (const opp of livingOpponents) {
        const d = Math.hypot(opp.x - spawn.x, opp.y - spawn.y);
        if (d < minDist) {
          minDist = d;
        }
      }
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        bestSpawn = spawn;
      }
    }

    return bestSpawn;
  }

  // Local player car state
  const playerCar: CarState = {
    id: `pilot-${Math.floor(1000 + Math.random() * 9000)}`,
    name: 'PILOT-01',
    archetype: 'stadium',
    x: 800,
    y: 380,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    steer: 0,
    throttle: 0,
    handbrake: false,
    speed: 0,
    driftSlip: 0,
    skidIntensity: 0,
    isDrifting: false,
    driftAngle: 0,
    health: 100,
    maxHealth: 100,
    armor: 65,
    maxArmor: 65,
    isLocal: true,
    isAlive: true,
    score: 0,
    kills: 0,
    deaths: 0,
    shieldActive: false,
    shieldDuration: 0,
    ramActive: false,
    ramDuration: 0,
    boostActive: false,
    boostDuration: 0,
    empDisrupted: false,
    empDuration: 0,
    primaryCooldown: 0,
    specialCooldown: 0,
    mobilityCooldown: 0,
    gadgetCooldown: 0,
    specialMaxCooldown: 6.0,
    mobilityMaxCooldown: 4.0,
    gadgetMaxCooldown: 10.0,
  };

  // Bot sparring partners for offline practice
  const bot1: CarState = {
    id: 'bot-desert',
    name: 'CRUSHER',
    archetype: 'desert',
    x: 2800,
    y: 2020,
    vx: 0,
    vy: 0,
    angle: Math.PI,
    angularVelocity: 0,
    steer: 0,
    throttle: 0,
    handbrake: false,
    speed: 0,
    driftSlip: 0,
    skidIntensity: 0,
    isDrifting: false,
    driftAngle: 0,
    health: 150,
    maxHealth: 150,
    armor: 95,
    maxArmor: 95,
    isLocal: false,
    isAlive: true,
    score: 0,
    kills: 0,
    deaths: 0,
    shieldActive: false,
    shieldDuration: 0,
    ramActive: false,
    ramDuration: 0,
    boostActive: false,
    boostDuration: 0,
    empDisrupted: false,
    empDuration: 0,
    primaryCooldown: 0,
    specialCooldown: 0,
    mobilityCooldown: 0,
    gadgetCooldown: 0,
    specialMaxCooldown: 8.0,
    mobilityMaxCooldown: 5.5,
    gadgetMaxCooldown: 9.0,
  };

  const bot2: CarState = {
    id: 'bot-rally',
    name: 'DRIFT-KING',
    archetype: 'rally',
    x: 2800,
    y: 380,
    vx: 0,
    vy: 0,
    angle: Math.PI,
    angularVelocity: 0,
    steer: 0,
    throttle: 0,
    handbrake: false,
    speed: 0,
    driftSlip: 0,
    skidIntensity: 0,
    isDrifting: false,
    driftAngle: 0,
    health: 85,
    maxHealth: 85,
    armor: 50,
    maxArmor: 50,
    isLocal: false,
    isAlive: true,
    score: 0,
    kills: 0,
    deaths: 0,
    shieldActive: false,
    shieldDuration: 0,
    ramActive: false,
    ramDuration: 0,
    boostActive: false,
    boostDuration: 0,
    empDisrupted: false,
    empDuration: 0,
    primaryCooldown: 0,
    specialCooldown: 0,
    mobilityCooldown: 0,
    gadgetCooldown: 0,
    specialMaxCooldown: 7.0,
    mobilityMaxCooldown: 4.5,
    gadgetMaxCooldown: 8.5,
  };

  let allCars: CarState[] = [playerCar, bot1, bot2];

  // Local fallback room state
  const localRoomState: RoomState = {
    code: 'LOCAL',
    hostId: playerCar.id,
    players: [
      { id: playerCar.id, name: playerCar.name, archetype: playerCar.archetype, carType: playerCar.archetype, isReady: false, isHost: true, ping: 1 },
      { id: bot1.id, name: bot1.name, archetype: bot1.archetype, carType: bot1.archetype, isReady: true, isHost: false, ping: 1 },
      { id: bot2.id, name: bot2.name, archetype: bot2.archetype, carType: bot2.archetype, isReady: true, isHost: false, ping: 1 },
    ],
    matchActive: false,
    countdown: null,
    matchTimeRemaining: 180,
  };

  // Connect to backend server
  network.connect().then(() => {
    isOnline = true;
    console.log('Connected to Shooter WebSocket server!');
  }).catch(() => {
    isOnline = false;
    console.log('Operating in local practice mode (offline).');
  });

  network.onLobbyUpdate = (msg: ServerLobbyUpdate) => {
    // 1. Synchronize authoritative player ID from server
    const serverAssignedId = msg.your_id || msg.yourId;
    if (serverAssignedId) {
      playerCar.id = serverAssignedId;
    }

    currentOnlineRoomCode = msg.room_code || msg.roomCode || null;
    localRoomState.code = currentOnlineRoomCode || 'LOCAL';

    const roomCode = currentOnlineRoomCode || '';
    const isHost = msg.is_host ?? msg.isHost ?? false;

    // In online room, purge offline bots completely!
    if (isOnline && roomCode && roomCode !== 'LOCAL') {
      allCars = [playerCar];
    }

    // Convert server players to UI lobby players
    const players: LobbyPlayer[] = msg.players.map((p) => {
      const carType = (p.car_type || p.carType || 'stadium') as CarArchetype;
      return {
        id: p.id,
        name: p.name,
        archetype: carType,
        carType,
        isReady: p.ready,
        isHost: p.is_host ?? p.isHost ?? false,
        ping: network.latency,
      };
    });

    if (msg.map) {
      track = getTrack(msg.map);
    }

    const roomState: RoomState = {
      code: roomCode,
      hostId: isHost ? playerCar.id : (players.find((p) => p.isHost)?.id || ''),
      players,
      map: msg.map,
      matchActive: msg.status === 'playing',
      countdown: msg.countdown,
    };

    lobby.updateRoom(roomState, playerCar.id);
  };

  network.onGameStart = (msg) => {
    // In online match, strictly clear offline bots
    if (isOnline) {
      allCars = [playerCar];
    }
    if (msg.map) {
      track = getTrack(msg.map);
    }
    const r = msg.round || 1;
    const tr = msg.total_rounds || msg.totalRounds || 3;
    hud.setTournamentState(r, tr, msg.map || track.name);
    hud.isTournamentComplete = false;
    matchTimeRemaining = typeof msg.match_time_remaining === 'number'
      ? msg.match_time_remaining
      : (typeof msg.matchTimeRemaining === 'number' ? msg.matchTimeRemaining : 180);
    const cd = typeof msg.countdown === 'number' ? msg.countdown : 3;
    startMatchCountdown(cd);
  };

  network.onWorldState = (snapshot: ServerWorldState) => {
    if (snapshot.round !== undefined) {
      hud.round = snapshot.round;
    }
    if (snapshot.total_rounds !== undefined || snapshot.totalRounds !== undefined) {
      hud.totalRounds = snapshot.total_rounds || snapshot.totalRounds || 3;
    }
    if (snapshot.match_time_remaining !== undefined || snapshot.matchTimeRemaining !== undefined) {
      matchTimeRemaining = snapshot.match_time_remaining ?? snapshot.matchTimeRemaining ?? matchTimeRemaining;
    }

    if (!matchActive && countdown === null && snapshot.players.length > 0) {
      matchActive = true;
    }

    if (!matchActive) return;

    // Prune cars that are no longer in server snapshot
    const activeIds = new Set(snapshot.players.map((p) => p.id));
    if (isOnline) {
      allCars = allCars.filter((c) => c.isLocal || activeIds.has(c.id));
    }

    // Update / reconcile remote players
    for (const p of snapshot.players) {
      if (p.id === playerCar.id) {
        if (!playerCar.isAlive && (p.is_alive ?? p.isAlive)) {
          playerCar.x = p.x;
          playerCar.y = p.y;
          playerCar.vx = p.vx;
          playerCar.vy = p.vy;
          playerCar.angle = p.angle;
          playerCar.health = p.health;
          playerCar.isAlive = true;
          playerCar.respawnShieldDuration = 2.5;
        } else if (playerCar.isAlive) {
          const errDist = Math.hypot(p.x - playerCar.x, p.y - playerCar.y);
          if (forceSnapOnFocus || errDist > 120) {
            playerCar.x = p.x;
            playerCar.y = p.y;
            playerCar.vx = p.vx;
            playerCar.vy = p.vy;
          } else if (errDist > 2) {
            // Smoothly converge local position towards authoritative server without snapping
            playerCar.x += (p.x - playerCar.x) * 0.15;
            playerCar.y += (p.y - playerCar.y) * 0.15;
          }

          // Smooth chassis heading alignment without overriding active player steering
          const angleDiff = normalizeAngle(p.angle - playerCar.angle);
          if (forceSnapOnFocus || Math.abs(angleDiff) > 1.2) {
            playerCar.angle = p.angle;
          } else if (Math.abs(angleDiff) > 0.05) {
            playerCar.angle = normalizeAngle(playerCar.angle + angleDiff * 0.12);
          }
        }
        // Reconcile server health & score for local player
        playerCar.health = p.health;
        playerCar.maxHealth = p.max_health || p.maxHealth || playerCar.maxHealth;
        playerCar.score = p.score;
        playerCar.kills = p.kills;
        playerCar.deaths = p.deaths;
        playerCar.isAlive = p.is_alive ?? p.isAlive ?? true;
        continue;
      }

      let remote = allCars.find((c) => c.id === p.id);
      const carArchetype = (p.car_type || p.carType || 'stadium') as CarArchetype;
      if (!remote) {
        const cfg = CAR_CONFIGS[carArchetype];
        remote = {
          id: p.id,
          name: p.name,
          archetype: carArchetype,
          x: p.x,
          y: p.y,
          vx: p.vx,
          vy: p.vy,
          angle: p.angle,
          angularVelocity: p.angular_velocity || p.angularVelocity || 0,
          steer: p.steer,
          throttle: 0,
          handbrake: false,
          speed: Math.hypot(p.vx, p.vy),
          driftSlip: 0,
          skidIntensity: p.drift ? 1 : 0,
          isDrifting: p.drift,
          driftAngle: 0,
          health: p.health,
          maxHealth: p.max_health || p.maxHealth || cfg.maxHealth,
          armor: 50,
          maxArmor: 50,
          isLocal: false,
          isAlive: p.is_alive ?? p.isAlive ?? true,
          score: p.score,
          kills: p.kills,
          deaths: p.deaths,
          shieldActive: p.shield > 0,
          shieldDuration: p.shield,
          ramActive: false,
          ramDuration: 0,
          boostActive: p.boost > 0,
          boostDuration: p.boost,
          empDisrupted: false,
          empDuration: 0,
          primaryCooldown: 0,
          specialCooldown: 0,
          mobilityCooldown: 0,
          gadgetCooldown: 0,
        };
        allCars.push(remote);
      } else {
        const remDist = Math.hypot(p.x - remote.x, p.y - remote.y);
        if (forceSnapOnFocus || remDist > 120) {
          remote.x = p.x;
          remote.y = p.y;
        } else {
          remote.x += (p.x - remote.x) * 0.35;
          remote.y += (p.y - remote.y) * 0.35;
        }
        const remAngleDiff = normalizeAngle(p.angle - remote.angle);
        if (Math.abs(remAngleDiff) > 0.04) {
          remote.angle = normalizeAngle(remote.angle + remAngleDiff * 0.35);
        }
        remote.vx = p.vx;
        remote.vy = p.vy;
        remote.health = p.health;
        remote.isAlive = p.is_alive ?? p.isAlive ?? true;
        remote.isDrifting = p.drift;
        remote.skidIntensity = p.drift ? 0.9 : 0;
        remote.speed = Math.hypot(p.vx, p.vy);
        remote.score = p.score;
        remote.kills = p.kills;
        remote.deaths = p.deaths;
        remote.steer = p.steer;
      }
    }
    forceSnapOnFocus = false;

    // Keep the WebRTC voice mesh in sync with the authoritative roster.
    if (isOnline) {
      const remoteIds = new Set(
        snapshot.players.filter((p) => p.id !== playerCar.id).map((p) => p.id)
      );
      for (const id of remoteIds) {
        if (!voiceChat.getPeer(id)) {
          // Deterministic initiator election avoids offer glare between peers.
          void voiceChat.addPeer(id, playerCar.id < id);
        }
      }
      for (const id of Array.from(voiceChat.getPeers().keys())) {
        if (!remoteIds.has(id)) voiceChat.removePeer(id);
      }
    }

    // Killfeed updates
    for (const item of snapshot.killfeed) {
      hud.addKill(
        item.killer_name || item.killerName || 'PILOT',
        item.victim_name || item.victimName || 'TARGET',
        item.weapon
      );
    }
  };

  network.onGameOver = (results) => {
    matchActive = false;
    sfx.explosionSound();
    console.log('Game over!', results);
    hud.setPodium(true, results.scoreboard);
  };

  // Set up lobby callbacks
  lobby.setCallbacks({
    onCreateRoom: (nickname, archetype, mapId) => {
      sfx.ensureContext();
      if (mapId) track = getTrack(mapId);
      playerCar.name = nickname;
      playerCar.archetype = archetype;
      if (network.getConnected()) {
        allCars = [playerCar]; // Purge bots
        network.joinLobby(nickname, undefined, archetype);
      } else {
        localRoomState.code = `ARENA-${Math.floor(10 + Math.random() * 90)}`;
        localRoomState.players[0].name = nickname;
        localRoomState.players[0].archetype = archetype;
        lobby.updateRoom(localRoomState, playerCar.id);
      }
    },
    onSelectMap: (mapId: string) => {
      track = getTrack(mapId);
    },
    onJoinRoom: (code, nickname, archetype) => {
      sfx.ensureContext();
      playerCar.name = nickname;
      playerCar.archetype = archetype;
      if (network.getConnected()) {
        allCars = [playerCar]; // Purge bots
        network.joinLobby(nickname, code, archetype);
      } else {
        localRoomState.code = code;
        localRoomState.players[0].name = nickname;
        localRoomState.players[0].archetype = archetype;
        lobby.updateRoom(localRoomState, playerCar.id);
      }
    },
    onSelectCar: (archetype: CarArchetype) => {
      playerCar.archetype = archetype;
      const cfg = CAR_CONFIGS[archetype];
      playerCar.health = cfg.maxHealth;
      playerCar.maxHealth = cfg.maxHealth;
      if (network.getConnected()) {
        network.selectCar(archetype);
      } else {
        localRoomState.players[0].archetype = archetype;
        lobby.updateRoom(localRoomState, playerCar.id);
      }
    },
    onToggleReady: (ready: boolean) => {
      sfx.ensureContext();
      if (network.getConnected()) {
        network.setReady(ready);
      } else {
        localRoomState.players[0].isReady = ready;
        lobby.updateRoom(localRoomState, playerCar.id);
      }
    },
    onStartSolo: (nickname, archetype, mapId) => {
      sfx.ensureContext();
      offlineRound = 1;
      hud.isTournamentComplete = false;
      hud.setTournamentState(1, offlineTotalRounds);
      if (mapId) {
        track = getTrack(mapId);
      } else {
        track = getTrack(offlineMapRotation[0]);
      }
      hud.mapName = track.name || 'Stadium';
      matchTimeRemaining = 180;

      playerCar.name = nickname;
      playerCar.archetype = archetype;
      const cfg = CAR_CONFIGS[archetype];
      playerCar.health = cfg.maxHealth;
      playerCar.maxHealth = cfg.maxHealth;
      playerCar.x = 800;
      playerCar.y = 380;
      playerCar.angle = 0;
      playerCar.vx = 0;
      playerCar.vy = 0;
      playerCar.angularVelocity = 0;
      playerCar.isAlive = true;
      bot1.x = 2800;
      bot1.y = 2020;
      bot1.angle = Math.PI;
      bot1.vx = 0;
      bot1.vy = 0;
      bot1.angularVelocity = 0;
      bot1.isAlive = true;
      bot1.health = bot1.maxHealth;
      bot2.x = 2800;
      bot2.y = 380;
      bot2.angle = Math.PI;
      bot2.vx = 0;
      bot2.vy = 0;
      bot2.angularVelocity = 0;
      bot2.isAlive = true;
      bot2.health = bot2.maxHealth;
      botEngagementTimer = 2.0;
      allCars = [playerCar, bot1, bot2];
      startMatchCountdown(3);
    },
    onStartMatch: () => {
      sfx.ensureContext();
      if (isOnline && network.getConnected() && currentOnlineRoomCode) {
        network.startGame();
      } else {
        offlineRound = 1;
        hud.isTournamentComplete = false;
        hud.setTournamentState(1, offlineTotalRounds);
        matchTimeRemaining = 180;
        allCars = [playerCar, bot1, bot2];
        startMatchCountdown(3);
      }
    },
  });

  lobby.updateRoom(localRoomState, playerCar.id);

  function startMatchCountdown(startVal = 3): void {
    lobby.hide();
    botEngagementTimer = 2.0;
    if (matchTimeRemaining <= 0) {
      matchTimeRemaining = 180;
    }
    if (startVal === 0) {
      matchActive = true;
      countdown = null;
      sfx.countdownBeep(880, true);
      return;
    }
    countdown = startVal;
    sfx.countdownBeep(440, false);

    const interval = window.setInterval(() => {
      if (countdown === null) {
        window.clearInterval(interval);
        return;
      }
      countdown -= 1;
      if (countdown > 0) {
        sfx.countdownBeep(440, false);
      } else if (countdown === 0) {
        sfx.countdownBeep(880, true);
        if (matchTimeRemaining <= 0) {
          matchTimeRemaining = 180;
        }
        matchActive = true;
        window.setTimeout(() => {
          countdown = null;
        }, 1200);
        window.clearInterval(interval);
      }
    }, 1000);
  }

  // Combat impact handler
  const handleImpact = (_x: number, _y: number, trauma: number) => {
    renderer3d.addScreenShake(trauma);
  };

  const handleKill = (killerName: string, victimName: string, weapon: string) => {
    hud.addKill(killerName, victimName, weapon);
  };

  // Main Animation Loop
  let lastTime = performance.now();

  function loop(currentTime: number): void {
    const dt = Math.min(0.1, (currentTime - lastTime) / 1000);
    lastTime = currentTime;

    if (matchActive) {
      botEngagementTimer = Math.max(0, botEngagementTimer - dt);
    }

    // 1. Process Controls & Physics
    let currentLookBack = false;
    if (matchActive && playerCar.isAlive) {
      const input = inputController.sample(dt);
      currentLookBack = input.lookBack ?? false;
      playerCar.throttle = input.throttle;
      playerCar.steer = input.steer;
      playerCar.handbrake = input.brake;

      const config = CAR_CONFIGS[playerCar.archetype];
      stepVehicle(playerCar, input, config, dt, undefined, undefined, track.ramps);

      if (turnaroundCooldown > 0) {
        turnaroundCooldown = Math.max(0, turnaroundCooldown - dt);
      }
      if (input.turnaround && turnaroundCooldown <= 0) {
        turnaroundCooldown = 1.2;
        playerCar.angle = normalizeAngle(playerCar.angle + Math.PI);
        playerCar.angularVelocity = 0;
        particles.emitShockwave(playerCar.x, playerCar.y, 65, '#00f0ff');
        sfx.boostPadWhoosh();
      }

      // Send to authoritative server if connected
      if (isOnline && network.getConnected()) {
        inputSequence++;
        network.sendInput(
          inputSequence,
          input.throttle,
          input.steer,
          input.brake,
          input.firePrimary,
          input.fireSpecial,
          input.abilityMobility,
          input.abilityUtility,
          input.turnaround ?? false
        );
      }

      // Audio engine pitch modulation
      const speedRatio = playerCar.speed / config.maxSpeed;
      sfx.updateEngine(speedRatio, input.throttle > 0.05, playerCar.archetype);
      sfx.updateSkid(playerCar.skidIntensity);

      // Combat actions:
      if (input.firePrimary) {
        const res = firePrimaryWeapon(playerCar, particles);
        if (res) activeProjectiles.push(res.projectile);
      }
      if (input.fireSpecial) {
        const res = activateSpecialAbility(playerCar, allCars, particles, handleImpact, handleKill, activeProjectiles);
        if (res) activeProjectiles.push(...res.newProjectiles);
      }
      if (input.abilityMobility) {
        activateMobilityAbility(playerCar, particles, allCars);
      }
      if (input.abilityUtility) {
        const res = activateTacticalGadget(playerCar, particles, allCars);
        if (res) activeProjectiles.push(...res.newProjectiles);
      }
    }

    // 2. Offline Bot Sparring AI (runs whenever bots are in match)
    const inServerRoom = isOnline && network.getConnected() && currentOnlineRoomCode && currentOnlineRoomCode !== 'LOCAL';
    if (!inServerRoom) {
      for (const bot of [bot1, bot2]) {
        if (!bot.isAlive || !matchActive) continue;
        const bConfig = CAR_CONFIGS[bot.archetype];

        // Aim towards player
        const dx = playerCar.x - bot.x;
        const dy = playerCar.y - bot.y;
        const targetAngle = Math.atan2(dy, dx);
        let angleDiff = targetAngle - bot.angle;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        const steer = Math.max(-1, Math.min(1, angleDiff * 2.5));
        const dist = Math.hypot(dx, dy);
        const throttle = dist > 200 ? 0.75 : 0.3;

        const botInput = {
          sequence: 1,
          throttle,
          steer,
          brake: Math.abs(angleDiff) > 1.2,
          firePrimary: botEngagementTimer <= 0 && dist < 500 && Math.abs(angleDiff) < 0.25,
          fireSpecial: false,
          abilityMobility: false,
          abilityUtility: false,
        };

        stepVehicle(bot, botInput, bConfig, dt, undefined, undefined, track.ramps);

        if (botInput.firePrimary) {
          const res = firePrimaryWeapon(bot, particles);
          if (res) activeProjectiles.push(res.projectile);
        }
      }
    }

    // 3. Update abilities, cooldowns, & respawns
    for (const car of allCars) {
      updateCarAbilities(car, dt);

      // Invulnerability bubble on spawn
      if (car.respawnShieldDuration && car.respawnShieldDuration > 0) {
        car.respawnShieldDuration = Math.max(0, car.respawnShieldDuration - dt);
        car.shieldActive = true;
        car.shieldDuration = Math.max(car.shieldDuration, car.respawnShieldDuration);
        if (car.respawnShieldDuration <= 0) {
          car.shieldActive = false;
        }
      }

      // Respawn handler for dead cars
      if (!car.isAlive && (car.respawnTimer ?? 0) > 0) {
        car.respawnTimer = (car.respawnTimer ?? 3.5) - dt;
        if (car.respawnTimer <= 0) {
          if (!inServerRoom) {
            const spawn = getSafeSpawnPoint(car, allCars);
            car.x = spawn.x;
            car.y = spawn.y;
            car.angle = spawn.angle;
            car.vx = 0;
            car.vy = 0;
            car.angularVelocity = 0;
            car.health = car.maxHealth;
            car.isAlive = true;
            car.respawnShieldDuration = 2.5;
            car.shieldActive = true;
            car.shieldDuration = 2.5;

            particles.emitShockwave(spawn.x, spawn.y, 80, '#00f0ff');
            if (car.isLocal) {
              sfx.boostPadWhoosh();
            }
          }
        }
      }

      // Check boost pads
      const padCd = padCooldowns.get(car.id) ?? 0;
      for (const pad of track.boostPads) {
        const bdx = car.x - pad.x;
        const bdy = car.y - pad.y;
        const padLen = Math.max(pad.width, pad.height);
        const padW = Math.min(pad.width, pad.height);
        const cosP = Math.cos(-pad.angle);
        const sinP = Math.sin(-pad.angle);
        const localX = bdx * cosP - bdy * sinP;
        const localY = bdx * sinP + bdy * cosP;
        if (Math.abs(localX) < padLen / 2 + 20 && Math.abs(localY) < padW / 2 + 20) {
          const forwardDot = Math.cos(car.angle - pad.angle);
          if (forwardDot > -0.2 && padCd <= 0 && !car.boostActive) {
            padCooldowns.set(car.id, 0.8);
            car.boostActive = true;
            car.boostDuration = 1.2;
            const force = pad.force ?? 480;
            car.vx += Math.cos(pad.angle) * force;
            car.vy += Math.sin(pad.angle) * force;
            const cfg = CAR_CONFIGS[car.archetype];
            const maxBoostSpd = cfg.maxSpeed * 1.4;
            const spd = Math.hypot(car.vx, car.vy);
            if (spd > maxBoostSpd) {
              car.vx = (car.vx / spd) * maxBoostSpd;
              car.vy = (car.vy / spd) * maxBoostSpd;
            }
            car.speed = Math.hypot(car.vx, car.vy);
            particles.emitShockwave(car.x, car.y, 80, '#00f0ff');
            if (car.isLocal) sfx.boostPadWhoosh();
            break;
          }
        }
      }
    }

    // Decay pad cooldowns
    for (const [id, cd] of padCooldowns) {
      if (cd > 0) {
        padCooldowns.set(id, Math.max(0, cd - dt));
      }
    }

    // 4. Resolve Environment & Car Collisions
    for (const car of allCars) {
      if (car.isAlive) {
        resolveTrackCollisions(car, track, car.archetype === 'desert' ? 24 : 20);
      }
    }
    if (!inServerRoom) {
      resolveCarCollisions(allCars, particles, handleImpact, handleKill);
    }

    // 5. Update Projectiles & Combat FX
    activeProjectiles = updateProjectiles(
      activeProjectiles,
      allCars,
      track,
      dt,
      particles,
      handleImpact,
      handleKill
    );

    // 6. Update Particles, 3D Camera & Positional Voice Audio
    particles.update(dt);
    renderer3d.updateCamera(playerCar, dt, currentLookBack);

    if (isOnline) {
      const remotePositions = new Map<string, { x: number; y: number }>();
      for (const car of allCars) {
        if (!car.isLocal && car.isAlive) {
          remotePositions.set(car.id, { x: car.x, y: car.y });
        }
      }
      voiceChat.updateSpatialAudio({ x: playerCar.x, y: playerCar.y }, remotePositions);
    }

    // 7. Update Match Timer & Offline Tournament Progression
    if (matchActive && matchTimeRemaining > 0) {
      matchTimeRemaining -= dt;
      if (matchTimeRemaining <= 0) {
        matchTimeRemaining = 0;
        if (!inServerRoom) {
          if (offlineRound < offlineTotalRounds) {
            offlineRound++;
            hud.setTournamentState(offlineRound, offlineTotalRounds);
            const nextMapId = offlineMapRotation[(offlineRound - 1) % offlineMapRotation.length];
            track = getTrack(nextMapId);
            hud.mapName = track.name || 'Stadium';
            matchTimeRemaining = 180;

            // Reset player and bots at safe spawn positions
            playerCar.x = 800;
            playerCar.y = 380;
            playerCar.angle = 0;
            playerCar.vx = 0;
            playerCar.vy = 0;
            playerCar.angularVelocity = 0;
            playerCar.health = playerCar.maxHealth;
            playerCar.isAlive = true;
            playerCar.respawnShieldDuration = 2.5;

            bot1.x = 2800;
            bot1.y = 2020;
            bot1.angle = Math.PI;
            bot1.vx = 0;
            bot1.vy = 0;
            bot1.angularVelocity = 0;
            bot1.health = bot1.maxHealth;
            bot1.isAlive = true;

            bot2.x = 2800;
            bot2.y = 380;
            bot2.angle = Math.PI;
            bot2.vx = 0;
            bot2.vy = 0;
            bot2.angularVelocity = 0;
            bot2.health = bot2.maxHealth;
            bot2.isAlive = true;

            startMatchCountdown(3);
          } else {
            hud.isTournamentComplete = true;
            matchActive = false;
          }
        } else {
          matchActive = false;
        }
      }
    }

    // 8. Render 3D WebGL Scene
    renderer3d.render(track, allCars, activeProjectiles, dt);

    // 9. Render 2D HUD Overlay on top (projecting 3D car coordinates to screen)
    const ctx = hudCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
    hud.render(
      ctx,
      hudCanvas.width,
      hudCanvas.height,
      playerCar,
      allCars,
      matchTimeRemaining,
      countdown,
      (car) => renderer3d.toScreen(car.x, car.y)
    );

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
}

// Start client on DOM load
window.addEventListener('DOMContentLoaded', main);
