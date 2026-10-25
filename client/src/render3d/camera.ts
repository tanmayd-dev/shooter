import * as THREE from 'three';
import type { CarState } from '../types.ts';

export type CameraMode = 'chase' | 'stadium';

export interface CameraOptions {
  fov?: number;
  near?: number;
  far?: number;
  chaseDistance?: number;
  chaseElevation?: number;
  stadiumElevation?: number;
  stadiumDistance?: number;
}

export class CameraController3D {
  public camera: THREE.PerspectiveCamera;
  public mode: CameraMode = 'chase';

  // Smooth blending between modes (0 = chase, 1 = stadium)
  private modeBlend: number = 0;
  private targetModeBlend: number = 0;

  // Chase cam tuned parameters
  private readonly baseFov: number = 60;
  private readonly maxSpeedFov: number = 80;
  private readonly chaseDistance: number;
  private readonly chaseElevation: number;
  private readonly stadiumElevation: number;
  private readonly stadiumDistance: number;

  // Smoothed camera state
  private currentPos: THREE.Vector3 = new THREE.Vector3(1800, 45, 1200);
  private currentLookAt: THREE.Vector3 = new THREE.Vector3(1800, 10, 1200);
  private currentFov: number = 60;

  // Screen shake / trauma impulse
  public trauma: number = 0;

  // Keybind listener cleanup
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(width: number, height: number, options: CameraOptions = {}) {
    this.baseFov = options.fov ?? 60;
    this.chaseDistance = options.chaseDistance ?? 125;
    this.chaseElevation = options.chaseElevation ?? 42;
    this.stadiumElevation = options.stadiumElevation ?? 1350;
    this.stadiumDistance = options.stadiumDistance ?? 850;

    this.camera = new THREE.PerspectiveCamera(
      this.baseFov,
      width / Math.max(1, height),
      options.near ?? 2.0,
      options.far ?? 16000
    );

    this.camera.position.set(1800, this.chaseElevation, 1200 - this.chaseDistance);
    this.camera.lookAt(1800, 10, 1200);

    this.setupControls();
  }

  private setupControls(): void {
    if (typeof window !== 'undefined') {
      this.keyListener = (e: KeyboardEvent) => {
        // Avoid intercepting if typing inside an input element
        const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
        if (targetTag === 'input' || targetTag === 'textarea') return;

        if (e.code === 'KeyC' || e.key === 'c' || e.key === 'C') {
          this.toggleMode();
        }
      };
      window.addEventListener('keydown', this.keyListener);
    }
  }

  public toggleMode(): CameraMode {
    this.setMode(this.mode === 'chase' ? 'stadium' : 'chase');
    return this.mode;
  }

  public setMode(mode: CameraMode): void {
    this.mode = mode;
    this.targetModeBlend = mode === 'stadium' ? 1.0 : 0.0;
  }

  public getMode(): CameraMode {
    return this.mode;
  }

  public addTrauma(amount: number): void {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  public toScreen(
    worldX: number,
    worldY: number,
    screenWidth: number,
    screenHeight: number
  ): { x: number; y: number } | null {
    const v = new THREE.Vector3(worldX, 12, worldY);
    v.project(this.camera);
    if (v.z > 1.0) return null; // behind camera
    return {
      x: ((v.x + 1) / 2) * screenWidth,
      y: ((-v.y + 1) / 2) * screenHeight,
    };
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  public update(target: CarState | null, dt: number): void {
    // 1. Decay screen shake trauma
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    // 2. Smooth mode transition
    const blendSpeed = 4.0;
    this.modeBlend += (this.targetModeBlend - this.modeBlend) * Math.min(1.0, dt * blendSpeed);

    if (!target) {
      // Default to arena center if no target car is provided
      this.camera.position.set(1800, 900, 1200 + 700);
      this.camera.lookAt(1800, 0, 1200);
      return;
    }

    // Coordinate mapping: 2D x -> 3D X, 2D y -> 3D Z, 3D Y is height
    const carX = target.x;
    const carZ = target.y;
    const carY = 8; // approximate chassis center elevation

    // Chassis heading vectors in 3D:
    // angle = 0 -> facing +X; angle = PI/2 -> facing +Z
    const cosA = Math.cos(target.angle);
    const sinA = Math.sin(target.angle);
    const forwardX = cosA;
    const forwardZ = sinA;
    const rightX = -sinA;
    const rightZ = cosA;

    // Velocity magnitude and ratio
    const speed = Math.hypot(target.vx, target.vy);
    const speedRatio = Math.min(1.0, speed / 1350);

    // ==========================================
    // 1. CHASE CAMERA CALCULATION (Trackmania Cam 1)
    // ==========================================
    // Camera is placed behind the car along the reverse forward vector
    const chaseCamX = carX - forwardX * this.chaseDistance;
    const chaseCamZ = carZ - forwardZ * this.chaseDistance;
    const chaseCamY = carY + this.chaseElevation;

    // Look target is ahead of vehicle along forward vector + dynamic velocity lead
    const leadDist = 38 + speedRatio * 45;
    const chaseLookX = carX + forwardX * leadDist + target.vx * 0.05;
    const chaseLookZ = carZ + forwardZ * leadDist + target.vy * 0.05;
    const chaseLookY = carY + 10;

    // ==========================================
    // 2. STADIUM CAMERA CALCULATION (High Arena Cam)
    // ==========================================
    const stadiumCamX = carX;
    const stadiumCamZ = carZ + this.stadiumDistance;
    const stadiumCamY = this.stadiumElevation;

    const stadiumLookX = carX + target.vx * 0.15;
    const stadiumLookZ = carZ + target.vy * 0.15;
    const stadiumLookY = 0;

    // ==========================================
    // 3. BLEND MODES
    // ==========================================
    const targetPosX = THREE.MathUtils.lerp(chaseCamX, stadiumCamX, this.modeBlend);
    const targetPosY = THREE.MathUtils.lerp(chaseCamY, stadiumCamY, this.modeBlend);
    const targetPosZ = THREE.MathUtils.lerp(chaseCamZ, stadiumCamZ, this.modeBlend);

    const targetLookX = THREE.MathUtils.lerp(chaseLookX, stadiumLookX, this.modeBlend);
    const targetLookY = THREE.MathUtils.lerp(chaseLookY, stadiumLookY, this.modeBlend);
    const targetLookZ = THREE.MathUtils.lerp(chaseLookZ, stadiumLookZ, this.modeBlend);

    // Dynamic FOV: Chase expands at high speed for high-speed rush; Stadium cam has steady wide view
    const chaseFov = this.baseFov + speedRatio * (this.maxSpeedFov - this.baseFov);
    const stadiumFov = 64;
    const targetFov = THREE.MathUtils.lerp(chaseFov, stadiumFov, this.modeBlend);

    // Smooth lerp camera towards desired position & target
    const posLerpSpeed = THREE.MathUtils.lerp(12.0, 6.0, this.modeBlend);
    const lookLerpSpeed = 14.0;
    const lerpFactor = Math.min(1.0, dt * posLerpSpeed);
    const lookFactor = Math.min(1.0, dt * lookLerpSpeed);

    this.currentPos.x += (targetPosX - this.currentPos.x) * lerpFactor;
    this.currentPos.y += (targetPosY - this.currentPos.y) * lerpFactor;
    this.currentPos.z += (targetPosZ - this.currentPos.z) * lerpFactor;

    this.currentLookAt.x += (targetLookX - this.currentLookAt.x) * lookFactor;
    this.currentLookAt.y += (targetLookY - this.currentLookAt.y) * lookFactor;
    this.currentLookAt.z += (targetLookZ - this.currentLookAt.z) * lookFactor;

    this.currentFov += (targetFov - this.currentFov) * Math.min(1.0, dt * 5.0);

    // 4. Screen Shake Trauma Jitter
    let jitterX = 0;
    let jitterY = 0;
    let jitterZ = 0;
    if (this.trauma > 0.001) {
      const shake = this.trauma * this.trauma;
      const maxShakeOffset = 18;
      jitterX = (Math.random() * 2 - 1) * shake * maxShakeOffset;
      jitterY = (Math.random() * 2 - 1) * shake * maxShakeOffset;
      jitterZ = (Math.random() * 2 - 1) * shake * maxShakeOffset;
    }

    // 5. Drift Lean / Camera Roll
    // During heavy slides, camera rolls slightly with lateral slip
    const driftIntensity = target.isDrifting ? (target.skidIntensity || 0.8) : 0;
    const driftSign = Math.sign(target.driftAngle || target.steer || 0);
    const maxLean = 0.065; // ~3.7 degrees
    const targetLean = -driftSign * driftIntensity * maxLean * (1.0 - this.modeBlend);

    // Compute tilted Up vector using car right vector
    const upVector = new THREE.Vector3(
      rightX * targetLean,
      1.0,
      rightZ * targetLean
    ).normalize();

    // 6. Apply position, look target, up vector, and FOV
    this.camera.position.set(
      this.currentPos.x + jitterX,
      this.currentPos.y + jitterY,
      this.currentPos.z + jitterZ
    );
    this.camera.up.copy(upVector);
    this.camera.lookAt(this.currentLookAt);

    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  public dispose(): void {
    if (typeof window !== 'undefined' && this.keyListener) {
      window.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
  }
}
