/**
 * Car archetype configurations and physics tuning constants.
 * Inspired by Trackmania driving dynamics: Stadium, Desert, and Rally specs.
 */

import type { ArenaBounds, CarConfig, CarType, JumpRamp } from "../types.ts";

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
    turnRate: 3.2,
    gripRatio: 0.96,
    driftFrictionRatio: 0.82,
    mass: 1.0,
    maxHealth: 100,
    hitboxRadius: 18,
    primaryCooldown: 0.12,   // Rapid pulse blasters
    specialCooldown: 4.0,    // Micro-missile salvo
    mobilityCooldown: 6.0,   // Air-brake drift snap
    utilityCooldown: 12.0,   // Kinetic deflector shield
    primaryWeaponName: "Pulse Blaster (Forward Rapid)",
    specialAbilityName: "Missile Salvo (Forward 4-Rocket)",
    mobilityAbilityName: "Air-Brake Drift Snap",
    tacticalGadgetName: "Deflector Shield (360° Bubble)",
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
    turnRate: 2.2,
    gripRatio: 0.88,
    driftFrictionRatio: 0.70,
    mass: 1.6,
    maxHealth: 150,
    hitboxRadius: 22,
    primaryCooldown: 0.35,   // Heavy autocannon
    specialCooldown: 5.5,    // Ramming overdrive charge
    mobilityCooldown: 8.0,   // Twin-turbo burner
    utilityCooldown: 10.0,   // Caltrop mines
    primaryWeaponName: "Heavy Autocannon (Forward)",
    specialAbilityName: "Ram Overdrive (Forward Charge)",
    mobilityAbilityName: "Twin-Turbo Burner (Nitro Boost)",
    tacticalGadgetName: "Caltrop Mines (Deploys Behind)",
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
    turnRate: 3.6,
    gripRatio: 0.80,
    driftFrictionRatio: 0.55,
    mass: 0.75,
    maxHealth: 85,
    hitboxRadius: 16,
    primaryCooldown: 0.70,   // Precision rail slug
    specialCooldown: 6.0,    // Overcharge beam
    mobilityCooldown: 4.5,   // 180° slide pivot
    utilityCooldown: 9.0,    // EMP smoke screen
    primaryWeaponName: "Rail Slug (Forward Kinetic Bolt)",
    specialAbilityName: "Overcharge Beam (Forward Piercing Laser)",
    mobilityAbilityName: "180° Slide Pivot (Reverse Turnaround)",
    tacticalGadgetName: "EMP Smoke Screen (Deploys Behind)",
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

  apex: {
    name: "Apex Spec",
    specName: "Apex",
    description: "Aero-GT aerial acrobat engineered for high-altitude ramp launches, flak bursts, and sonic repulsor shockwaves.",
    color: "#d000ff", // Neon Violet / Magenta
    maxSpeed: 580,
    topSpeed: 580,
    acceleration: 580,
    reverseSpeed: 180,
    turnRate: 3.4,
    gripRatio: 0.88,
    driftFrictionRatio: 0.60,
    mass: 0.85,
    maxHealth: 95,
    hitboxRadius: 18,
    primaryCooldown: 0.38,
    specialCooldown: 5.0,
    mobilityCooldown: 4.0,
    utilityCooldown: 8.0,
    primaryWeaponName: "Plasma Flak (Forward Shotgun Spread)",
    specialAbilityName: "Sonic Repulsor (360° Deflection Blast)",
    mobilityAbilityName: "Aero Thruster Jump (Vertical Launch)",
    tacticalGadgetName: "Holo Decoy (Ghost Drone)",
    stats: {
      topSpeed: 88,
      grip: 80,
      driftSlip: 70,
      armor: 55,
      turnRate: 88,
    },
    strengths: [
      "Devastating point-blank burst scatter damage",
      "Deflects incoming homing missiles and taser darts via sonic repulsor",
      "Superior ramp jump distance and vertical leap mobility",
    ],
    weaknesses: [
      "Low damage at long distances beyond flak cone spread",
      "Vulnerable to high-velocity linear snipers (Rally)",
    ],
  },

  titan: {
    name: "Titan Spec",
    specName: "Titan",
    description: "Heavily armored tactical police interceptor specialized in crowd lockdown, energy siphoning, and gravity tethers.",
    color: "#0066ff", // Tactical Cobalt Blue
    maxSpeed: 500,
    topSpeed: 500,
    acceleration: 520,
    reverseSpeed: 170,
    turnRate: 2.6,
    gripRatio: 0.90,
    driftFrictionRatio: 0.65,
    mass: 1.3,
    maxHealth: 125,
    hitboxRadius: 21,
    primaryCooldown: 0.28,
    specialCooldown: 6.0,
    mobilityCooldown: 5.0,
    utilityCooldown: 9.0,
    primaryWeaponName: "Taser Dart (Forward Speed Slow)",
    specialAbilityName: "Energy Siphon (Channeled HP Drain)",
    mobilityAbilityName: "Gravity Harpoon (Arrests Target Speed)",
    tacticalGadgetName: "Disruptor EMP (Radial Weapon Jammer)",
    stats: {
      topSpeed: 72,
      grip: 85,
      driftSlip: 60,
      armor: 85,
      turnRate: 65,
    },
    strengths: [
      "Energy siphon continuously drains enemy HP and repairs own chassis",
      "Harpoon tether halts agile speedsters in their tracks",
      "Disruptor EMP disables enemy shields and weapon systems",
    ],
    weaknesses: [
      "Moderate top speed; out-accelerated on long straightaways",
      "Vulnerable to airborne vertical jump strikes (Apex)",
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
  normalLateralDamping: 10.5,
  /** Angular acceleration response rate for smooth rotational momentum */
  steerResponseRate: 7.5,
  /** High speed steering clamp taper factor */
  highSpeedSteerTaper: 0.65,
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

export const DEFAULT_RAMPS: JumpRamp[] = [
  { id: "ramp-1", x: 1950, y: 380, angle: 0, width: 85, length: 110, height: 18, launchBoost: 80 },
  { id: "ramp-2", x: 1950, y: 2020, angle: Math.PI, width: 85, length: 110, height: 18, launchBoost: 80 },
];
