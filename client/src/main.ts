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
import { resolveTrackCollisions, stepVehicle } from './physics/vehicle.ts';
import { HUDRenderer } from './render/hud';
import { ParticleSystem } from './render/particles';
import { Renderer3D } from './render3d/scene';
import {
  CarArchetype,
  CarState,
  LobbyPlayer,
  Projectile,
  RoomState,
  StadiumTrack,
  Vector2D,
} from './types';
import { LobbyUI } from './ui/lobby';

// ============================================================================
// Track Generation
// ============================================================================

function createStadiumTrack(): StadiumTrack {
  const width = 3600;
  const height = 2400;

  // Outer border rectangle with chamfered stadium corners
  const outerBorder: Vector2D[] = [
    { x: 300, y: 150 },
    { x: width - 300, y: 150 },
    { x: width - 150, y: 300 },
    { x: width - 150, y: height - 300 },
    { x: width - 300, y: height - 150 },
    { x: 300, y: height - 150 },
    { x: 150, y: height - 300 },
    { x: 150, y: 300 },
  ];

  // Inner stadium island border
  const innerBorder: Vector2D[] = [
    { x: 800, y: 650 },
    { x: width - 800, y: 650 },
    { x: width - 650, y: 800 },
    { x: width - 650, y: height - 800 },
    { x: width - 800, y: height - 650 },
    { x: 800, y: height - 650 },
    { x: 650, y: height - 800 },
    { x: 650, y: 800 },
  ];

  // Boost chevrons on straightaways
  const boostPads = [
    { id: 'b1', x: width / 2, y: 380, width: 90, height: 180, angle: 0, force: 450 },
    { id: 'b2', x: width / 2, y: height - 380, width: 90, height: 180, angle: Math.PI, force: 450 },
    { id: 'b3', x: 380, y: height / 2, width: 90, height: 180, angle: -Math.PI / 2, force: 450 },
    { id: 'b4', x: width - 380, y: height / 2, width: 90, height: 180, angle: Math.PI / 2, force: 450 },
  ];

  // Chicane safety barriers
  const barriers = [
    { id: 'c1', x: 1250, y: 400, width: 30, height: 160, angle: 0, color: '#ffcc00' },
    { id: 'c2', x: 2350, y: 400, width: 30, height: 160, angle: 0, color: '#ffcc00' },
    { id: 'c3', x: 1250, y: height - 400, width: 30, height: 160, angle: 0, color: '#ffcc00' },
    { id: 'c4', x: 2350, y: height - 400, width: 30, height: 160, angle: 0, color: '#ffcc00' },
  ];

  // Start / finish line strip
  const finishLine = {
    x1: width / 2 - 200,
    y1: 150,
    x2: width / 2 - 200,
    y2: 650,
    angle: Math.PI / 2,
  };

  return { width, height, outerBorder, innerBorder, boostPads, barriers, finishLine };
}

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
  const track = createStadiumTrack();
  const lobby = new LobbyUI();
  const network = new NetworkClient();

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

  // Local player car state
  const playerCar: CarState = {
    id: `pilot-${Math.floor(1000 + Math.random() * 9000)}`,
    name: 'PILOT-01',
    archetype: 'stadium',
    x: 550,
    y: 400,
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
    x: 950,
    y: 320,
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
    x: 1150,
    y: 480,
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

    const roomCode = msg.room_code || msg.roomCode || '';
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

    const roomState: RoomState = {
      code: roomCode,
      hostId: isHost ? playerCar.id : (players.find((p) => p.isHost)?.id || ''),
      players,
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
    startMatchCountdown(msg.countdown || 3);
  };

  network.onWorldState = (snapshot: ServerWorldState) => {
    if (!matchActive) return;

    // Prune cars that are no longer in server snapshot
    const activeIds = new Set(snapshot.players.map((p) => p.id));
    if (isOnline) {
      allCars = allCars.filter((c) => c.isLocal || activeIds.has(c.id));
    }

    // Update / reconcile remote players
    for (const p of snapshot.players) {
      if (p.id === playerCar.id) {
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
        // Smooth interpolation for remote vehicle movement
        remote.x += (p.x - remote.x) * 0.45;
        remote.y += (p.y - remote.y) * 0.45;
        remote.vx = p.vx;
        remote.vy = p.vy;
        remote.angle = p.angle;
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
  };

  // Set up lobby callbacks
  lobby.setCallbacks({
    onCreateRoom: (nickname, archetype) => {
      sfx.ensureContext();
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
    onStartSolo: (nickname, archetype) => {
      sfx.ensureContext();
      playerCar.name = nickname;
      playerCar.archetype = archetype;
      const cfg = CAR_CONFIGS[archetype];
      playerCar.health = cfg.maxHealth;
      playerCar.maxHealth = cfg.maxHealth;
      allCars = [playerCar, bot1, bot2];
      startMatchCountdown(3);
    },
    onStartMatch: () => {
      sfx.ensureContext();
      const inServerRoom = isOnline && network.getConnected() && localRoomState.code && localRoomState.code !== 'LOCAL';
      if (inServerRoom) {
        network.startGame();
      } else {
        allCars = [playerCar, bot1, bot2];
        startMatchCountdown(3);
      }
    },
  });

  lobby.updateRoom(localRoomState, playerCar.id);

  function startMatchCountdown(startVal = 3): void {
    lobby.hide();
    countdown = startVal;
    sfx.countdownBeep(440, false);

    const interval = window.setInterval(() => {
      if (countdown === null) return;
      countdown -= 1;
      if (countdown > 0) {
        sfx.countdownBeep(440, false);
      } else if (countdown === 0) {
        sfx.countdownBeep(880, true);
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

    // 1. Process Controls & Physics
    if (matchActive && playerCar.isAlive) {
      const input = inputController.sample(dt);
      playerCar.throttle = input.throttle;
      playerCar.steer = input.steer;
      playerCar.handbrake = input.brake;

      const config = CAR_CONFIGS[playerCar.archetype];
      stepVehicle(playerCar, input, config, dt);

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
          input.abilityUtility
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
        const res = activateSpecialAbility(playerCar, allCars, particles, handleImpact, handleKill);
        if (res) activeProjectiles.push(...res.newProjectiles);
      }
      if (input.abilityMobility) {
        activateMobilityAbility(playerCar, particles);
      }
      if (input.abilityUtility) {
        const res = activateTacticalGadget(playerCar, particles);
        if (res) activeProjectiles.push(...res.newProjectiles);
      }
    }

    // 2. Offline Bot Sparring AI (runs whenever bots are in match)
    const inServerRoom = isOnline && network.getConnected() && localRoomState.code && localRoomState.code !== 'LOCAL';
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
          firePrimary: dist < 500 && Math.abs(angleDiff) < 0.25,
          fireSpecial: false,
          abilityMobility: false,
          abilityUtility: false,
        };

        stepVehicle(bot, botInput, bConfig, dt);

        if (botInput.firePrimary) {
          const res = firePrimaryWeapon(bot, particles);
          if (res) activeProjectiles.push(res.projectile);
        }
      }
    }

    // 3. Update abilities & cooldowns
    for (const car of allCars) {
      updateCarAbilities(car, dt);

      // Check boost pads
      for (const pad of track.boostPads) {
        const bdx = car.x - pad.x;
        const bdy = car.y - pad.y;
        if (Math.abs(bdx) < pad.width / 2 + 15 && Math.abs(bdy) < pad.height / 2 + 15) {
          const forwardDot = Math.cos(car.angle - pad.angle);
          if (forwardDot > -0.2 && !car.boostActive) {
            car.boostActive = true;
            car.boostDuration = 1.2;
            const force = pad.force ?? 450;
            car.vx += Math.cos(pad.angle) * force;
            car.vy += Math.sin(pad.angle) * force;
            particles.emitShockwave(car.x, car.y, 80, '#00f0ff');
            if (car.isLocal) sfx.boostPadWhoosh();
          }
        }
      }
    }

    // 4. Resolve Environment & Car Collisions
    for (const car of allCars) {
      if (car.isAlive) {
        resolveTrackCollisions(car, track, car.archetype === 'desert' ? 24 : 20);
      }
    }
    resolveCarCollisions(allCars, particles, handleImpact, handleKill);

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

    // 6. Update Particles & 3D Camera
    particles.update(dt);
    renderer3d.updateCamera(playerCar, dt);

    // 7. Update Match Timer
    if (matchActive && matchTimeRemaining > 0) {
      matchTimeRemaining -= dt;
      if (matchTimeRemaining <= 0) {
        matchTimeRemaining = 0;
        matchActive = false;
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
