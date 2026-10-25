/**
 * Trackmania-style 2D vector physics model and vehicle dynamics simulation.
 *
 * Implements:
 * - Longitudinal vs lateral velocity decomposition: v = v_parallel * u_fwd + v_perp * u_right
 * - Grip vs Drift state transitions and slip angle calculations
 * - Snappy recovery on positive throttle and counter-steer without 360 spinouts
 * - Elastic wall bounce resolution with tangential momentum preservation
 * - Arena boundary clamping and obstacle barrier collisions
 */

import type { ArenaBounds, Barrier, CarConfig, CarType, InputState, VehicleState } from "../types.ts";
import { DEFAULT_ARENA_BOUNDS, getCarConfig, PHYSICS_CONSTANTS } from "./configs.ts";

// ============================================================================
// Math & Vector Utilities
// ============================================================================

/**
 * Normalizes an angle into the [-PI, PI] range.
 */
export function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Creates a default vehicle state.
 */
export function createVehicleState(initial: Partial<VehicleState> = {}): VehicleState {
  return {
    x: initial.x ?? 0,
    y: initial.y ?? 0,
    vx: initial.vx ?? 0,
    vy: initial.vy ?? 0,
    angle: initial.angle ?? 0,
    angularVelocity: initial.angularVelocity ?? 0,
    isDrifting: initial.isDrifting ?? false,
    driftAngle: initial.driftAngle ?? 0,
    speed: initial.speed ?? 0,
    skidIntensity: initial.skidIntensity ?? 0,
  };
}

// ============================================================================
// Wall Bounce & Collision Resolution
// ============================================================================

export interface BounceResult {
  vx: number;
  vy: number;
  bounced: boolean;
  normalVelocity: number;
  tangentialVelocity: number;
}

/**
 * Resolves an elastic bounce against a surface defined by its inward-pointing unit normal.
 *
 * Normal velocity component is reflected elastically: v_n' = -restitution * v_n.
 * Tangential velocity component is preserved: v_t' = tangentialRetention * v_t.
 * This ensures the vehicle deflects and slides along barriers rather than sticking to a halt.
 */
export function resolveWallBounce(
  velocity: { vx: number; vy: number },
  normal: { x: number; y: number },
  restitution: number = PHYSICS_CONSTANTS.wallElasticRestitution,
  tangentialRetention: number = PHYSICS_CONSTANTS.wallTangentialRetention
): BounceResult {
  const nLen = Math.hypot(normal.x, normal.y);
  if (nLen < 1e-8) {
    return {
      vx: velocity.vx,
      vy: velocity.vy,
      bounced: false,
      normalVelocity: 0,
      tangentialVelocity: 0,
    };
  }

  const nx = normal.x / nLen;
  const ny = normal.y / nLen;

  // v_n is the dot product of velocity and surface normal (pointing away from wall)
  // If moving into the wall, v_n < 0
  const vn = velocity.vx * nx + velocity.vy * ny;

  if (vn >= 0) {
    // Moving away from surface, no collision impulse
    return {
      vx: velocity.vx,
      vy: velocity.vy,
      bounced: false,
      normalVelocity: vn,
      tangentialVelocity: velocity.vx * -ny + velocity.vy * nx,
    };
  }

  // Tangential velocity component vector: v_t = v - (v · n) * n
  const vtx = velocity.vx - vn * nx;
  const vty = velocity.vy - vn * ny;
  const vtScalar = velocity.vx * -ny + velocity.vy * nx;

  // Elastic normal reflection & preserved tangential slide
  const newVnx = -restitution * vn * nx;
  const newVny = -restitution * vn * ny;

  const newVtx = tangentialRetention * vtx;
  const newVty = tangentialRetention * vty;

  return {
    vx: newVnx + newVtx,
    vy: newVny + newVty,
    bounced: true,
    normalVelocity: vn,
    tangentialVelocity: vtScalar,
  };
}

/**
 * Clamps vehicle inside arena boundaries and executes elastic deflections off arena walls.
 */
export function resolveArenaBounds(
  state: VehicleState,
  hitboxRadius: number,
  arena: ArenaBounds = DEFAULT_ARENA_BOUNDS,
  restitution: number = PHYSICS_CONSTANTS.wallElasticRestitution,
  tangentialRetention: number = PHYSICS_CONSTANTS.wallTangentialRetention
): boolean {
  let anyBounced = false;

  const minX = arena.x + hitboxRadius;
  const maxX = arena.x + arena.width - hitboxRadius;
  const minY = arena.y + hitboxRadius;
  const maxY = arena.y + arena.height - hitboxRadius;

  // Left wall (normal points right: +1, 0)
  if (state.x < minX) {
    state.x = minX;
    const bounce = resolveWallBounce({ vx: state.vx, vy: state.vy }, { x: 1, y: 0 }, restitution, tangentialRetention);
    if (bounce.bounced) {
      state.vx = bounce.vx;
      state.vy = bounce.vy;
      anyBounced = true;
    }
  }

  // Right wall (normal points left: -1, 0)
  if (state.x > maxX) {
    state.x = maxX;
    const bounce = resolveWallBounce({ vx: state.vx, vy: state.vy }, { x: -1, y: 0 }, restitution, tangentialRetention);
    if (bounce.bounced) {
      state.vx = bounce.vx;
      state.vy = bounce.vy;
      anyBounced = true;
    }
  }

  // Top wall (normal points down: 0, +1)
  if (state.y < minY) {
    state.y = minY;
    const bounce = resolveWallBounce({ vx: state.vx, vy: state.vy }, { x: 0, y: 1 }, restitution, tangentialRetention);
    if (bounce.bounced) {
      state.vx = bounce.vx;
      state.vy = bounce.vy;
      anyBounced = true;
    }
  }

  // Bottom wall (normal points up: 0, -1)
  if (state.y > maxY) {
    state.y = maxY;
    const bounce = resolveWallBounce({ vx: state.vx, vy: state.vy }, { x: 0, y: -1 }, restitution, tangentialRetention);
    if (bounce.bounced) {
      state.vx = bounce.vx;
      state.vy = bounce.vy;
      anyBounced = true;
    }
  }

  return anyBounced;
}

/**
 * Resolves circle-AABB collisions with solid barrier obstacles.
 */
export function resolveBarrierCollisions(
  state: VehicleState,
  hitboxRadius: number,
  barriers: Barrier[],
  defaultRestitution: number = PHYSICS_CONSTANTS.wallElasticRestitution,
  tangentialRetention: number = PHYSICS_CONSTANTS.wallTangentialRetention
): boolean {
  let anyBounced = false;

  for (const barrier of barriers) {
    // Find closest point on barrier AABB to vehicle center
    const closestX = Math.max(barrier.x, Math.min(state.x, barrier.x + barrier.width));
    const closestY = Math.max(barrier.y, Math.min(state.y, barrier.y + barrier.height));

    const dx = state.x - closestX;
    const dy = state.y - closestY;
    const distSq = dx * dx + dy * dy;

    if (distSq < hitboxRadius * hitboxRadius) {
      const dist = Math.sqrt(distSq);
      let nx = 0;
      let ny = 0;
      let penetration = 0;

      if (dist > 1e-6) {
        nx = dx / dist;
        ny = dy / dist;
        penetration = hitboxRadius - dist;
      } else {
        // Vehicle center is inside the barrier: find shallowest axis to push out
        const distLeft = Math.abs(state.x - barrier.x);
        const distRight = Math.abs(barrier.x + barrier.width - state.x);
        const distTop = Math.abs(state.y - barrier.y);
        const distBottom = Math.abs(barrier.y + barrier.height - state.y);

        const minDist = Math.min(distLeft, distRight, distTop, distBottom);
        if (minDist === distLeft) {
          nx = -1;
          penetration = distLeft + hitboxRadius;
        } else if (minDist === distRight) {
          nx = 1;
          penetration = distRight + hitboxRadius;
        } else if (minDist === distTop) {
          ny = -1;
          penetration = distTop + hitboxRadius;
        } else {
          ny = 1;
          penetration = distBottom + hitboxRadius;
        }
      }

      // Position correction out of barrier
      state.x += nx * penetration;
      state.y += ny * penetration;

      // Elastic bounce
      const restitution = barrier.elasticity ?? defaultRestitution;
      const bounce = resolveWallBounce(
        { vx: state.vx, vy: state.vy },
        { x: nx, y: ny },
        restitution,
        tangentialRetention
      );

      if (bounce.bounced) {
        state.vx = bounce.vx;
        state.vy = bounce.vy;
        anyBounced = true;
      }
    }
  }

  return anyBounced;
}

// ============================================================================
// Vehicle Simulation Engine
// ============================================================================

/**
 * Performs a single physics tick for a vehicle based on player input.
 */
export function stepVehicle(
  state: VehicleState,
  input: InputState,
  config: CarConfig,
  dt: number = PHYSICS_CONSTANTS.fixedDt,
  arena?: ArenaBounds,
  barriers?: Barrier[]
): VehicleState {
  // 1. Compute current heading unit vectors
  // u_fwd is along chassis orientation (theta)
  // u_right is perpendicular (theta + PI/2)
  const cosAngle = Math.cos(state.angle);
  const sinAngle = Math.sin(state.angle);

  const uFwdX = cosAngle;
  const uFwdY = sinAngle;
  const uRightX = -sinAngle;
  const uRightY = cosAngle;

  // 2. Decompose linear velocity into longitudinal and lateral components
  // v_parallel = v · u_fwd
  // v_perp     = v · u_right
  let vParallel = state.vx * uFwdX + state.vy * uFwdY;
  let vPerp = state.vx * uRightX + state.vy * uRightY;

  const currentSpeed = Math.hypot(state.vx, state.vy);

  // 3. Steering and angular velocity
  // Steering responsiveness scales with speed (cannot pivot in place when stationary)
  let speedSteerFactor = 1.0;
  const absVParallel = Math.abs(vParallel);
  if (absVParallel < PHYSICS_CONSTANTS.minSteerSpeed) {
    speedSteerFactor = absVParallel / PHYSICS_CONSTANTS.minSteerSpeed;
  }

  // Reverse steering behaves realistically when driving backward
  const steerDirection = vParallel < -5 ? -1 : 1;
  let angularVel = input.steer * config.turnRate * speedSteerFactor * steerDirection;

  // 4. Drift Initiation & Maintenance
  // Condition: When braking while steering at speed > 100 px/s, grip breaks and isDrifting = true
  const isBrakingWithSteer = input.brake && Math.abs(input.steer) > 0.05;
  if (isBrakingWithSteer && currentSpeed > PHYSICS_CONSTANTS.driftTriggerSpeed) {
    state.isDrifting = true;
  }

  // 5. Lateral Grip vs Drift Slip Dynamics
  if (!state.isDrifting) {
    // NORMAL GRIP: Lateral velocity is heavily damped by gripRatio
    // Damping eliminates lateral sliding quickly so car travels where wheels point
    const gripDamping = Math.exp(-PHYSICS_CONSTANTS.normalLateralDamping * config.gripRatio * dt);
    vPerp *= gripDamping;

    // Small lateral threshold snaps to zero to eliminate micro-jitter
    if (Math.abs(vPerp) < 0.1) {
      vPerp = 0;
    }
  } else {
    // DRIFT MODE: Grip has broken, lateral friction is reduced
    // Lower driftFrictionRatio retains more slide (Desert and Rally slide wider)
    const driftDampingFactor = PHYSICS_CONSTANTS.driftLateralDamping * config.driftFrictionRatio;
    const driftRetention = Math.exp(-driftDampingFactor * dt);
    vPerp *= driftRetention;

    // FORGIVING COUNTER-STEER & THROTTLE RECOVERY:
    // Applying positive throttle pulls velocity back toward u_fwd
    if (input.throttle > 0.01) {
      let recoveryRate = PHYSICS_CONSTANTS.throttleRecoveryRate * input.throttle;

      // Stadium Spec archetype features snappy air-brake drift snap recovery
      if (config.name.includes("Stadium")) {
        recoveryRate *= PHYSICS_CONSTANTS.stadiumSnapMultiplier;
      }

      // Counter-steering (steering opposite to lateral slip) aids recovery alignment
      const counterSteering = (vPerp > 0 && input.steer < -0.1) || (vPerp < 0 && input.steer > 0.1);
      if (counterSteering) {
        recoveryRate += PHYSICS_CONSTANTS.counterSteerRecoveryRate * Math.abs(input.steer);
        // Correct chassis angle smoothly toward motion direction
        const velAngle = Math.atan2(state.vy, state.vx);
        const angleDiff = normalizeAngle(velAngle - state.angle);
        angularVel += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff) * 3.0, config.turnRate * 0.7);
      }

      // Damp lateral velocity under throttle recovery
      vPerp *= Math.exp(-recoveryRate * dt);
    }

    // Drift Exit Conditions:
    // a. Speed drops below exit threshold
    if (currentSpeed < PHYSICS_CONSTANTS.driftExitSpeed) {
      state.isDrifting = false;
    }
    // b. Player released brake, throttled, and slip angle has straightened out
    else if (!input.brake && input.throttle > 0.1) {
      const velHeading = Math.atan2(state.vy, state.vx);
      const slipAngle = Math.abs(normalizeAngle(velHeading - state.angle));
      if (slipAngle < PHYSICS_CONSTANTS.driftExitAngleThreshold || Math.abs(vPerp) < 30) {
        state.isDrifting = false;
      }
    }
    // c. Car is coasting straight and lateral velocity dissipated
    else if (!input.brake && Math.abs(input.steer) < 0.1 && Math.abs(vPerp) < 15) {
      state.isDrifting = false;
    }
  }

  // 6. Longitudinal Dynamics (Throttle, Brake, Coast, Reverse)
  if (input.throttle > 0 && !input.brake) {
    // Forward acceleration
    const forwardAccel = config.acceleration * Math.min(1.0, Math.max(0, input.throttle));
    if (vParallel < config.maxSpeed) {
      vParallel += forwardAccel * dt;
      if (vParallel > config.maxSpeed) {
        vParallel = config.maxSpeed;
      }
    } else {
      // Natural aerodynamic drag beyond top speed
      vParallel -= (vParallel - config.maxSpeed) * 4.0 * dt;
    }
  } else if (input.brake) {
    if (vParallel > 15) {
      // High-speed braking deceleration
      vParallel = Math.max(0, vParallel - PHYSICS_CONSTANTS.brakeDeceleration * dt);
    } else {
      // Reversing
      const reverseLimit = -config.reverseSpeed;
      if (vParallel > reverseLimit) {
        vParallel = Math.max(reverseLimit, vParallel - PHYSICS_CONSTANTS.reverseAcceleration * dt);
      }
    }
  } else {
    // Coasting drag (no throttle, no brake)
    if (vParallel > 0) {
      vParallel = Math.max(0, vParallel - PHYSICS_CONSTANTS.coastDeceleration * dt);
    } else if (vParallel < 0) {
      vParallel = Math.min(0, vParallel + PHYSICS_CONSTANTS.coastDeceleration * dt);
    }
  }

  // 7. Recompose linear velocity vector
  state.vx = vParallel * uFwdX + vPerp * uRightX;
  state.vy = vParallel * uFwdY + vPerp * uRightY;
  state.speed = Math.hypot(state.vx, state.vy);

  // 8. Update chassis orientation angle
  state.angularVelocity = angularVel;
  state.angle = normalizeAngle(state.angle + state.angularVelocity * dt);

  // 9. Calculate drift slip angle and skid intensity
  if (state.speed > 5.0) {
    const motionAngle = Math.atan2(state.vy, state.vx);
    state.driftAngle = normalizeAngle(motionAngle - state.angle);
  } else {
    state.driftAngle = 0;
  }

  if (state.isDrifting) {
    const slipFactor = Math.abs(vPerp) / 100.0;
    const angleFactor = Math.abs(state.driftAngle) / (Math.PI / 2);
    state.skidIntensity = Math.min(1.0, Math.max(0.35, slipFactor * 0.7 + angleFactor * 0.3));
  } else if (input.brake && currentSpeed > 80) {
    state.skidIntensity = Math.min(0.85, (currentSpeed - 80) / 200);
  } else {
    state.skidIntensity = Math.min(0.4, Math.abs(vPerp) / 250);
  }

  // 10. Update position
  state.x += state.vx * dt;
  state.y += state.vy * dt;

  // 11. Environment collisions: arena boundary reflection and barrier resolution
  let bounced = false;
  if (arena) {
    bounced = resolveArenaBounds(state, config.hitboxRadius, arena) || bounced;
  }
  if (barriers && barriers.length > 0) {
    bounced = resolveBarrierCollisions(state, config.hitboxRadius, barriers) || bounced;
  }

  // On glancing wall bounce, subtly deflect chassis heading with new velocity vector
  if (bounced && state.speed > 60) {
    const bounceAngle = Math.atan2(state.vy, state.vx);
    const deflection = normalizeAngle(bounceAngle - state.angle);
    state.angle = normalizeAngle(state.angle + deflection * 0.25);
  }

  return state;
}

// ============================================================================
// OOP Vehicle Wrapper
// ============================================================================

export class Vehicle {
  public state: VehicleState;
  public config: CarConfig;
  public carType: CarType;

  constructor(carTypeOrConfig: CarType | CarConfig = "stadium", initialState: Partial<VehicleState> = {}) {
    if (typeof carTypeOrConfig === "string") {
      this.carType = carTypeOrConfig;
      this.config = getCarConfig(carTypeOrConfig);
    } else {
      this.carType = "stadium";
      this.config = carTypeOrConfig;
    }
    this.state = createVehicleState(initialState);
  }

  /**
   * Advances the vehicle by one physics tick.
   */
  public update(
    input: InputState,
    dt: number = PHYSICS_CONSTANTS.fixedDt,
    arena?: ArenaBounds,
    barriers?: Barrier[]
  ): VehicleState {
    return stepVehicle(this.state, input, this.config, dt, arena, barriers);
  }

  /**
   * Applies an external instantaneous impulse (e.g. blast recoil, projectile hit, ram).
   */
  public applyImpulse(impulseX: number, impulseY: number): void {
    const massFactor = 1.0 / Math.max(0.1, this.config.mass);
    this.state.vx += impulseX * massFactor;
    this.state.vy += impulseY * massFactor;
    this.state.speed = Math.hypot(this.state.vx, this.state.vy);
  }

  /**
   * Teleports or repositions vehicle (e.g. initial spawn or server reconciliation).
   */
  public teleport(x: number, y: number, angle?: number): void {
    this.state.x = x;
    this.state.y = y;
    if (angle !== undefined) {
      this.state.angle = normalizeAngle(angle);
    }
  }

  /**
   * Returns a copy of the current state.
   */
  public getState(): Readonly<VehicleState> {
    return { ...this.state };
  }

  /**
   * Changes the vehicle's archetype configuration.
   */
  public setArchetype(carType: CarType): void {
    this.carType = carType;
    this.config = getCarConfig(carType);
  }
}
