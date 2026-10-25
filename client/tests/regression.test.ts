import test from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../src/physics/input.ts';
import { resolveTrackCollisions, stepVehicle } from '../src/physics/vehicle.ts';
import { CAR_CONFIGS } from '../src/physics/configs.ts';
import { firePrimaryWeapon } from '../src/combat/weapons.ts';
import { ParticleSystem } from '../src/render/particles.ts';
import type { CarState, StadiumTrack } from '../src/types.ts';

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
