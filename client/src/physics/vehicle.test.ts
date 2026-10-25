/**
 * Standalone unit test suite for Trackmania vehicle dynamics engine.
 * Run directly with `node src/physics/vehicle.test.ts`.
 */

import {
  createVehicleState,
  stepVehicle,
  resolveWallBounce,
  resolveArenaBounds,
  resolveBarrierCollisions,
  Vehicle,
} from "./vehicle.ts";
import { CAR_CONFIGS, getCarConfig } from "./configs.ts";
import { InputController } from "./input.ts";
import type { InputState } from "../types.ts";

// ============================================================================
// Lightweight Zero-Dependency Test Framework
// ============================================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let currentSuite = "";

function describe(suiteName: string, fn: () => void): void {
  const prevSuite = currentSuite;
  currentSuite = prevSuite ? `${prevSuite} > ${suiteName}` : suiteName;
  console.log(`\n--- ${currentSuite} ---`);
  try {
    fn();
  } finally {
    currentSuite = prevSuite;
  }
}

function it(testName: string, fn: () => void): void {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${testName}`);
  } catch (err: unknown) {
    failedTests++;
    console.error(`  ✗ ${testName}`);
    console.error(`    `, err);
  }
}

const assert = {
  ok(cond: unknown, msg?: string): void {
    if (!cond) {
      throw new Error(msg || "Assertion failed: expected truthy value");
    }
  },
  strictEqual<T>(actual: T, expected: T, msg?: string): void {
    if (actual !== expected) {
      throw new Error(msg || `Assertion failed: expected ${String(expected)}, got ${String(actual)}`);
    }
  },
};

function makeNeutralInput(partial: Partial<InputState> = {}): InputState {
  return {
    sequence: 1,
    throttle: 0,
    steer: 0,
    brake: false,
    firePrimary: false,
    fireSpecial: false,
    abilityMobility: false,
    abilityUtility: false,
    ...partial,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe("Trackmania Vehicle Dynamics Engine", () => {
  describe("1. Forward Acceleration", () => {
    it("accelerating forward increases velocity along the car heading (angle = 0)", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({ x: 500, y: 500, angle: 0 });
      const input = makeNeutralInput({ throttle: 1.0 });

      // Run 10 ticks
      for (let i = 0; i < 10; i++) {
        stepVehicle(state, input, config, 1 / 60);
      }

      assert.ok(state.vx > 0, `Expected vx > 0, got ${state.vx}`);
      assert.strictEqual(Math.abs(state.vy) < 1e-4, true, `Expected vy approx 0, got ${state.vy}`);
      assert.ok(state.speed > 0, `Expected speed > 0, got ${state.speed}`);
      assert.strictEqual(state.isDrifting, false, "Vehicle should not be drifting during straight acceleration");
    });

    it("accelerating forward increases velocity along rotated car heading (angle = PI/2, facing down)", () => {
      const config = getCarConfig("rally");
      const state = createVehicleState({ x: 500, y: 500, angle: Math.PI / 2 });
      const input = makeNeutralInput({ throttle: 1.0 });

      for (let i = 0; i < 15; i++) {
        stepVehicle(state, input, config, 1 / 60);
      }

      // Facing +Y direction (PI/2)
      assert.strictEqual(Math.abs(state.vx) < 1e-3, true, `Expected vx approx 0, got ${state.vx}`);
      assert.ok(state.vy > 0, `Expected vy > 0 along +Y, got ${state.vy}`);
      assert.ok(state.speed > 0, `Expected speed > 0, got ${state.speed}`);
    });
  });

  describe("2. Drift State Transition", () => {
    it("braking while steering transitions to drift state (isDrifting === true)", () => {
      const config = getCarConfig("stadium");
      // Vehicle starts already moving fast forward (250 px/s > driftTriggerSpeed 100 px/s)
      const state = createVehicleState({
        x: 500,
        y: 500,
        vx: 250,
        vy: 0,
        angle: 0,
        speed: 250,
      });

      assert.strictEqual(state.isDrifting, false);

      // Apply brake while steering hard right
      const driftInput = makeNeutralInput({
        throttle: 0,
        brake: true,
        steer: 1.0,
      });

      stepVehicle(state, driftInput, config, 1 / 60);

      assert.strictEqual(state.isDrifting, true, "Vehicle should transition into drift state");
      assert.ok(state.skidIntensity > 0.3, "Skid intensity should increase during drift");
    });

    it("does not break into drift if speed is below threshold (speed < 100)", () => {
      const config = getCarConfig("desert");
      const state = createVehicleState({
        x: 500,
        y: 500,
        vx: 50, // 50 px/s is below drift trigger
        vy: 0,
        angle: 0,
        speed: 50,
      });

      const input = makeNeutralInput({
        brake: true,
        steer: 1.0,
      });

      stepVehicle(state, input, config, 1 / 60);
      assert.strictEqual(state.isDrifting, false, "Vehicle should not drift below threshold speed");
    });

    it("throttle recovery smoothly ends drift without spinning out", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({
        x: 500,
        y: 500,
        vx: 200,
        vy: 40,
        angle: 0.1,
        speed: 204,
        isDrifting: true,
      });

      // Apply forward throttle to power out of the drift
      const recoveryInput = makeNeutralInput({
        throttle: 1.0,
        steer: -0.2, // slight counter-steer
        brake: false,
      });

      // Advance physics steps
      for (let i = 0; i < 30; i++) {
        stepVehicle(state, recoveryInput, config, 1 / 60);
      }

      // Drift should exit smoothly and angular velocity should remain controlled
      assert.strictEqual(state.isDrifting, false, "Throttle recovery should exit drift state");
      assert.ok(Math.abs(state.driftAngle) < 0.2, "Velocity should align back with heading");
      assert.ok(Math.abs(state.angularVelocity) < config.turnRate * 1.5, "No uncontrollable spinning");
    });
  });

  describe("3. Wall Bounce Resolution", () => {
    it("wall bounce reflects normal velocity while preserving tangential velocity", () => {
      // Wall with normal pointing left (-1, 0), e.g. right arena boundary
      const normal = { x: -1, y: 0 };
      const velocity = { vx: 200, vy: 150 };
      const restitution = 0.7;
      const tangentialRetention = 1.0;

      const result = resolveWallBounce(velocity, normal, restitution, tangentialRetention);

      assert.strictEqual(result.bounced, true);
      // Normal velocity was vx = 200, should be reflected to -140
      assert.strictEqual(Math.round(result.vx), -140, `Expected vx = -140, got ${result.vx}`);
      // Tangential velocity vy = 150 should be preserved exactly at 150
      assert.strictEqual(Math.round(result.vy), 150, `Expected vy = 150, got ${result.vy}`);
    });

    it("preserves tangential sliding off bottom horizontal wall (normal = 0, -1)", () => {
      const normal = { x: 0, y: -1 };
      const velocity = { vx: 300, vy: 200 };
      const restitution = 0.6;
      const tangentialRetention = 0.98;

      const result = resolveWallBounce(velocity, normal, restitution, tangentialRetention);

      assert.strictEqual(result.bounced, true);
      // Tangential along X: 300 * 0.98 = 294
      assert.strictEqual(Math.round(result.vx), 294);
      // Normal along Y: 200 * -0.6 = -120
      assert.strictEqual(Math.round(result.vy), -120);
    });

    it("arena bounds clamping prevents exiting boundary and reflects velocity", () => {
      const config = getCarConfig("stadium");
      const arena = { x: 0, y: 0, width: 1000, height: 1000 };
      // Place vehicle right at the right edge moving outward
      const state = createVehicleState({
        x: 995,
        y: 500,
        vx: 300,
        vy: 100,
      });

      const bounced = resolveArenaBounds(state, config.hitboxRadius, arena, 0.65, 1.0);

      assert.strictEqual(bounced, true);
      assert.strictEqual(state.x <= 1000 - config.hitboxRadius, true, "Vehicle position must be clamped within arena");
      assert.ok(state.vx < 0, `Expected reflected vx < 0, got ${state.vx}`);
      assert.strictEqual(Math.round(state.vy), 100, `Expected tangential vy = 100, got ${state.vy}`);
    });

    it("resolves barrier collision and deflections", () => {
      const config = getCarConfig("stadium");
      const barriers = [
        { id: "barrier1", x: 200, y: 200, width: 100, height: 100, elasticity: 0.5 },
      ];

      // Vehicle approaching barrier from left at x = 190
      const state = createVehicleState({
        x: 195,
        y: 250,
        vx: 200,
        vy: 80,
      });

      const bounced = resolveBarrierCollisions(state, config.hitboxRadius, barriers);

      assert.strictEqual(bounced, true);
      assert.ok(state.x < 200, "Vehicle should be pushed outside the barrier");
      assert.ok(state.vx < 0, "Normal velocity should be reflected away from barrier");
    });
  });

  describe("4. Archetype Tuning & Verification", () => {
    it("verifies Stadium Spec parameters", () => {
      const s = CAR_CONFIGS.stadium;
      assert.strictEqual(s.gripRatio, 0.96);
      assert.strictEqual(s.driftFrictionRatio, 0.82);
      assert.strictEqual(s.turnRate, 3.6);
      assert.strictEqual(s.maxSpeed, 520);
      assert.strictEqual(s.mass, 1.0);
      assert.strictEqual(s.maxHealth, 100);
    });

    it("verifies Desert Spec parameters", () => {
      const d = CAR_CONFIGS.desert;
      assert.strictEqual(d.gripRatio, 0.88);
      assert.strictEqual(d.driftFrictionRatio, 0.70);
      assert.strictEqual(d.turnRate, 2.4);
      assert.strictEqual(d.maxSpeed, 620);
      assert.strictEqual(d.mass, 1.6);
      assert.strictEqual(d.maxHealth, 150);
    });

    it("verifies Rally Spec parameters", () => {
      const r = CAR_CONFIGS.rally;
      assert.strictEqual(r.gripRatio, 0.80);
      assert.strictEqual(r.driftFrictionRatio, 0.55);
      assert.strictEqual(r.turnRate, 4.2);
      assert.strictEqual(r.maxSpeed, 490);
      assert.strictEqual(r.mass, 0.75);
      assert.strictEqual(r.maxHealth, 85);
    });

    it("Vehicle class wraps state and handles impulses", () => {
      const car = new Vehicle("desert", { x: 100, y: 200 });
      assert.strictEqual(car.state.x, 100);
      assert.strictEqual(car.config.name, "Desert Spec");

      // Apply impulse (e.g. projectile blast or chassis recoil)
      car.applyImpulse(160, 0);
      // desert mass is 1.6, so dv = 160 / 1.6 = 100
      assert.strictEqual(Math.round(car.state.vx), 100);
    });
  });

  describe("5. Input Controller Dual-Hand Layout", () => {
    it("handles Vim keys (k, j, h, l) and increments sequence counter", () => {
      const controller = new InputController("vim-arrows", { enableSmoothing: false });

      controller.simulateKeyDown("KeyK");
      controller.simulateKeyDown("KeyH");
      controller.simulateKeyDown("KeyA");

      const input = controller.sample(1 / 60);

      assert.strictEqual(input.sequence, 1);
      assert.strictEqual(input.throttle, 1.0);
      assert.strictEqual(input.steer, -1.0);
      assert.strictEqual(input.firePrimary, true);
      assert.strictEqual(input.fireSpecial, false);

      controller.simulateKeyUp("KeyK");
      const input2 = controller.sample(1 / 60);
      assert.strictEqual(input2.sequence, 2);
      assert.strictEqual(input2.throttle, 0);

      controller.destroy();
    });

    it("handles Arrow keys simultaneously with Vim keys", () => {
      const controller = new InputController("vim-arrows", { enableSmoothing: false });

      controller.simulateKeyDown("ArrowUp");
      controller.simulateKeyDown("ArrowRight");
      controller.simulateKeyDown("KeyS");

      const input = controller.sample(1 / 60);
      assert.strictEqual(input.throttle, 1.0);
      assert.strictEqual(input.steer, 1.0);
      assert.strictEqual(input.fireSpecial, true);

      controller.destroy();
    });

    it("supports WASD mode", () => {
      const controller = new InputController("wasd", { enableSmoothing: false });

      controller.simulateKeyDown("KeyW");
      controller.simulateKeyDown("KeyD");
      controller.simulateKeyDown("KeyJ"); // Combat primary in WASD mode

      const input = controller.sample(1 / 60);
      assert.strictEqual(input.throttle, 1.0);
      assert.strictEqual(input.steer, 1.0);
      assert.strictEqual(input.firePrimary, true);

      controller.destroy();
    });
  });
});

// Run report
const envProcess = (globalThis as Record<string, unknown>)["process"] as
  | { exit?: (code: number) => void }
  | undefined;

if (failedTests > 0) {
  console.error(`\nTest suite FAILED: ${failedTests}/${totalTests} tests failed.`);
  envProcess?.exit?.(1);
} else {
  console.log(`\nTest suite PASSED: All ${passedTests}/${totalTests} tests succeeded.`);
}
