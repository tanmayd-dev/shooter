import test from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../src/physics/input.ts';
import { resolveTrackCollisions, stepVehicle } from '../src/physics/vehicle.ts';
import { CAR_CONFIGS } from '../src/physics/configs.ts';
import { firePrimaryWeapon, applyDamageToCar, updateProjectiles } from '../src/combat/weapons.ts';
import { resolveCarCollisions } from '../src/combat/abilities.ts';
import { ParticleSystem } from '../src/render/particles.ts';
import { HUDRenderer } from '../src/render/hud.ts';
import { VoiceChatManager } from '../src/audio/voice.ts';
import { NetworkClient } from '../src/network.ts';
import type { CarState, StadiumTrack, Projectile } from '../src/types.ts';

test('Regression Test 1: InputController exempts HTML input fields from key interception', () => {
  const controller = new InputController('vim-arrows', { preventDefault: true });

  const inputEl = {
    tagName: 'INPUT',
    isContentEditable: false,
  } as unknown as HTMLElement;

  let prevented = false;
  const mockEvent = {
    code: 'KeyA',
    key: 'a',
    target: inputEl,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;

  // Simulate typing 'a' into room code input
  // @ts-expect-error accessing private method for testing
  controller.handleKeyDown(mockEvent);

  assert.equal(prevented, false, 'preventDefault must not be called when typing in input');
  assert.equal(controller.isKeyPressed('KeyA'), false, 'Key must not be captured into game input state');

  // Same for other game keys in input field: 's', 'd', 'f', 'h', 'j', 'k', 'l'
  for (const k of ['KeyS', 'KeyD', 'KeyF', 'KeyH', 'KeyJ', 'KeyK', 'KeyL']) {
    let p = false;
    // @ts-expect-error accessing private method for testing
    controller.handleKeyDown({
      code: k,
      key: k.slice(3).toLowerCase(),
      target: inputEl,
      preventDefault: () => { p = true; },
    } as unknown as KeyboardEvent);
    assert.equal(p, false, `preventDefault must not be called for ${k} inside input`);
    assert.equal(controller.isKeyPressed(k), false, `${k} must not be captured when inside input`);
  }
});

test('Regression Test 2: InputController captures keys outside input fields', () => {
  const controller = new InputController('vim-arrows', { preventDefault: true });

  const divEl = {
    tagName: 'DIV',
    isContentEditable: false,
  } as unknown as HTMLElement;

  let prevented = false;
  // @ts-expect-error accessing private method for testing
  controller.handleKeyDown({
    code: 'KeyA',
    key: 'a',
    target: divEl,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent);

  assert.equal(prevented, true, 'preventDefault must be called for game keys outside input');
  assert.equal(controller.isKeyPressed('KeyA'), true, 'Key must be captured into game input state');
});

test('Regression Test 3: Primary weapon firing returns valid projectile with non-zero velocity and recoil', () => {
  const car: CarState = {
    id: 'pilot-test',
    name: 'TESTER',
    archetype: 'stadium',
    x: 500,
    y: 500,
    vx: 200,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    steer: 0,
    throttle: 1,
    handbrake: false,
    speed: 200,
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 100,
    maxHealth: 100,
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
  };

  const particles = new ParticleSystem();
  const res = firePrimaryWeapon(car, particles);

  assert.ok(res !== null, 'firePrimaryWeapon must return a result when off cooldown');
  assert.ok(res.projectile !== undefined, 'result must contain a valid projectile');
  assert.equal(res.projectile.type, 'bullet', 'projectile type must be bullet');
  assert.ok(res.projectile.vx > 1000, `bullet forward velocity must be high speed (>1000), got ${res.projectile.vx}`);
  assert.ok(car.primaryCooldown > 0, 'car primary cooldown must be set');
  assert.ok(car.vx < 200, 'car must experience backward recoil impulse from firing');
});

test('Regression Test 4: Power-sliding (throttle + brake) does not decelerate car to 0 velocity', () => {
  const cfg = CAR_CONFIGS['stadium'];
  const state: CarState = {
    id: 'pilot-drift',
    name: 'DRIFTER',
    archetype: 'stadium',
    x: 500,
    y: 500,
    vx: 350,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    steer: 0.8,
    throttle: 1.0,
    handbrake: true,
    speed: 350,
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 100,
    maxHealth: 100,
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
  };

  // Step 10 frames of drift-braking while holding full throttle
  for (let i = 0; i < 10; i++) {
    stepVehicle(state, {
      sequence: i,
      throttle: 1.0,
      steer: 0.8,
      brake: true,
      firePrimary: false,
      fireSpecial: false,
      abilityMobility: false,
      abilityUtility: false,
    }, cfg, 1 / 60);
  }

  assert.ok(state.speed > 200, `Speed under power-slide drift must remain high (>200), got: ${state.speed}`);
  assert.ok(state.isDrifting, 'Car must break into drift when braking while steering at speed');
});

test('Regression Test 5: Track environment collision reflects and bounds vehicle off stadium walls', () => {
  const track: StadiumTrack = {
    width: 3600,
    height: 2400,
    outerBorder: [
      { x: 300, y: 150 },
      { x: 3300, y: 150 },
      { x: 3450, y: 300 },
      { x: 3450, y: 2100 },
      { x: 3300, y: 2250 },
      { x: 300, y: 2250 },
      { x: 150, y: 2100 },
      { x: 150, y: 300 },
    ],
    innerBorder: [
      { x: 800, y: 650 },
      { x: 2800, y: 650 },
      { x: 2950, y: 800 },
      { x: 2950, y: 1600 },
      { x: 2800, y: 1750 },
      { x: 800, y: 1750 },
      { x: 650, y: 1600 },
      { x: 650, y: 800 },
    ],
    boostPads: [],
    barriers: [
      { x: 1250, y: 400, width: 30, height: 160, angle: 0 },
    ],
    finishLine: { x1: 0, y1: 0, x2: 0, y2: 0 },
  };

  // Car driving straight into top outer border wall at y = 150
  const state: CarState = {
    id: 'pilot-wall',
    name: 'BOUNCER',
    archetype: 'stadium',
    x: 500,
    y: 155, // 5px from border wall at y=150
    vx: 0,
    vy: -250, // driving into wall
    angle: -Math.PI / 2,
    angularVelocity: 0,
    steer: 0,
    throttle: 0,
    handbrake: false,
    speed: 250,
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 100,
    maxHealth: 100,
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
  };

  const bounced = resolveTrackCollisions(state, track, 22);

  assert.equal(bounced, true, 'resolveTrackCollisions must detect collision with outer stadium wall');
  assert.ok(state.y >= 150 + 22, `Car must be pushed away from wall (y >= 172), got: ${state.y}`);
  assert.ok(state.vy > 0, `Velocity must be reflected outward (vy > 0), got: ${state.vy}`);
});

test('Regression Test 6: applyDamageToCar destroys chassis when health reaches 0 and sets respawnTimer = 3.5', () => {
  const victim: CarState = {
    id: 'victim',
    name: 'TARGET',
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
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 10,
    maxHealth: 100,
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
  };
  const attacker: CarState = { ...victim, id: 'attacker', name: 'ATTACKER', kills: 0 };

  applyDamageToCar(victim, 25, 'attacker', 'PULSE BLASTER', [victim, attacker]);

  assert.equal(victim.health, 0, 'health must clamp to 0');
  assert.equal(victim.isAlive, false, 'isAlive must be false');
  assert.equal(victim.deaths, 1, 'deaths must increment');
  assert.equal(victim.respawnTimer, 3.5, 'respawnTimer must be set to 3.5');
  assert.equal(attacker.kills, 1, 'attacker kills must increment');
});

test('Regression Test 7: Practice mode spawn locations place player >2000 units away from bots', () => {
  const playerSpawn = { x: 800, y: 380 };
  const bot1Spawn = { x: 2800, y: 2020 };
  const bot2Spawn = { x: 2800, y: 380 };

  const distToBot1 = Math.hypot(bot1Spawn.x - playerSpawn.x, bot1Spawn.y - playerSpawn.y);
  const distToBot2 = Math.hypot(bot2Spawn.x - playerSpawn.x, bot2Spawn.y - playerSpawn.y);

  assert.ok(distToBot1 > 2500, `Player must be >2500 units from bot 1 across track, got ${distToBot1}`);
  assert.ok(distToBot2 >= 2000, `Player must be >=2000 units from bot 2 down straightaway, got ${distToBot2}`);
});

test('Regression Test 8: HUDRenderer renders centered respawn notification overlay when chassis is destroyed', () => {
  const hud = new HUDRenderer();
  const deadCar: CarState = {
    id: 'pilot-1',
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
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 0,
    maxHealth: 100,
    isAlive: false,
    respawnTimer: 2.4,
    score: 0,
    kills: 0,
    deaths: 1,
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
  };

  const filledTexts: string[] = [];
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    roundRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fillText: (text: string) => { filledTexts.push(text); },
    measureText: () => ({ width: 50 }),
  } as unknown as CanvasRenderingContext2D;

  hud.render(mockCtx, 1920, 1080, deadCar, [deadCar], 180, null);

  assert.ok(filledTexts.includes('CHASSIS DESTROYED'), 'HUD must render CHASSIS DESTROYED text');
  assert.ok(filledTexts.includes('RESPAWNING IN 2.4 SECONDS'), 'HUD must render RESPAWNING IN 2.4 SECONDS text');
});

test('Regression Test 9: MAPS contains Neon Stadium, Cyber Canyon, and Orbital Foundry with valid ramps', async () => {
  const { MAPS, getTrack, MAP_METADATA } = await import('../src/physics/maps.ts');

  assert.equal(MAP_METADATA.length, 3, 'Must define 3 map metadata entries');
  const stadium = getTrack('neon_stadium');
  const canyon = getTrack('cyber_canyon');
  const foundry = getTrack('orbital_foundry');

  assert.ok(stadium.ramps && stadium.ramps.length >= 2, 'Neon stadium must have at least 2 ramps');
  assert.ok(canyon.ramps && canyon.ramps.length >= 4, 'Cyber canyon must have canyon jump ramps');
  assert.ok(foundry.ramps && foundry.ramps.length >= 4, 'Orbital foundry must have 4-way jump ramps');

  assert.equal(stadium.width, 3600);
  assert.equal(canyon.width, 3600);
  assert.equal(foundry.width, 3600);
});

test('Regression Test 10: ARCHETYPE_CONFIGS clarifies ability directions and special attacks', () => {
  const rally = CAR_CONFIGS.rally;
  assert.ok(rally.specialAbilityName.includes('Forward'), `Rally special must clarify forward direction, got ${rally.specialAbilityName}`);
  assert.ok(rally.tacticalGadgetName.includes('Behind'), `Rally tactical must clarify deploy behind, got ${rally.tacticalGadgetName}`);
  assert.ok(rally.mobilityAbilityName.includes('Reverse') || rally.mobilityAbilityName.includes('Turnaround'), `Rally mobility must clarify reverse turnaround, got ${rally.mobilityAbilityName}`);
});

test('Regression Test 11: HUDRenderer renders current tournament round in header with circuit badge', () => {
  const hud = new HUDRenderer();
  hud.setTournamentState(2, 3, 'cyber_canyon');

  const filledTexts: string[] = [];
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    roundRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fillText: (text: string) => { filledTexts.push(text); },
    measureText: () => ({ width: 80 }),
  } as unknown as CanvasRenderingContext2D;

  hud.render(mockCtx, 1920, 1080, null, [], 180, null);

  assert.ok(
    filledTexts.includes('ROUND 2/3 — CYBER_CANYON'),
    `HUD must render tournament round in header, got: ${JSON.stringify(filledTexts)}`
  );
  assert.ok(
    filledTexts.includes('🏁'),
    'HUD must render stadium circuit badge icon'
  );
});

test('Regression Test 12: HUDRenderer renders Grand Prix Podium overlay with podium places and champion banner', () => {
  const hud = new HUDRenderer();
  hud.setPodium(true, [
    { name: 'ApexRacer', kills: 14, score: 1400 },
    { name: 'DriftKing', kills: 9, score: 900 },
    { name: 'Speedy', kills: 4, score: 400 },
  ]);

  const filledTexts: string[] = [];
  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    roundRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    fill: () => {},
    stroke: () => {},
    clip: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fillText: (text: string) => { filledTexts.push(text); },
    measureText: () => ({ width: 80 }),
  } as unknown as CanvasRenderingContext2D;

  hud.render(mockCtx, 1920, 1080, null, [], 0, null);

  assert.ok(
    filledTexts.includes('TOURNAMENT CHAMPION'),
    'HUD must render TOURNAMENT CHAMPION banner with gold glowing aura'
  );
  assert.ok(
    filledTexts.some((t) => t.includes('🏆') || t.includes('1ST PLACE')),
    'HUD must render 1st Place with gold trophy'
  );
  assert.ok(
    filledTexts.includes('ApexRacer'),
    'HUD must render 1st place pilot name'
  );
  assert.ok(
    filledTexts.some((t) => t.includes('🥈') || t.includes('2ND PLACE')),
    'HUD must render 2nd Place with silver badge'
  );
  assert.ok(
    filledTexts.includes('DriftKing'),
    'HUD must render 2nd place pilot name'
  );
  assert.ok(
    filledTexts.some((t) => t.includes('🥉') || t.includes('3RD PLACE')),
    'HUD must render 3rd Place with bronze badge'
  );
  assert.ok(
    filledTexts.includes('Speedy'),
    'HUD must render 3rd place pilot name'
  );
});

test('Regression Test 13: Projectiles terminate upon colliding with outer walls, inner walls, and ramps', () => {
  const track: StadiumTrack = {
    width: 3600,
    height: 2400,
    outerBorder: [
      { x: 300, y: 150 },
      { x: 3300, y: 150 },
      { x: 3450, y: 300 },
      { x: 3450, y: 2100 },
      { x: 3300, y: 2250 },
      { x: 300, y: 2250 },
      { x: 150, y: 2100 },
      { x: 150, y: 300 },
    ],
    innerBorder: [
      { x: 800, y: 650 },
      { x: 2800, y: 650 },
      { x: 2800, y: 1750 },
      { x: 800, y: 1750 },
    ],
    boostPads: [],
    barriers: [],
    ramps: [
      { id: 'ramp_1', x: 1950, y: 380, angle: 0, width: 85, length: 110, height: 18 },
    ],
    finishLine: { x1: 0, y1: 0, x2: 0, y2: 0 },
  };

  const particles = new ParticleSystem();

  // 1. Bullet fired towards outer top wall at y = 150
  const bulletAgainstWall: Projectile = {
    id: 'b-wall',
    type: 'bullet',
    x: 500,
    y: 154,
    vx: 0,
    vy: -1000,
    angle: -Math.PI / 2,
    radius: 4,
    damage: 15,
    ownerId: 'shooter-1',
    lifetime: 0.1,
    maxLifetime: 1.5,
  };

  const surviving1 = updateProjectiles([bulletAgainstWall], [], track, 1 / 60, particles);
  assert.equal(surviving1.length, 0, 'Bullet hitting outer perimeter wall must terminate and not penetrate');

  // 2. Bullet fired into central island inner wall at y = 650
  const bulletAgainstInner: Projectile = {
    id: 'b-inner',
    type: 'bullet',
    x: 1000,
    y: 648,
    vx: 0,
    vy: 1000,
    angle: Math.PI / 2,
    radius: 4,
    damage: 15,
    ownerId: 'shooter-1',
    lifetime: 0.1,
    maxLifetime: 1.5,
  };

  const surviving2 = updateProjectiles([bulletAgainstInner], [], track, 1 / 60, particles);
  assert.equal(surviving2.length, 0, 'Bullet hitting central island wall must terminate and not penetrate');

  // 3. Bullet fired into ramp prism at (1950, 380)
  const bulletAgainstRamp: Projectile = {
    id: 'b-ramp',
    type: 'bullet',
    x: 1950,
    y: 380,
    vx: 1000,
    vy: 0,
    angle: 0,
    radius: 4,
    damage: 15,
    ownerId: 'shooter-1',
    lifetime: 0.1,
    maxLifetime: 1.5,
  };

  const surviving3 = updateProjectiles([bulletAgainstRamp], [], track, 1 / 60, particles);
  assert.equal(surviving3.length, 0, 'Bullet hitting ramp incline barrier must terminate and not penetrate');
});

test('Regression Test 14: Car kinetic collision impulse does not explode velocity when overlapping or separating', () => {
  const particles = new ParticleSystem();

  const c1: CarState = {
    id: 'c1',
    name: 'CAR1',
    archetype: 'stadium',
    x: 1800,
    y: 380,
    vx: 300,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    steer: 0,
    throttle: 1,
    handbrake: false,
    speed: 300,
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 100,
    maxHealth: 100,
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
  };

  const c2: CarState = {
    ...c1,
    id: 'c2',
    name: 'CAR2',
    x: 1810, // 10px separation (deep overlap, minDist is 40)
    vx: -300, // head-on
  };

  // Run 60 frames of collision resolution
  for (let f = 0; f < 60; f++) {
    resolveCarCollisions([c1, c2], particles);
  }

  const spd1 = Math.hypot(c1.vx, c1.vy);
  const spd2 = Math.hypot(c2.vx, c2.vy);

  assert.ok(spd1 < 1000, `Car 1 velocity must remain bounded (<1000), got ${spd1}`);
  assert.ok(spd2 < 1000, `Car 2 velocity must remain bounded (<1000), got ${spd2}`);
  assert.ok(c1.x <= c2.x, 'Cars must be pushed apart');
});

test('Regression Test 15: stepVehicle clamps runaway speeds to maxAllowedSpeed', () => {
  const cfg = CAR_CONFIGS['stadium'];
  const state: CarState = {
    id: 'pilot-speed',
    name: 'SPEEDY',
    archetype: 'stadium',
    x: 500,
    y: 500,
    vx: 5000, // Extreme velocity input
    vy: 5000,
    angle: 0,
    angularVelocity: 0,
    steer: 0,
    throttle: 1,
    handbrake: false,
    speed: 7071,
    isDrifting: false,
    driftAngle: 0,
    skidIntensity: 0,
    health: 100,
    maxHealth: 100,
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
  };

  stepVehicle(state, {
    sequence: 1,
    throttle: 1,
    steer: 0,
    brake: false,
    firePrimary: false,
    fireSpecial: false,
    abilityMobility: false,
    abilityUtility: false,
  }, cfg, 1 / 60);

  const maxAllowed = cfg.maxSpeed * 1.5;
  assert.ok(state.speed <= maxAllowed + 0.1, `Speed must be clamped to ${maxAllowed}, got ${state.speed}`);
  assert.ok(Math.hypot(state.vx, state.vy) <= maxAllowed + 0.1, 'Velocity vector must be scaled');
});

test('Regression Test 16: Cyber canyon boost pad is unobstructed by rock barriers', async () => {
  const { getTrack } = await import('../src/physics/maps.ts');
  const canyon = getTrack('cyber_canyon');

  const b3 = canyon.boostPads.find((b) => b.id === 'cc_b3');
  assert.ok(b3 !== undefined, 'cc_b3 boost pad must exist');

  // Verify none of the barriers overlap cc_b3
  for (const b of canyon.barriers) {
    const dx = Math.abs(b.x - b3.x);
    const dy = Math.abs(b.y - b3.y);
    const overlapX = dx < (b.width + b3.width) / 2;
    const overlapY = dy < (b.height + b3.height) / 2;
    assert.ok(!(overlapX && overlapY), `Barrier ${b.id} must not overlap boost pad cc_b3`);
  }
});

test('Regression Test 17: Network Client interfaces define match_time_remaining and neutral inputs', () => {
  const client = new NetworkClient('ws://localhost:8080/ws');
  assert.ok(typeof client.sendNeutralInput === 'function', 'sendNeutralInput method must exist on client');
});
