import test from 'node:test';
import assert from 'node:assert/strict';
import { CameraController3D } from './camera.ts';
import { CarModelManager, Car3DModel } from './cars.ts';
import { Track3D } from './track.ts';
import type { CarState, Projectile, StadiumTrack } from '../types.ts';

// Mock minimal document if running in plain Node environment
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 512,
          height: 512,
          getContext: () => ({
            fillStyle: '',
            fillRect: () => {},
            strokeStyle: '',
            lineWidth: 1,
            beginPath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            stroke: () => {},
            fill: () => {},
            closePath: () => {},
          }),
        };
      }
      return {};
    },
  };
}

test('3D Camera Controller - Chase Cam, Stadium Cam & Dual-Mode Controls', () => {
  const cameraCtrl = new CameraController3D(1920, 1080);
  assert.equal(cameraCtrl.getMode(), 'chase');

  // Toggle to stadium mode
  const newMode = cameraCtrl.toggleMode();
  assert.equal(newMode, 'stadium');
  assert.equal(cameraCtrl.getMode(), 'stadium');

  // Toggle back to chase mode
  cameraCtrl.toggleMode();
  assert.equal(cameraCtrl.getMode(), 'chase');

  // Trauma & screen shake
  cameraCtrl.addTrauma(0.5);
  assert.ok(cameraCtrl.trauma > 0.4);

  // Update with dummy car target
  const dummyCar: CarState = {
    id: 'test-car',
    name: 'TESTER',
    archetype: 'stadium',
    x: 1800,
    y: 1200,
    vx: 500,
    vy: 0,
    angle: 0,
    angularVelocity: 0,
    steer: 0.5,
    throttle: 1,
    handbrake: false,
    speed: 500,
    isDrifting: true,
    driftAngle: 0.2,
    skidIntensity: 0.8,
    health: 100,
    maxHealth: 100,
    isAlive: true,
    kills: 0,
    deaths: 0,
    score: 0,
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

  cameraCtrl.update(dummyCar, 0.016);
  assert.ok(cameraCtrl.camera.position.x > 0);
  assert.ok(cameraCtrl.camera.position.y > 0);

  // Test screen projection
  const screenPos = cameraCtrl.toScreen(1800, 1200, 1920, 1080);
  assert.ok(screenPos !== null);
  assert.ok(typeof screenPos.x === 'number');
  assert.ok(typeof screenPos.y === 'number');

  cameraCtrl.dispose();
});

test('3D Car Models - Procedural Archetypes & Wheel Steering', () => {
  const archetypes = ['stadium', 'desert', 'rally'] as const;

  for (const arch of archetypes) {
    const model = new Car3DModel(arch);
    assert.equal(model.archetype, arch);
    assert.ok(model.group.children.length > 0);

    const dummyCar: CarState = {
      id: `car-${arch}`,
      name: `PILOT-${arch.toUpperCase()}`,
      archetype: arch,
      x: 1000,
      y: 800,
      vx: 400,
      vy: 200,
      angle: Math.PI / 4,
      angularVelocity: 0,
      steer: -0.75, // Steer left
      throttle: 0.9,
      handbrake: false,
      speed: 450,
      isDrifting: true,
      driftAngle: 0.15,
      skidIntensity: 0.9,
      health: 90,
      maxHealth: 100,
      isAlive: true,
      kills: 0,
      deaths: 0,
      score: 0,
      shieldActive: true,
      shieldDuration: 2.0,
      ramActive: false,
      ramDuration: 0,
      boostActive: true,
      boostDuration: 1.0,
      empDisrupted: false,
      empDuration: 0,
      primaryCooldown: 0,
      specialCooldown: 0,
      mobilityCooldown: 0,
      gadgetCooldown: 0,
    };

    model.update(dummyCar, 0.016, 1.0);
    assert.equal(model.group.position.x, 1000);
    assert.equal(model.group.position.z, 800);

    const contacts = model.getWheelContactWorldPositions();
    assert.equal(contacts.length, 4);

    model.dispose();
  }
});

test('3D Track - Stadium Mesh, Checkered Finish Gantry & Boost Pads', () => {
  const dummyTrack: StadiumTrack = {
    width: 3600,
    height: 2400,
    outerBorder: [
      { x: 200, y: 150 },
      { x: 3400, y: 150 },
      { x: 3400, y: 2250 },
      { x: 200, y: 2250 },
    ],
    innerBorder: [
      { x: 700, y: 650 },
      { x: 2900, y: 650 },
      { x: 2900, y: 1750 },
      { x: 700, y: 1750 },
    ],
    boostPads: [
      { id: 'b1', x: 1800, y: 380, width: 90, height: 180, angle: 0, force: 450 },
    ],
    barriers: [
      { x: 1200, y: 400, width: 30, height: 160, angle: 0, color: '#ffcc00' },
    ],
    finishLine: {
      x1: 1600,
      y1: 150,
      x2: 1600,
      y2: 650,
    },
  };

  const track3D = new Track3D(dummyTrack);
  assert.ok(track3D.group.children.length >= 4);

  // Update animation (boost pulse, beacon strobes)
  track3D.update(0.016, 2.5);

  track3D.dispose();
});

test('3D CarModelManager - Full Simulation Update Loop', () => {
  const manager = new CarModelManager();

  const cars: CarState[] = [
    {
      id: 'car-1',
      name: 'LOCAL-01',
      archetype: 'stadium',
      x: 1600,
      y: 400,
      vx: 600,
      vy: 0,
      angle: 0,
      angularVelocity: 0,
      steer: 0.2,
      throttle: 1,
      handbrake: false,
      speed: 600,
      isDrifting: false,
      driftAngle: 0,
      skidIntensity: 0,
      health: 100,
      maxHealth: 100,
      isAlive: true,
      kills: 1,
      deaths: 0,
      score: 100,
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
    },
  ];

  const projectiles: Projectile[] = [
    {
      id: 'proj-1',
      type: 'bullet',
      x: 1650,
      y: 400,
      vx: 1200,
      vy: 0,
      angle: 0,
      radius: 4,
      damage: 15,
      ownerId: 'car-1',
      lifetime: 0.2,
      maxLifetime: 1.5,
    },
    {
      id: 'proj-2',
      type: 'rocket',
      x: 1700,
      y: 400,
      vx: 900,
      vy: 0,
      angle: 0,
      radius: 6,
      damage: 45,
      ownerId: 'car-1',
      lifetime: 0.5,
      maxLifetime: 2.5,
    },
    {
      id: 'proj-3',
      type: 'mine',
      x: 1500,
      y: 400,
      vx: 0,
      vy: 0,
      angle: 0,
      radius: 12,
      damage: 60,
      ownerId: 'car-1',
      lifetime: 5.0,
      maxLifetime: 30.0,
    },
  ];

  manager.update(cars, projectiles, 0.016, 1.0);
  assert.ok(manager.group.children.length > 0);

  manager.dispose();
});
