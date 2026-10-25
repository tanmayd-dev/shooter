/**
 * Car archetype configurations and physics tuning constants.
 * Inspired by Trackmania driving dynamics: Stadium, Desert, and Rally specs.
 */

import type { ArenaBounds, CarConfig, CarType } from "../types.ts";

export const CAR_CONFIGS: Record<CarType, CarConfig> = {
  stadium: {
    name: "Stadium Spec",
    specName: "Stadium",
    description: "Precision drifter engineered with high grip, razor-sharp turning, and snappy air-brake drift snap recovery.",
    color: "#00f0ff", // Neon Cyan
    maxSpeed: 520,
    topSpeed: 520,
    acceleration: 560,
    reverseSpeed: 190,
    turnRate: 3.6,
    gripRatio: 0.96,
    driftFrictionRatio: 0.82,
    mass: 1.0,
    maxHealth: 100,
    hitboxRadius: 18,
    primaryCooldown: 0.12,   // Rapid pulse blasters
    specialCooldown: 4.0,    // Micro-missile salvo
    mobilityCooldown: 6.0,   // Air-brake drift snap
    utilityCooldown: 12.0,   // Kinetic deflector shield
    primaryWeaponName: "Pulse Blaster",
    specialAbilityName: "Micro-Missile Salvo",
    mobilityAbilityName: "Air-Brake Drift Snap",
    tacticalGadgetName: "Deflector Shield",
    stats: {
      topSpeed: 70,
      grip: 96,
      driftSlip: 45,
      armor: 65,
      turnRate: 85,
    },
    strengths: [
      "Exceptional road grip and instant cornering response",
      "Snappy drift recovery via air-brake snap",
      "High fire-rate pulse blasters for sustained pressure",
    ],
    weaknesses: [
      "Moderate top straight-line speed",
      "Susceptible to displacement by heavier chassis",
    ],
  },

  desert: {
    name: "Desert Spec",
    specName: "Desert",
    description: "Heavy brawler possessing massive momentum, blistering top speed, wide sweeping drifts, and reinforced armor.",
    color: "#ff8800", // Neon Amber / Orange
    maxSpeed: 620,
    topSpeed: 620,
    acceleration: 460,
    reverseSpeed: 150,
    turnRate: 2.4,
    gripRatio: 0.88,
    driftFrictionRatio: 0.70,
    mass: 1.6,
    maxHealth: 150,
    hitboxRadius: 22,
    primaryCooldown: 0.35,   // Heavy autocannon
    specialCooldown: 5.5,    // Ramming overdrive charge
    mobilityCooldown: 8.0,   // Twin-turbo burner
    utilityCooldown: 10.0,   // Caltrop mines
    primaryWeaponName: "Heavy Autocannon",
    specialAbilityName: "Ram Overdrive",
    mobilityAbilityName: "Twin-Turbo Burner",
    tacticalGadgetName: "Caltrop Mines",
    stats: {
      topSpeed: 95,
      grip: 75,
      driftSlip: 80,
      armor: 95,
      turnRate: 55,
    },
    strengths: [
      "Highest forward top speed in the arena",
      "Devastating kinetic ramming damage on impact",
      "Deep health pool capable of absorbing punishment",
    ],
    weaknesses: [
      "Lower turn rate requiring wider racing lines",
      "Heavy rotational inertia makes counter-steer slower",
    ],
  },

  rally: {
    name: "Rally Spec",
    specName: "Rally",
    description: "Agile skirmisher with ultra-light composite chassis, instantaneous drift engagement, and quick slide pivots.",
    color: "#39ff14", // Electric Green
    maxSpeed: 490,
    topSpeed: 490,
    acceleration: 640,
    reverseSpeed: 210,
    turnRate: 4.2,
    gripRatio: 0.80,
    driftFrictionRatio: 0.55,
    mass: 0.75,
    maxHealth: 85,
    hitboxRadius: 16,
    primaryCooldown: 0.70,   // Precision rail slug
    specialCooldown: 6.0,    // Overcharge beam
    mobilityCooldown: 4.5,   // 180° slide pivot
    utilityCooldown: 9.0,    // EMP smoke screen
    primaryWeaponName: "Rail Slug",
    specialAbilityName: "Overcharge Beam",
    mobilityAbilityName: "180° Slide Pivot",
    tacticalGadgetName: "EMP Smoke Screen",
    stats: {
      topSpeed: 65,
      grip: 60,
      driftSlip: 95,
      armor: 45,
      turnRate: 98,
    },
    strengths: [
      "Highest turn agility and instantaneous drift engagement",
      "Rapid burst acceleration off the line",
      "Extreme mobility allows quick disengagement",
    ],
    weaknesses: [
      "Fragile chassis with lowest maximum health",
      "Lightweight body easily deflected by barrier impacts",
      "Demands precise counter-steer control during high-speed drifts",
    ],
  },
};

export { CAR_CONFIGS as ARCHETYPE_CONFIGS };

export function getCarConfig(type: CarType): CarConfig {
  const config = CAR_CONFIGS[type];
  if (!config) {
    throw new Error(`Unknown car archetype: "${type}"`);
  }
  return config;
}

// ============================================================================
// Arena & Simulation Global Constants
// ============================================================================

export const PHYSICS_CONSTANTS = {
  /** Target simulation tick rate (60 Hz authoritative standard) */
  tickRate: 60,
  /** Fixed delta time for each simulation step */
  fixedDt: 1 / 60,
  /** Minimum forward/backward speed needed before steering turns the chassis */
  minSteerSpeed: 25,
  /** Speed threshold required to break tire grip into a drift when braking */
  driftTriggerSpeed: 100,
  /** Speed threshold below which drift state automatically cancels */
  driftExitSpeed: 65,
  /** Normal lateral grip damping rate multiplier */
  normalLateralDamping: 24.0,
  /** Drift lateral damping rate multiplier */
  driftLateralDamping: 3.2,
  /** Rate at which forward throttle aligns velocity vector during drift recovery */
  throttleRecoveryRate: 6.0,
  /** Extra snap recovery multiplier for Stadium archetype */
  stadiumSnapMultiplier: 1.8,
  /** Counter-steer angular alignment boost rate */
  counterSteerRecoveryRate: 4.5,
  /** Angular difference (radians) below which drift transitions back to grip */
  driftExitAngleThreshold: 0.12, // ~7 degrees
  /** Deceleration when braking at positive speed */
  brakeDeceleration: 800,
  /** Deceleration when rolling without throttle or brake */
  coastDeceleration: 140,
  /** Acceleration in reverse */
  reverseAcceleration: 320,
  /** Restitution factor for elastic wall deflections (velocity reflection) */
  wallElasticRestitution: 0.65,
  /** Tangential velocity retention along wall surfaces (sliding preservation) */
  wallTangentialRetention: 0.98,
} as const;

export const DEFAULT_ARENA_BOUNDS: ArenaBounds = {
  x: 0,
  y: 0,
  width: 2400,
  height: 1600,
};
