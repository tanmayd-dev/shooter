import type { StadiumTrack, Vector2D } from '../types.ts';

export interface MapMetadata {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  theme: 'neon' | 'canyon' | 'industrial';
  themeColor: string;
  tags: string[];
}

export const MAP_METADATA: MapMetadata[] = [
  {
    id: 'neon_stadium',
    name: 'Neon Stadium',
    subtitle: 'GRAND PRIX CIRCUIT',
    description: 'Championship arena featuring high-speed chamfered perimeter walls, dual boost straightaways, safety chicanes, and twin jump ramps.',
    theme: 'neon',
    themeColor: '#00f0ff',
    tags: ['Speed', 'Drift', 'Jumps'],
  },
  {
    id: 'cyber_canyon',
    name: 'Cyber Canyon',
    subtitle: 'DESERT OUTPOST',
    description: 'Rugged desert gorge with sweeping wide drift curves, rock monolith hazards, and dual crossover jump ramps across a central canyon chasm.',
    theme: 'canyon',
    themeColor: '#ff8800',
    tags: ['Wide Drifts', 'Chasm Jumps', 'Open Combat'],
  },
  {
    id: 'orbital_foundry',
    name: 'Orbital Foundry',
    subtitle: 'INDUSTRIAL COMPLEX',
    description: 'Dense multi-tier industrial facility with technical S-curves, conveyor speed lanes, steel support pillars, and 4-way cross-intersection jump ramps.',
    theme: 'industrial',
    themeColor: '#39ff14',
    tags: ['Technical', 'Close Quarters', 'Elevated Launches'],
  },
];

// ============================================================================
// Map 1: Neon Stadium (Original Sci-Fi Grand Prix)
// ============================================================================
function createNeonStadiumTrack(): StadiumTrack {
  const width = 3600;
  const height = 2400;

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

  const boostPads = [
    { id: 'b1', x: width / 2, y: 380, width: 200, height: 90, angle: 0, force: 480 },
    { id: 'b2', x: width / 2, y: height - 380, width: 200, height: 90, angle: Math.PI, force: 480 },
    { id: 'b3', x: 380, y: height / 2, width: 200, height: 90, angle: -Math.PI / 2, force: 480 },
    { id: 'b4', x: width - 380, y: height / 2, width: 200, height: 90, angle: Math.PI / 2, force: 480 },
  ];

  // Outer shoulder safety curbing (clearing the main driving runway at y: 380)
  const barriers = [
    { id: 'c1', x: 1350, y: 220, width: 25, height: 100, angle: 0, color: '#ffcc00' },
    { id: 'c2', x: 2350, y: 220, width: 25, height: 100, angle: 0, color: '#ffcc00' },
    { id: 'c3', x: 1350, y: height - 220, width: 25, height: 100, angle: 0, color: '#ffcc00' },
    { id: 'c4', x: 2350, y: height - 220, width: 25, height: 100, angle: 0, color: '#ffcc00' },
  ];

  const ramps = [
    { id: 'ramp_top', x: 1950, y: 380, angle: 0, width: 85, length: 110, height: 18, launchBoost: 100 },
    { id: 'ramp_bot', x: 1950, y: height - 380, angle: Math.PI, width: 85, length: 110, height: 18, launchBoost: 100 },
  ];

  const finishLine = {
    x1: width / 2 - 200,
    y1: 150,
    x2: width / 2 - 200,
    y2: 650,
    angle: Math.PI / 2,
  };

  return {
    id: 'neon_stadium',
    name: 'Neon Stadium',
    description: 'Championship Sci-Fi Grand Prix Arena',
    theme: 'neon',
    width,
    height,
    outerBorder,
    innerBorder,
    boostPads,
    barriers,
    ramps,
    finishLine,
  };
}

// ============================================================================
// Map 2: Cyber Canyon (Desert Outpost with Chasm Jumps)
// ============================================================================
function createCyberCanyonTrack(): StadiumTrack {
  const width = 3600;
  const height = 2400;

  const outerBorder: Vector2D[] = [
    { x: 300, y: 150 },
    { x: width - 300, y: 150 },
    { x: width - 150, y: 350 },
    { x: width - 150, y: height - 350 },
    { x: width - 300, y: height - 150 },
    { x: 300, y: height - 150 },
    { x: 150, y: height - 350 },
    { x: 150, y: 350 },
  ];

  // Dual mesa rock formations with central canyon pass
  const innerBorder: Vector2D[] = [
    { x: 750, y: 600 },
    { x: 1600, y: 600 },
    { x: 1600, y: 1800 },
    { x: 750, y: 1800 },
    { x: 600, y: 1650 },
    { x: 600, y: 750 },
  ];

  const barriers = [
    // East mesa barrier
    { id: 'mesa_east_top', x: 2450, y: 900, width: 600, height: 350, angle: 0, color: '#ff6600' },
    { id: 'mesa_east_bot', x: 2450, y: 1500, width: 600, height: 350, angle: 0, color: '#ff6600' },
    // Canyon rock pillars
    { id: 'rock_nw', x: 1100, y: 380, width: 70, height: 70, angle: 0, color: '#ffaa00' },
    { id: 'rock_ne', x: 2500, y: 380, width: 70, height: 70, angle: 0, color: '#ffaa00' },
    { id: 'rock_sw', x: 1100, y: height - 380, width: 70, height: 70, angle: 0, color: '#ffaa00' },
    { id: 'rock_se', x: 2500, y: height - 380, width: 70, height: 70, angle: 0, color: '#ffaa00' },
  ];

  const boostPads = [
    { id: 'cc_b1', x: width / 2, y: 350, width: 100, height: 200, angle: 0, force: 500 },
    { id: 'cc_b2', x: width / 2, y: height - 350, width: 100, height: 200, angle: Math.PI, force: 500 },
    { id: 'cc_b3', x: 1250, y: 1200, width: 120, height: 180, angle: 0, force: 600 },
    { id: 'cc_b4', x: 380, y: height / 2, width: 90, height: 180, angle: -Math.PI / 2, force: 450 },
  ];

  // Elevated canyon launch ramps
  const ramps = [
    // Central chasm launch ramps
    { id: 'canyon_jump_east', x: 1520, y: 1200, angle: 0, width: 95, length: 120, height: 22, launchBoost: 150 },
    { id: 'canyon_jump_west', x: 2080, y: 1200, angle: Math.PI, width: 95, length: 120, height: 22, launchBoost: 150 },
    // High-speed outer bypass ramps
    { id: 'canyon_ramp_top', x: 2000, y: 350, angle: 0, width: 85, length: 110, height: 18, launchBoost: 110 },
    { id: 'canyon_ramp_bot', x: 1600, y: height - 350, angle: Math.PI, width: 85, length: 110, height: 18, launchBoost: 110 },
  ];

  const finishLine = {
    x1: width / 2 - 200,
    y1: 150,
    x2: width / 2 - 200,
    y2: 600,
    angle: Math.PI / 2,
  };

  return {
    id: 'cyber_canyon',
    name: 'Cyber Canyon',
    description: 'Desert gorge with canyon crossover jumps and sweeping drifts',
    theme: 'canyon',
    width,
    height,
    outerBorder,
    innerBorder,
    boostPads,
    barriers,
    ramps,
    finishLine,
  };
}

// ============================================================================
// Map 3: Orbital Foundry (Industrial Factory Complex)
// ============================================================================
function createOrbitalFoundryTrack(): StadiumTrack {
  const width = 3600;
  const height = 2400;

  const outerBorder: Vector2D[] = [
    { x: 350, y: 150 },
    { x: width - 350, y: 150 },
    { x: width - 150, y: 350 },
    { x: width - 150, y: height - 350 },
    { x: width - 350, y: height - 150 },
    { x: 350, y: height - 150 },
    { x: 150, y: height - 350 },
    { x: 150, y: 350 },
  ];

  // Central reactor core island
  const innerBorder: Vector2D[] = [
    { x: 1100, y: 800 },
    { x: width - 1100, y: 800 },
    { x: width - 900, y: 1000 },
    { x: width - 900, y: height - 1000 },
    { x: width - 1100, y: height - 800 },
    { x: 1100, y: height - 800 },
    { x: 900, y: height - 1000 },
    { x: 900, y: 1000 },
  ];

  const barriers = [
    // Heavy structural steel pillars
    { id: 'foundry_p1', x: 650, y: 650, width: 80, height: 80, angle: 0, color: '#39ff14' },
    { id: 'foundry_p2', x: width - 650, y: 650, width: 80, height: 80, angle: 0, color: '#39ff14' },
    { id: 'foundry_p3', x: 650, y: height - 650, width: 80, height: 80, angle: 0, color: '#39ff14' },
    { id: 'foundry_p4', x: width - 650, y: height - 650, width: 80, height: 80, angle: 0, color: '#39ff14' },
    // Core chicanes
    { id: 'foundry_chicane_top', x: 1800, y: 550, width: 35, height: 180, angle: 0, color: '#ffcc00' },
    { id: 'foundry_chicane_bot', x: 1800, y: height - 550, width: 35, height: 180, angle: 0, color: '#ffcc00' },
    { id: 'foundry_chicane_left', x: 600, y: 1200, width: 180, height: 35, angle: 0, color: '#ffcc00' },
    { id: 'foundry_chicane_right', x: width - 600, y: 1200, width: 180, height: 35, angle: 0, color: '#ffcc00' },
  ];

  const boostPads = [
    { id: 'of_b1', x: 1200, y: 380, width: 90, height: 180, angle: 0, force: 450 },
    { id: 'of_b2', x: 2400, y: 380, width: 90, height: 180, angle: 0, force: 450 },
    { id: 'of_b3', x: 2400, y: height - 380, width: 90, height: 180, angle: Math.PI, force: 450 },
    { id: 'of_b4', x: 1200, y: height - 380, width: 90, height: 180, angle: Math.PI, force: 450 },
    { id: 'of_b5', x: 380, y: 800, width: 90, height: 180, angle: Math.PI / 2, force: 450 },
    { id: 'of_b6', x: width - 380, y: 1600, width: 90, height: 180, angle: -Math.PI / 2, force: 450 },
  ];

  // 4-Way jump ramps launching across technical intersections
  const ramps = [
    { id: 'foundry_ramp_n', x: 2000, y: 380, angle: 0, width: 85, length: 110, height: 20, launchBoost: 130 },
    { id: 'foundry_ramp_s', x: 1600, y: height - 380, angle: Math.PI, width: 85, length: 110, height: 20, launchBoost: 130 },
    { id: 'foundry_ramp_w', x: 380, y: 1500, angle: Math.PI / 2, width: 85, length: 110, height: 20, launchBoost: 130 },
    { id: 'foundry_ramp_e', x: width - 380, y: 900, angle: -Math.PI / 2, width: 85, length: 110, height: 20, launchBoost: 130 },
  ];

  const finishLine = {
    x1: width / 2 - 200,
    y1: 150,
    x2: width / 2 - 200,
    y2: 800,
    angle: Math.PI / 2,
  };

  return {
    id: 'orbital_foundry',
    name: 'Orbital Foundry',
    description: 'Technical multi-tier factory with conveyor boosts and 4-way jump ramps',
    theme: 'industrial',
    width,
    height,
    outerBorder,
    innerBorder,
    boostPads,
    barriers,
    ramps,
    finishLine,
  };
}

export const MAPS: Record<string, StadiumTrack> = {
  neon_stadium: createNeonStadiumTrack(),
  cyber_canyon: createCyberCanyonTrack(),
  orbital_foundry: createOrbitalFoundryTrack(),
};

export function getTrack(id: string): StadiumTrack {
  return MAPS[id] || MAPS.neon_stadium;
}
