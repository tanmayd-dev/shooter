/**
 * Shared types for `shooter` - Vehicle physics, control inputs, combat, and network protocol.
 */

export { CAR_CONFIGS as ARCHETYPE_CONFIGS } from "./physics/configs.ts";

// ============================================================================
// Math & Vector Primitives
// ============================================================================

export interface Vector2D {
  x: number;
  y: number;
}

// ============================================================================
// Vehicle Archetypes & Configuration
// ============================================================================

export type CarType = "stadium" | "desert" | "rally" | "apex" | "titan";
export type CarArchetype = CarType;

export interface ArchetypeDisplayStats {
  topSpeed: number;
  grip: number;
  driftSlip: number;
  armor: number;
  turnRate: number;
}

export interface CarConfig {
  maxSpeed: number;             // Top forward speed in px/s
  topSpeed: number;             // Alias to maxSpeed for UI & HUD
  acceleration: number;         // Forward drive acceleration in px/s²
  reverseSpeed: number;         // Max reverse speed in px/s
  turnRate: number;             // Base steering rotation rate in rad/s
  gripRatio: number;            // Normal lateral grip factor (0..1, higher = less lateral slide)
  driftFrictionRatio: number;   // Lateral friction retention during drift (0..1)
  mass: number;                 // Vehicle mass in arbitrary units (affects ramming & recoil)
  maxHealth: number;            // Maximum structural integrity
  hitboxRadius: number;         // Collision radius in px
  primaryCooldown: number;      // Weapon fire interval in seconds
  specialCooldown: number;      // Special weapon cooldown in seconds
  mobilityCooldown: number;     // Mobility ability cooldown in seconds
  utilityCooldown: number;      // Tactical gadget cooldown in seconds
  color: string;                // Primary neon accent color (hex)
  name: string;                 // Display archetype name
  specName: string;             // Short archetype badge title
  description: string;          // Archetype overview
  strengths: string[];          // List of competitive strengths
  weaknesses: string[];         // List of competitive weaknesses
  primaryWeaponName: string;    // Display name for primary weapon [A]
  specialAbilityName: string;   // Display name for special weapon [S]
  mobilityAbilityName: string;  // Display name for mobility maneuver [D]
  tacticalGadgetName: string;   // Display name for tactical gadget [F]
  stats: ArchetypeDisplayStats; // Normalized stats for UI presentation
}

// ============================================================================
// Controls & Input State
// ============================================================================

export interface InputState {
  sequence: number;             // Monotonically increasing client input sequence number
  throttle: number;             // Forward drive input (0 to 1)
  steer: number;                // Steering input (-1 full left, +1 full right)
  brake: boolean;               // Brake / reverse / drift trigger
  firePrimary: boolean;         // Left-hand primary weapon trigger (KeyA)
  fireSpecial: boolean;         // Left-hand special weapon trigger (KeyS)
  abilityMobility: boolean;     // Left-hand mobility maneuver trigger (KeyD)
  abilityUtility: boolean;      // Left-hand tactical gadget trigger (KeyF)
  turnaround?: boolean;         // 180° quick flip turnaround (KeyR / Backspace)
  lookBack?: boolean;           // Rearview look-back camera (KeyB)
}

// ============================================================================
// Vehicle Kinematic Simulation State
// ============================================================================

export interface VehicleState {
  x: number;                    // Arena X position in px
  y: number;                    // Arena Y position in px
  z?: number;                   // Vertical elevation above tarmac (0 = on ground)
  vx: number;                   // Linear velocity X component in px/s
  vy: number;                   // Linear velocity Y component in px/s
  vz?: number;                  // Vertical launch velocity in px/s
  angle: number;                // Chassis heading angle in radians (0 = facing +X)
  angularVelocity: number;      // Current yaw rotation rate in rad/s
  isDrifting: boolean;          // True when vehicle lateral grip has broken
  isAirborne?: boolean;         // True when launched airborne from ramps
  pitch?: number;               // Incline/jump pitch angle
  driftAngle: number;           // Angular offset between velocity vector and chassis heading
  speed: number;                // Scalar magnitude of linear velocity in px/s
  skidIntensity: number;        // Skidmark and smoke intensity factor (0..1)
}

// ============================================================================
// Comprehensive Runtime Car & Combat State (used by renderer & combat)
// ============================================================================

export interface CarState extends VehicleState {
  id: string;
  name: string;
  archetype: CarArchetype;

  steer: number;
  throttle: number;
  handbrake: boolean;
  driftSlip?: number;
  isLocal?: boolean;
  armor?: number;
  maxArmor?: number;

  health: number;
  maxHealth: number;
  isAlive: boolean;
  respawnTimer?: number;
  respawnShieldDuration?: number;
  kills: number;
  deaths: number;
  score: number;

  primaryCooldown: number;
  specialCooldown: number;
  specialMaxCooldown?: number;
  mobilityCooldown: number;
  mobilityMaxCooldown?: number;
  gadgetCooldown: number;
  gadgetMaxCooldown?: number;

  shieldActive: boolean;
  shieldDuration: number;
  ramActive: boolean;
  ramDuration: number;
  boostActive: boolean;
  boostDuration: number;
  empDisrupted: boolean;
  empDuration: number;
}

// ============================================================================
// Arena Geometry & Stadium Track Environment
// ============================================================================

export interface ArenaBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Barrier {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  elasticity?: number;          // Restitution multiplier (default ~0.65)
  angle?: number;
  color?: string;
}

export interface BoostPad {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  force?: number;
}

export interface TrackBarrier {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  color?: string;
  elasticity?: number;
}

export interface FinishLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface JumpRamp {
  id: string;
  x: number;
  y: number;
  angle: number;
  width: number;
  length: number;
  height: number;
  launchBoost?: number;
}

export interface StadiumTrack {
  id?: string;
  name?: string;
  description?: string;
  theme?: string;
  width: number;
  height: number;
  outerBorder: Vector2D[];
  innerBorder: Vector2D[];
  boostPads: BoostPad[];
  barriers: TrackBarrier[];
  ramps?: JumpRamp[];
  finishLine: FinishLine;
}

// ============================================================================
// Projectiles & Combat Ballistics
// ============================================================================

export type ProjectileKind =
  | "bullet"
  | "rocket"
  | "rail_beam"
  | "mine"
  | "emp_cloud"
  | "decoy"
  | "pulse"
  | "missile"
  | "cannon"
  | "rail"
  | "beam"
  | "caltrop";

export interface Projectile {
  id: string;
  type: "bullet" | "rocket" | "rail_beam" | "mine" | "emp_cloud" | "decoy";
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  radius: number;
  damage: number;
  ownerId: string;
  lifetime: number;
  maxLifetime: number;
  color?: string;

  // Rail beam specific properties
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;

  // Landmine specific properties
  isArmed?: boolean;
  detonated?: boolean;

  // EMP cloud specific properties
  cloudRadius?: number;
  maxCloudRadius?: number;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  kind: ProjectileKind;
}

// ============================================================================
// Player & Match Protocol States
// ============================================================================

export interface PlayerCooldowns {
  primary: number;
  special: number;
  mobility: number;
  utility: number;
}

export interface PlayerState {
  id: string;
  name: string;
  carType: CarType;
  vehicle: VehicleState;
  health: number;
  maxHealth: number;
  score: number;
  kills: number;
  deaths: number;
  cooldowns: PlayerCooldowns;
  shieldActive: boolean;
  isAlive: boolean;
  respawnTimer: number;
}

export interface LobbyMember {
  id: string;
  name: string;
  carType: CarType;
  isReady: boolean;
  isHost: boolean;
  ping: number;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  archetype: CarArchetype;
  carType?: CarType;
  isReady: boolean;
  isHost: boolean;
  ping: number;
}

export interface LobbyInfo {
  code: string;
  hostId: string;
  members: LobbyMember[];
  state: "waiting" | "starting" | "in_game" | "game_over";
  maxPlayers: number;
}

export interface RoomState {
  code: string;
  hostId: string;
  players: LobbyPlayer[];
  map?: string;
  state?: "waiting" | "starting" | "in_game" | "game_over";
  matchActive?: boolean;
  countdown?: number | null;
  matchTimeRemaining?: number;
  maxPlayers?: number;
}

export interface MatchInfo {
  arena: ArenaBounds;
  barriers: Barrier[];
  durationSeconds: number;
  players: LobbyMember[];
}

export interface WorldSnapshot {
  tick: number;
  timestamp: number;
  players: Record<string, PlayerState>;
  projectiles: ProjectileState[];
}

export interface PlayerScore {
  id: string;
  name: string;
  score: number;
  kills: number;
  deaths: number;
  carType: CarType;
}

export interface KillfeedEntry {
  id: string;
  killerName: string;
  victimName: string;
  weapon: string;
  timestamp: number;
}

export interface MatchResults {
  winnerId: string;
  scores: PlayerScore[];
  durationSeconds: number;
}

// ============================================================================
// Client-to-Server Network Protocol Messages
// ============================================================================

export interface JoinLobby {
  type: "JoinLobby";
  lobbyCode?: string;
  playerName: string;
  carType: CarType;
}

export interface SetReady {
  type: "SetReady";
  ready: boolean;
}

export interface SelectCar {
  type: "SelectCar";
  carType: CarType;
}

export interface StartGame {
  type: "StartGame";
}

export interface PlayerInput {
  type: "PlayerInput";
  input: InputState;
  timestamp: number;
}

export interface Ping {
  type: "Ping";
  timestamp: number;
}

// ============================================================================
// Server-to-Client Network Protocol Messages
// ============================================================================

export interface LobbyUpdate {
  type: "LobbyUpdate";
  lobby: LobbyInfo;
}

export interface GameStart {
  type: "GameStart";
  matchInfo: MatchInfo;
}

export interface WorldState {
  type: "WorldState";
  state: WorldSnapshot;
}

export interface Pong {
  type: "Pong";
  clientTimestamp: number;
  serverTimestamp: number;
}

export interface GameOver {
  type: "GameOver";
  results: MatchResults;
}

export type ClientMessage =
  | JoinLobby
  | SetReady
  | SelectCar
  | StartGame
  | PlayerInput
  | Ping;

export type ServerMessage =
  | LobbyUpdate
  | GameStart
  | WorldState
  | Pong
  | GameOver;
