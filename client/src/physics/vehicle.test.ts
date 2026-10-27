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
  resolveRampPhysics,
  stepRampPhysics,
  Vehicle,
} from "./vehicle.ts";
import { CAR_CONFIGS, getCarConfig, PHYSICS_CONSTANTS } from "./configs.ts";
import { InputController } from "./input.ts";
import type { InputState, JumpRamp } from "../types.ts";

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
      assert.strictEqual(s.turnRate, 3.2);
      assert.strictEqual(s.maxSpeed, 520);
      assert.strictEqual(s.mass, 1.0);
      assert.strictEqual(s.maxHealth, 100);
    });

    it("verifies Desert Spec parameters", () => {
      const d = CAR_CONFIGS.desert;
      assert.strictEqual(d.gripRatio, 0.88);
      assert.strictEqual(d.driftFrictionRatio, 0.70);
      assert.strictEqual(d.turnRate, 2.2);
      assert.strictEqual(d.maxSpeed, 620);
      assert.strictEqual(d.mass, 1.6);
      assert.strictEqual(d.maxHealth, 150);
    });

    it("verifies Rally Spec parameters", () => {
      const r = CAR_CONFIGS.rally;
      assert.strictEqual(r.gripRatio, 0.80);
      assert.strictEqual(r.driftFrictionRatio, 0.55);
      assert.strictEqual(r.turnRate, 3.6);
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

  describe("6. Momentum-Based Steering & Rotational Inertia", () => {
    it("turning accelerates angular velocity smoothly rather than instantaneous snap", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({ x: 500, y: 500, vx: 200, vy: 0, angle: 0, angularVelocity: 0, speed: 200 });
      const steerInput = makeNeutralInput({ steer: 1.0 });

      // Step exactly 1 tick
      stepVehicle(state, steerInput, config, 1 / 60);

      // Must have started accelerating, but NOT instantly snapped to config.turnRate (3.2)
      assert.ok(state.angularVelocity > 0, `Angular velocity should be positive, got ${state.angularVelocity}`);
      assert.ok(
        state.angularVelocity < config.turnRate * 0.5,
        `Angular velocity should not immediately snap to max turnRate (${config.turnRate}), got ${state.angularVelocity}`
      );
    });

    it("angular velocity accelerates monotonically towards target under sustained steer", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({ x: 500, y: 500, vx: 200, vy: 0, angle: 0, angularVelocity: 0, speed: 200 });
      const steerInput = makeNeutralInput({ steer: 1.0 });

      let lastAngVel = 0;
      for (let i = 0; i < 20; i++) {
        stepVehicle(state, steerInput, config, 1 / 60);
        assert.ok(
          state.angularVelocity >= lastAngVel,
          `Angular velocity should accelerate monotonically: step ${i} (${state.angularVelocity}) vs prev (${lastAngVel})`
        );
        lastAngVel = state.angularVelocity;
      }

      // Reached near target turn rate after ~1/3 second
      assert.ok(state.angularVelocity > config.turnRate * 0.85, "Should approach steady turn rate");
    });

    it("releasing steering preserves rotational momentum and decays smoothly", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({ x: 500, y: 500, vx: 200, vy: 0, angle: 0, angularVelocity: 0, speed: 200 });
      const steerInput = makeNeutralInput({ steer: 1.0 });

      for (let i = 0; i < 30; i++) {
        stepVehicle(state, steerInput, config, 1 / 60);
      }

      const peakAngVel = state.angularVelocity;
      assert.ok(peakAngVel > 2.5, "Should have achieved high turning rate");

      // Release steering (steer = 0)
      const neutralInput = makeNeutralInput({ steer: 0 });
      stepVehicle(state, neutralInput, config, 1 / 60);

      // Must not drop instantly to 0 due to rotational inertia
      assert.ok(state.angularVelocity > 1.5, `Angular velocity should retain momentum: got ${state.angularVelocity}`);
      assert.ok(state.angularVelocity < peakAngVel, "Angular velocity should begin smooth deceleration");
    });

    it("high-speed steer taper clamps maximum turning rate at 500+ px/s", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({ x: 500, y: 500, vx: 520, vy: 0, angle: 0, angularVelocity: 0, speed: 520 });
      const steerInput = makeNeutralInput({ throttle: 1.0, steer: 1.0 });

      for (let i = 0; i < 40; i++) {
        stepVehicle(state, steerInput, config, 1 / 60);
      }

      // Peak turn rate should be tapered (clamped below untapered turnRate of 3.2)
      assert.ok(
        state.angularVelocity <= config.turnRate * 0.75,
        `High-speed turn rate must be tapered, got ${state.angularVelocity} (turnRate: ${config.turnRate})`
      );
    });
  });

  describe("7. Trackmania Jump Ramp & Airborne Physics", () => {
    const testRamp: JumpRamp = {
      id: "ramp-test",
      x: 500,
      y: 500,
      angle: 0,
      width: 80,
      length: 100,
      height: 20,
      launchBoost: 60,
    };

    it("driving onto ramp elevates vehicle z and sets pitch angle without launching", () => {
      const state = createVehicleState({
        x: 480, // localX = -20 (ramp goes from -50 to +50)
        y: 500,
        vx: 200,
        vy: 0,
        angle: 0,
        speed: 200,
      });

      stepRampPhysics(state, [testRamp], 1 / 60);

      assert.ok((state.z ?? 0) > 0, `Car z should be elevated on slope, got ${state.z}`);
      assert.ok((state.z ?? 0) < 20, `Car z should be below lip height, got ${state.z}`);
      assert.ok((state.pitch ?? 0) > 0, `Car pitch should be positive, got ${state.pitch}`);
      assert.strictEqual(state.isAirborne, false, "Vehicle should not be airborne on slope");
    });

    it("reaching launch lip at speed launches car airborne with launch boost", () => {
      const state = createVehicleState({
        x: 540, // localX = +40 (lip trigger is >= 50 - 15 = 35)
        y: 500,
        vx: 200,
        vy: 0,
        angle: 0,
        speed: 200,
      });

      stepRampPhysics(state, [testRamp], 1 / 60);

      assert.strictEqual(state.isAirborne, true, "Vehicle must become airborne at launch lip");
      // Launch boost was 60, speed was 200 -> initial vz ~ 200 * 0.45 + 60 = 150
      assert.ok((state.vz ?? 0) > 100, `Launch vertical velocity should be high, got ${state.vz}`);
    });

    it("gravity pulls airborne vehicle back to ground and lands cleanly", () => {
      const state = createVehicleState({
        x: 600,
        y: 500,
        z: 15,
        vz: 120,
        isAirborne: true,
        pitch: 0.2,
      });

      // Step physics until landing
      let totalDt = 0;
      for (let i = 0; i < 60; i++) {
        stepRampPhysics(state, [testRamp], 1 / 60);
        totalDt += 1 / 60;
        if (!state.isAirborne) break;
      }

      assert.strictEqual(state.isAirborne, false, "Vehicle should have landed");
      assert.strictEqual(state.z, 0, "Elevation must be 0 after landing");
      assert.strictEqual(state.vz, 0, "Vertical velocity must be 0 after landing");
      assert.strictEqual(state.pitch, 0, "Pitch must reset to 0 after landing");
    });

    it("driving in reverse against high drop lip from outside acts as a solid barrier", () => {
      const state = createVehicleState({
        x: 560, // outside ramp past lip at 550
        y: 500,
        vx: -150, // driving backward into the vertical back wall
        vy: 0,
        angle: Math.PI,
        speed: 150,
      });

      stepRampPhysics(state, [testRamp], 1 / 60);

      assert.ok(state.vx > 0, `Vehicle velocity should be deflected away from high lip, got ${state.vx}`);
      assert.ok(state.x >= 565, `Vehicle should be pushed out away from lip, got ${state.x}`);
    });

    it("stepVehicle integrates ramp physics and airborne dynamics", () => {
      const config = getCarConfig("stadium");
      const state = createVehicleState({
        x: 540,
        y: 500,
        vx: 250,
        vy: 0,
        angle: 0,
        speed: 250,
      });
      const input = makeNeutralInput({ throttle: 1.0 });

      // Step vehicle over test ramp
      stepVehicle(state, input, config, 1 / 60, undefined, undefined, [testRamp]);

      assert.strictEqual(state.isAirborne, true, "Vehicle should become airborne through stepVehicle");
      assert.ok((state.z ?? 0) > 0, "Elevation should be positive");
      assert.strictEqual(state.skidIntensity, 0, "Skid intensity must be 0 while airborne");
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
