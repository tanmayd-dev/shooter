import * as THREE from 'three';
import type { CarState, Projectile, StadiumTrack } from '../types.ts';
import { CameraController3D, CameraMode } from './camera.ts';
import { CarModelManager } from './cars.ts';
import { Track3D } from './track.ts';

export interface FloodlightTower {
  group: THREE.Group;
  light: THREE.SpotLight;
}

export class Renderer3D {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public cameraController: CameraController3D;
  public carManager: CarModelManager;
  public track3D: Track3D | null = null;

  public domElement: HTMLCanvasElement;

  private totalTime: number = 0;
  private floodlights: FloodlightTower[] = [];
  private dirSun: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;

  constructor(canvas?: HTMLCanvasElement, width?: number, height?: number) {
    const w = width ?? (canvas ? canvas.width : (typeof window !== 'undefined' ? window.innerWidth : 1920));
    const h = height ?? (canvas ? canvas.height : (typeof window !== 'undefined' ? window.innerHeight : 1080));

    // 1. Initialize WebGLRenderer with tone mapping and PCF soft shadow maps
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.domElement = this.renderer.domElement;

    // 2. Initialize Scene with dark cyber/stadium fog (#0a0c16)
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c16);
    this.scene.fog = new THREE.FogExp2(0x0a0c16, 0.00032);

    // 3. Initialize Lighting
    this.setupLighting();

    // 4. Initialize Camera Controller
    this.cameraController = new CameraController3D(w, h);

    // 5. Initialize Car Models & Visuals Manager
    this.carManager = new CarModelManager();
    this.scene.add(this.carManager.group);
  }

  // ==========================================================================
  // LIGHTING SETUP
  // ==========================================================================
  private setupLighting(): void {
    // 1. Ambient Light with cool cyan tint (#112233)
    this.ambientLight = new THREE.AmbientLight(0x112233, 1.25);
    this.scene.add(this.ambientLight);

    // 2. Directional Sunlight casting shadows
    const arenaCenterX = 1800;
    const arenaCenterZ = 1200;

    const sun = new THREE.DirectionalLight(0xfff6ee, 1.6);
    sun.position.set(arenaCenterX + 700, 1500, arenaCenterZ + 500);
    sun.target.position.set(arenaCenterX, 0, arenaCenterZ);
    sun.castShadow = true;

    // High resolution shadow camera covering the arena
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.bias = -0.0005;

    const d = 2100;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = 1500;
    sun.shadow.camera.bottom = -1500;
    sun.shadow.camera.near = 150;
    sun.shadow.camera.far = 3800;

    this.scene.add(sun);
    this.scene.add(sun.target);
    this.dirSun = sun;

    // 3. 4 Stadium Floodlight Towers at track corners
    const towerCorners = [
      { x: 180, z: 180, targetX: 1350, targetZ: 900 },
      { x: 3420, z: 180, targetX: 2250, targetZ: 900 },
      { x: 3420, z: 2220, targetX: 2250, targetZ: 1500 },
      { x: 180, z: 2220, targetX: 1350, targetZ: 1500 },
    ];

    for (const corner of towerCorners) {
      const tower = this.createFloodlightTower(corner.x, corner.z, corner.targetX, corner.targetZ);
      this.floodlights.push(tower);
      this.scene.add(tower.group);
      this.scene.add(tower.light);
      this.scene.add(tower.light.target);
    }
  }

  // ==========================================================================
  // 3D FLOODLIGHT TOWER GENERATOR
  // ==========================================================================
  private createFloodlightTower(
    x: number,
    z: number,
    targetX: number,
    targetZ: number
  ): FloodlightTower {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const towerHeight = 380;
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x343a4a,
      roughness: 0.55,
      metalness: 0.75,
    });
    const lampGlowMat = new THREE.MeshBasicMaterial({
      color: 0xeef9ff,
    });

    // 1. Tapering 4-leg lattice tower frame
    const baseW = 32;
    const topW = 16;
    const legRadius = 1.6;

    const legPositions = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];

    for (const [lx, lz] of legPositions) {
      const legGeo = new THREE.CylinderGeometry(legRadius, legRadius * 1.5, towerHeight, 6);
      const legMesh = new THREE.Mesh(legGeo, trussMat);
      legMesh.position.set((lx * (baseW + topW)) / 4, towerHeight / 2, (lz * (baseW + topW)) / 4);
      group.add(legMesh);
    }

    // 2. Horizontal & diagonal cross bracing rings
    const ringCount = 7;
    for (let i = 1; i <= ringCount; i++) {
      const ringY = (towerHeight / (ringCount + 1)) * i;
      const progress = i / (ringCount + 1);
      const ringW = baseW - (baseW - topW) * progress;

      const ringGeo = new THREE.BoxGeometry(ringW, 2.0, ringW);
      const ringMesh = new THREE.Mesh(ringGeo, trussMat);
      ringMesh.position.set(0, ringY, 0);
      group.add(ringMesh);
    }

    // 3. Masthead Floodlight Platform & Bank of Lamps
    const headPlatformGeo = new THREE.BoxGeometry(topW + 12, 4, topW + 12);
    const headPlatform = new THREE.Mesh(headPlatformGeo, trussMat);
    headPlatform.position.set(0, towerHeight, 0);
    group.add(headPlatform);

    // Lamp array (3x3 grid of glowing high-power floodlights)
    const bankGeo = new THREE.BoxGeometry(24, 18, 3.5);
    const bankMesh = new THREE.Mesh(bankGeo, trussMat);
    bankMesh.position.set(0, towerHeight + 12, 0);

    // Aim bank towards track center
    const angleToTarget = Math.atan2(targetZ - z, targetX - x);
    bankMesh.rotation.y = -angleToTarget + Math.PI / 2;
    group.add(bankMesh);

    // Glowing lamp faces
    for (let row = -1; row <= 1; row++) {
      for (let col = -1; col <= 1; col++) {
        const lampGeo = new THREE.BoxGeometry(5.5, 4.5, 0.6);
        const lamp = new THREE.Mesh(lampGeo, lampGlowMat);
        lamp.position.set(col * 7.0, towerHeight + 12 + row * 5.5, 2.0);
        lamp.rotation.y = -angleToTarget + Math.PI / 2;
        group.add(lamp);
      }
    }

    // 4. Bright Cone SpotLight pointing toward the track center
    const spot = new THREE.SpotLight(0xdcf2ff, 80, 3200, Math.PI / 4, 0.55, 1.2);
    spot.position.set(x, towerHeight + 12, z);
    spot.target.position.set(targetX, 0, targetZ);
    spot.castShadow = false; // Corner stadium fill lights don't need heavy per-light shadows

    return { group, light: spot };
  }

  // ==========================================================================
  // PUBLIC CONTROLS & CAMERA METHODS
  // ==========================================================================
  public updateCamera(target: CarState | null, dt: number): void {
    this.cameraController.update(target, dt);
  }

  public addScreenShake(amount: number): void {
    this.cameraController.addTrauma(amount);
  }

  public toggleCameraMode(): CameraMode {
    return this.cameraController.toggleMode();
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraController.setMode(mode);
  }

  public getCameraMode(): CameraMode {
    return this.cameraController.getMode();
  }

  public resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.cameraController.resize(width, height);
  }

  public toScreen(worldX: number, worldY: number): { x: number; y: number } | null {
    const canvas = this.domElement;
    return this.cameraController.toScreen(worldX, worldY, canvas.width, canvas.height);
  }

  // ==========================================================================
  // MAIN RENDER METHOD
  // ==========================================================================
  public render(
    track: StadiumTrack,
    cars: CarState[],
    projectiles: Projectile[],
    dt: number
  ): void {
    this.totalTime += dt;

    // 1. Build or maintain 3D track mesh
    if (!this.track3D) {
      this.track3D = new Track3D(track);
      this.scene.add(this.track3D.group);
    }
    this.track3D.update(dt, this.totalTime);

    // 2. Update 3D car models, wheel steer, lights, and projectiles
    this.carManager.update(cars, projectiles, dt, this.totalTime);

    // 3. Render Three.js WebGL scene
    this.renderer.render(this.scene, this.cameraController.camera);
  }

  // ==========================================================================
  // CLEANUP & RESOURCE DISPOSAL
  // ==========================================================================
  public dispose(): void {
    this.cameraController.dispose();
    this.carManager.dispose();
    this.track3D?.dispose();

    for (const f of this.floodlights) {
      f.light.dispose();
      this.scene.remove(f.group);
      this.scene.remove(f.light);
      this.scene.remove(f.light.target);
    }
    this.floodlights = [];

    if (this.dirSun) {
      this.dirSun.dispose();
      this.scene.remove(this.dirSun);
      this.scene.remove(this.dirSun.target);
    }
    if (this.ambientLight) {
      this.ambientLight.dispose();
      this.scene.remove(this.ambientLight);
    }

    this.renderer.dispose();
  }
}
