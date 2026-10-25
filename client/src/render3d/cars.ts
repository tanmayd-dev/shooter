import * as THREE from 'three';
import type { CarArchetype, CarState, Projectile } from '../types.ts';

// ============================================================================
// Shared Geometry & Material Helpers
// ============================================================================

interface WheelAssembly {
  pivot: THREE.Group;
  wheelMesh: THREE.Mesh;
  isFront: boolean;
  localPos: THREE.Vector3;
}

export class Car3DModel {
  public group: THREE.Group = new THREE.Group();
  public archetype: CarArchetype;

  // Wheel assemblies for physical steering & rolling
  private wheels: WheelAssembly[] = [];

  // Lighting
  private leftHeadlight: THREE.SpotLight;
  private rightHeadlight: THREE.SpotLight;
  private taillights: THREE.Mesh[] = [];
  private taillightMaterial: THREE.MeshStandardMaterial;

  // Combat Visuals
  private shieldBubble: THREE.Mesh;
  private exhaustFlames: THREE.Mesh[] = [];

  // Supercharger butterfly valves (Desert Spec)
  private butterflyValves: THREE.Mesh[] = [];

  constructor(archetype: CarArchetype) {
    this.archetype = archetype;

    // 1. Build chassis body according to archetype
    switch (archetype) {
      case 'desert':
        this.buildDesertSpec();
        break;
      case 'rally':
        this.buildRallySpec();
        break;
      case 'stadium':
      default:
        this.buildStadiumSpec();
        break;
    }

    // 2. Setup 3D Headlights & Taillights
    const { leftLight, rightLight, taillightMat } = this.setupLights();
    this.leftHeadlight = leftLight;
    this.rightHeadlight = rightLight;
    this.taillightMaterial = taillightMat;

    // 3. Setup Deflector Shield Bubble
    this.shieldBubble = this.setupShieldBubble();

    // Enable shadows on all child meshes
    this.group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  // ==========================================================================
  // ARCHETYPE 1: STADIUM SPEC (Formula 1 Precision Drifter)
  // ==========================================================================
  private buildStadiumSpec(): void {
    const primaryMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff, // Trackmania Stadium Cyan
      roughness: 0.22,
      metalness: 0.85,
    });
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x14161f,
      roughness: 0.6,
      metalness: 0.5,
    });
    const cockpitGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
    });

    // 1. Aerodynamic Monocoque Tub (Length 46, Width 14, Height 7)
    const tubGeo = new THREE.BoxGeometry(32, 6, 14);
    const tubMesh = new THREE.Mesh(tubGeo, primaryMat);
    tubMesh.position.set(-2, 5, 0);
    this.group.add(tubMesh);

    // 2. Tapered Aerodynamic Nose Cone
    const noseGeo = new THREE.ConeGeometry(7, 16, 4);
    noseGeo.rotateZ(-Math.PI / 2);
    noseGeo.rotateX(Math.PI / 4);
    const noseMesh = new THREE.Mesh(noseGeo, primaryMat);
    noseMesh.position.set(18, 4.5, 0);
    noseMesh.scale.set(1.0, 0.5, 0.9);
    this.group.add(noseMesh);

    // 3. Front Double-Wing Splitter with Endplates
    const lowerSplitterGeo = new THREE.BoxGeometry(8, 1.2, 26);
    const lowerSplitter = new THREE.Mesh(lowerSplitterGeo, carbonMat);
    lowerSplitter.position.set(22, 2.5, 0);
    this.group.add(lowerSplitter);

    const upperSplitterGeo = new THREE.BoxGeometry(6, 1.0, 24);
    const upperSplitter = new THREE.Mesh(upperSplitterGeo, primaryMat);
    upperSplitter.position.set(19, 4.5, 0);
    this.group.add(upperSplitter);

    // Splitter Vertical Endplates
    for (const z of [-13, 13]) {
      const endplateGeo = new THREE.BoxGeometry(10, 4.5, 0.8);
      const endplate = new THREE.Mesh(endplateGeo, carbonMat);
      endplate.position.set(21, 3.8, z);
      this.group.add(endplate);
    }

    // 4. Open Cockpit & Halo Hoop Safety Bar
    const cockpitRecessGeo = new THREE.BoxGeometry(10, 2, 7);
    const cockpitRecess = new THREE.Mesh(cockpitRecessGeo, carbonMat);
    cockpitRecess.position.set(0, 7.8, 0);
    this.group.add(cockpitRecess);

    // Glowing Holographic Cockpit HUD instrument display
    const hudGeo = new THREE.BoxGeometry(1.5, 2.0, 4.5);
    const hudMesh = new THREE.Mesh(hudGeo, cockpitGlowMat);
    hudMesh.position.set(4, 8.2, 0);
    this.group.add(hudMesh);

    // Halo Hoop
    const haloGeo = new THREE.TorusGeometry(3.5, 0.65, 8, 16, Math.PI);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMesh = new THREE.Mesh(haloGeo, carbonMat);
    haloMesh.position.set(-1, 9.5, 0);
    this.group.add(haloMesh);

    const haloPillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 3.5, 8);
    const haloPillar = new THREE.Mesh(haloPillarGeo, carbonMat);
    haloPillar.position.set(2.5, 9.2, 0);
    this.group.add(haloPillar);

    // 5. Side Pods with Angled Radiator Intakes
    for (const z of [-8.5, 8.5]) {
      const podGeo = new THREE.BoxGeometry(18, 5.5, 5);
      const podMesh = new THREE.Mesh(podGeo, primaryMat);
      podMesh.position.set(-3, 4.8, z);
      this.group.add(podMesh);

      // Intake grille
      const intakeGeo = new THREE.BoxGeometry(1.0, 4.0, 4.0);
      const intakeMesh = new THREE.Mesh(intakeGeo, carbonMat);
      intakeMesh.position.set(6.2, 4.8, z);
      this.group.add(intakeMesh);
    }

    // 6. Elevated Double-Deck Rear Spoiler
    const wingPillarGeo = new THREE.BoxGeometry(2, 8, 1.2);
    for (const z of [-4, 4]) {
      const pillar = new THREE.Mesh(wingPillarGeo, carbonMat);
      pillar.position.set(-17, 9, z);
      this.group.add(pillar);
    }

    // Lower deck wing
    const lowerWingGeo = new THREE.BoxGeometry(7, 1.2, 26);
    const lowerWing = new THREE.Mesh(lowerWingGeo, carbonMat);
    lowerWing.position.set(-17, 11.5, 0);
    this.group.add(lowerWing);

    // Upper deck wing
    const upperWingGeo = new THREE.BoxGeometry(6, 1.2, 28);
    const upperWing = new THREE.Mesh(upperWingGeo, primaryMat);
    upperWing.position.set(-18, 13.8, 0);
    this.group.add(upperWing);

    // Wing vertical endplates with neon edge
    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    for (const z of [-14, 14]) {
      const wingEndGeo = new THREE.BoxGeometry(9, 6, 0.8);
      const wingEnd = new THREE.Mesh(wingEndGeo, carbonMat);
      wingEnd.position.set(-17.5, 12.5, z);
      this.group.add(wingEnd);

      const wingNeonGeo = new THREE.BoxGeometry(9, 0.6, 0.9);
      const wingNeon = new THREE.Mesh(wingNeonGeo, neonCyan);
      wingNeon.position.set(-17.5, 15.5, z);
      this.group.add(wingNeon);
    }

    // 7. Wheels & Suspension
    this.setupWheels({
      frontX: 14,
      rearX: -14,
      widthZ: 13,
      radius: 4.8,
      thickness: 3.2,
      rimColor: 0x00f0ff,
    });
  }

  // ==========================================================================
  // ARCHETYPE 2: DESERT SPEC (Muscle Car Heavy Brawler)
  // ==========================================================================
  private buildDesertSpec(): void {
    const muscleOrangeMat = new THREE.MeshStandardMaterial({
      color: 0xff5500, // Desert Muscle Orange
      roughness: 0.35,
      metalness: 0.65,
    });
    const darkChassisMat = new THREE.MeshStandardMaterial({
      color: 0x181a24,
      roughness: 0.5,
      metalness: 0.7,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.2,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xf5f8fc,
      roughness: 0.12,
      metalness: 0.95,
    });
    const butterflyValveMat = new THREE.MeshBasicMaterial({
      color: 0xff1122, // Red intake butterfly valves
    });

    // 1. Muscular Wide Body (Length 48, Width 22, Height 8)
    const bodyGeo = new THREE.BoxGeometry(46, 8, 20);
    const bodyMesh = new THREE.Mesh(bodyGeo, muscleOrangeMat);
    bodyMesh.position.set(0, 5.5, 0);
    this.group.add(bodyMesh);

    // Aggressive Flared Wheel Arches
    for (const x of [-13, 13]) {
      for (const z of [-11, 11]) {
        const archGeo = new THREE.BoxGeometry(11, 6, 2.5);
        const archMesh = new THREE.Mesh(archGeo, muscleOrangeMat);
        archMesh.position.set(x, 6.0, z);
        this.group.add(archMesh);
      }
    }

    // 2. Cabin & Roofline with Tinted Windows
    const cabinGeo = new THREE.BoxGeometry(22, 6, 17);
    const cabinMesh = new THREE.Mesh(cabinGeo, darkChassisMat);
    cabinMesh.position.set(-4, 11, 0);
    this.group.add(cabinMesh);

    // Fastback roof plate
    const roofGeo = new THREE.BoxGeometry(21, 1.2, 16.5);
    const roofMesh = new THREE.Mesh(roofGeo, muscleOrangeMat);
    roofMesh.position.set(-4, 14.2, 0);
    this.group.add(roofMesh);

    // 3. Twin White Racing Stripes (running longitudinally down hood & roof)
    for (const z of [-2.5, 2.5]) {
      // Hood stripe
      const hoodStripeGeo = new THREE.BoxGeometry(19, 0.4, 2.0);
      const hoodStripe = new THREE.Mesh(hoodStripeGeo, stripeMat);
      hoodStripe.position.set(13.5, 9.6, z);
      this.group.add(hoodStripe);

      // Roof stripe
      const roofStripeGeo = new THREE.BoxGeometry(21, 0.4, 2.0);
      const roofStripe = new THREE.Mesh(roofStripeGeo, stripeMat);
      roofStripe.position.set(-4, 14.9, z);
      this.group.add(roofStripe);
    }

    // 4. Exposed Chrome Engine Supercharger Scoop
    const scoopBaseGeo = new THREE.BoxGeometry(9, 3.5, 8);
    const scoopBase = new THREE.Mesh(scoopBaseGeo, chromeMat);
    scoopBase.position.set(9, 10.5, 0);
    this.group.add(scoopBase);

    // Front intake snout with 3 red butterfly valves
    const intakeSnoutGeo = new THREE.BoxGeometry(2.5, 3.0, 7.5);
    const intakeSnout = new THREE.Mesh(intakeSnoutGeo, chromeMat);
    intakeSnout.position.set(14, 10.5, 0);
    this.group.add(intakeSnout);

    for (let i = -1; i <= 1; i++) {
      const valveGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.4, 12);
      valveGeo.rotateZ(Math.PI / 2);
      const valveMesh = new THREE.Mesh(valveGeo, butterflyValveMat);
      valveMesh.position.set(15.2, 10.5, i * 2.2);
      this.group.add(valveMesh);
      this.butterflyValves.push(valveMesh);
    }

    // 5. Heavy Front Ramming Bull-Bar
    const bullBarGeo = new THREE.BoxGeometry(3, 7, 22);
    const bullBar = new THREE.Mesh(bullBarGeo, darkChassisMat);
    bullBar.position.set(23.5, 4.5, 0);
    this.group.add(bullBar);

    // 6. Dual Side Exhaust Pipes with Flame Bursts
    const exhaustMat = chromeMat;
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff7700,
      transparent: true,
      opacity: 0.85,
    });

    for (const z of [-11.5, 11.5]) {
      const pipeGeo = new THREE.CylinderGeometry(1.2, 1.2, 6, 8);
      pipeGeo.rotateX(Math.PI / 2);
      const pipeMesh = new THREE.Mesh(pipeGeo, exhaustMat);
      pipeMesh.position.set(-6, 3.0, z);
      this.group.add(pipeMesh);

      // Flame burst mesh (cone extending outward)
      const flameGeo = new THREE.ConeGeometry(1.6, 7, 6);
      flameGeo.rotateX(z > 0 ? Math.PI / 2 : -Math.PI / 2);
      const flameMesh = new THREE.Mesh(flameGeo, flameMat);
      flameMesh.position.set(-6, 3.0, z + (z > 0 ? 4 : -4));
      flameMesh.visible = false;
      this.group.add(flameMesh);
      this.exhaustFlames.push(flameMesh);
    }

    // 7. Chunky Wide Racing Wheels
    this.setupWheels({
      frontX: 13,
      rearX: -13,
      widthZ: 12.5,
      radius: 5.4,
      thickness: 4.2,
      rimColor: 0xff5500,
    });
  }

  // ==========================================================================
  // ARCHETYPE 3: RALLY SPEC (Compact Hot-Hatch Agile Skirmisher)
  // ==========================================================================
  private buildRallySpec(): void {
    const rallyGreenMat = new THREE.MeshStandardMaterial({
      color: 0x33e600, // Electric Rally Lime
      roughness: 0.3,
      metalness: 0.7,
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x161822,
      roughness: 0.6,
      metalness: 0.4,
    });
    const fogLightLensMat = new THREE.MeshBasicMaterial({
      color: 0xfff488, // Warm yellow fog lamps
    });
    const mudflapMat = new THREE.MeshStandardMaterial({
      color: 0x0f1118,
      roughness: 0.9,
    });

    // 1. Compact Aerodynamic Hot-Hatch Chassis (Length 42, Width 19, Height 9)
    const bodyGeo = new THREE.BoxGeometry(40, 7.5, 18);
    const bodyMesh = new THREE.Mesh(bodyGeo, rallyGreenMat);
    bodyMesh.position.set(0, 5.2, 0);
    this.group.add(bodyMesh);

    // Rally Hatchback Cabin
    const cabinGeo = new THREE.BoxGeometry(22, 6.5, 15);
    const cabinMesh = new THREE.Mesh(cabinGeo, darkTrimMat);
    cabinMesh.position.set(-2, 10.5, 0);
    this.group.add(cabinMesh);

    const roofGeo = new THREE.BoxGeometry(21, 1.0, 14.5);
    const roofMesh = new THREE.Mesh(roofGeo, rallyGreenMat);
    roofMesh.position.set(-2, 13.8, 0);
    this.group.add(roofMesh);

    // 2. Functional Roof Air Scoop
    const scoopGeo = new THREE.BoxGeometry(6, 2.2, 4.5);
    const scoopMesh = new THREE.Mesh(scoopGeo, darkTrimMat);
    scoopMesh.position.set(3, 14.8, 0);
    this.group.add(scoopMesh);

    // 3. Front Bumper Quad Circular Rally Fog Light Pods
    const podX = 20.5;
    const fogPositions = [-6.5, -2.2, 2.2, 6.5];
    for (const z of fogPositions) {
      // Pod housing
      const housingGeo = new THREE.CylinderGeometry(1.6, 1.8, 2.0, 12);
      housingGeo.rotateZ(Math.PI / 2);
      const housing = new THREE.Mesh(housingGeo, darkTrimMat);
      housing.position.set(podX, 6.2, z);
      this.group.add(housing);

      // Glowing circular lens
      const lensGeo = new THREE.CircleGeometry(1.4, 12);
      lensGeo.rotateY(Math.PI / 2);
      const lens = new THREE.Mesh(lensGeo, fogLightLensMat);
      lens.position.set(podX + 1.1, 6.2, z);
      this.group.add(lens);
    }

    // 4. Elevated Rear Rally Wing
    const wingPillarGeo = new THREE.BoxGeometry(1.5, 5.5, 1.0);
    for (const z of [-4.5, 4.5]) {
      const pillar = new THREE.Mesh(wingPillarGeo, darkTrimMat);
      pillar.position.set(-14, 14.5, z);
      this.group.add(pillar);
    }

    const wingGeo = new THREE.BoxGeometry(6, 1.2, 20);
    const wingMesh = new THREE.Mesh(wingGeo, rallyGreenMat);
    wingMesh.position.set(-15, 16.5, 0);
    this.group.add(wingMesh);

    // 5. Mudflaps Behind All Four Wheels
    for (const x of [-17.5, 7.5]) {
      for (const z of [-9.5, 9.5]) {
        const flapGeo = new THREE.BoxGeometry(0.5, 3.8, 3.5);
        const flapMesh = new THREE.Mesh(flapGeo, mudflapMat);
        flapMesh.position.set(x, 2.5, z);
        this.group.add(flapMesh);
      }
    }

    // 6. Wheels
    this.setupWheels({
      frontX: 12,
      rearX: -12,
      widthZ: 10.5,
      radius: 4.6,
      thickness: 3.2,
      rimColor: 0x33e600,
    });
  }

  // ==========================================================================
  // WHEEL ASSEMBLIES & SUSPENSION
  // ==========================================================================
  private setupWheels(config: {
    frontX: number;
    rearX: number;
    widthZ: number;
    radius: number;
    thickness: number;
    rimColor: number;
  }): void {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x11131a, // Dark rubber
      roughness: 0.9,
      metalness: 0.1,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: config.rimColor,
      roughness: 0.35,
      metalness: 0.8,
    });

    const positions = [
      { x: config.frontX, z: -config.widthZ, front: true },
      { x: config.frontX, z: config.widthZ, front: true },
      { x: config.rearX, z: -config.widthZ, front: false },
      { x: config.rearX, z: config.widthZ, front: false },
    ];

    for (const p of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(p.x, config.radius, p.z);

      // Tire cylinder oriented with axle along Z
      const wheelGeo = new THREE.CylinderGeometry(config.radius, config.radius, config.thickness, 18);
      wheelGeo.rotateX(Math.PI / 2);
      const wheelMesh = new THREE.Mesh(wheelGeo, tireMat);

      // Alloy Rim Hubcap
      const rimGeo = new THREE.CylinderGeometry(config.radius * 0.65, config.radius * 0.65, config.thickness + 0.1, 10);
      rimGeo.rotateX(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      wheelMesh.add(rimMesh);

      pivot.add(wheelMesh);
      this.group.add(pivot);

      this.wheels.push({
        pivot,
        wheelMesh,
        isFront: p.front,
        localPos: new THREE.Vector3(p.x, config.radius, p.z),
      });
    }
  }

  // ==========================================================================
  // LIGHTING: DYNAMIC HEADLIGHTS & TAILLIGHTS
  // ==========================================================================
  private setupLights(): {
    leftLight: THREE.SpotLight;
    rightLight: THREE.SpotLight;
    taillightMat: THREE.MeshStandardMaterial;
  } {
    // Dynamic SpotLights for forward illumination
    const leftLight = new THREE.SpotLight(0xe8f8ff, 60, 360, Math.PI / 5.5, 0.45, 1.2);
    leftLight.position.set(22, 6, -8);
    leftLight.target.position.set(200, 0, -8);
    this.group.add(leftLight);
    this.group.add(leftLight.target);

    const rightLight = new THREE.SpotLight(0xe8f8ff, 60, 360, Math.PI / 5.5, 0.45, 1.2);
    rightLight.position.set(22, 6, 8);
    rightLight.target.position.set(200, 0, 8);
    this.group.add(rightLight);
    this.group.add(rightLight.target);

    // Glowing headlight lens meshes on front bumper
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xecf6ff });
    for (const z of [-8, 8]) {
      const lensGeo = new THREE.BoxGeometry(0.8, 2.2, 4.0);
      const lensMesh = new THREE.Mesh(lensGeo, lensMat);
      lensMesh.position.set(23.2, 5.5, z);
      this.group.add(lensMesh);
    }

    // Rear Taillights
    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0xff0022,
      emissive: 0xff0022,
      emissiveIntensity: 1.2,
      roughness: 0.3,
    });

    for (const z of [-7.5, 7.5]) {
      const tailGeo = new THREE.BoxGeometry(0.8, 1.8, 4.5);
      const tailMesh = new THREE.Mesh(tailGeo, taillightMat);
      tailMesh.position.set(-22.5, 6.0, z);
      this.group.add(tailMesh);
      this.taillights.push(tailMesh);
    }

    return { leftLight, rightLight, taillightMat };
  }

  // ==========================================================================
  // DEFLECTOR SHIELD BUBBLE
  // ==========================================================================
  private setupShieldBubble(): THREE.Mesh {
    const shieldGeo = new THREE.SphereGeometry(28, 24, 16);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.4,
      wireframe: true,
    });
    const bubble = new THREE.Mesh(shieldGeo, shieldMat);
    bubble.position.set(0, 7, 0);
    bubble.visible = false;
    this.group.add(bubble);
    return bubble;
  }

  // ==========================================================================
  // UPDATE STATE: POSITION, ROTATION, WHEELS, LIGHTS, COMBAT FX
  // ==========================================================================
  public update(car: CarState, dt: number, time: number): void {
    // 1. World Position & Heading Rotation
    // 2D x -> 3D X; 2D y -> 3D Z; 3D Y is ground clearance
    this.group.position.set(car.x, 0, car.y);
    this.group.rotation.y = -car.angle;

    // 2. Physical Front Wheel Steering
    // car.steer: -1 (left) to +1 (right)
    const maxSteerRad = 0.52; // ~30 degrees
    const targetSteerAngle = -car.steer * maxSteerRad;

    // 3. Wheel Rolling Rotation
    const wheelRadius = 4.8;
    const rollSpeed = (car.speed / wheelRadius) * dt;

    for (const w of this.wheels) {
      if (w.isFront) {
        w.pivot.rotation.y = targetSteerAngle;
      }
      w.wheelMesh.rotation.z += rollSpeed;
    }

    // 4. Taillights: Intensify on handbrake or reverse/braking
    const isBraking = car.handbrake || car.throttle < -0.05;
    this.taillightMaterial.emissiveIntensity = isBraking ? 4.0 : 1.2;

    // 5. Deflector Shield Bubble
    this.shieldBubble.visible = Boolean(car.shieldActive);
    if (car.shieldActive) {
      const pulse = 1.0 + Math.sin(time * 10) * 0.04;
      this.shieldBubble.scale.set(pulse, pulse, pulse);
      this.shieldBubble.rotation.y += dt * 0.8;
    }

    // 6. Side Exhaust Flame Bursts (Desert Spec / Boosting)
    const showFlames = car.boostActive || (car.throttle > 0.8 && car.speed > 500);
    for (const flame of this.exhaustFlames) {
      flame.visible = showFlames;
      if (showFlames) {
        const flicker = 0.8 + Math.random() * 0.45;
        flame.scale.set(flicker, flicker, flicker);
      }
    }

    // 7. Desert Supercharger Butterfly Valves flutter with throttle
    if (this.butterflyValves.length > 0) {
      const valveAngle = (car.throttle > 0.1 ? 0.65 : 0.05) + Math.sin(time * 20) * 0.05;
      for (const v of this.butterflyValves) {
        v.rotation.x = valveAngle;
      }
    }

    // 8. Visibility based on car life
    this.group.visible = car.isAlive;
  }

  public getWheelContactWorldPositions(): THREE.Vector3[] {
    const results: THREE.Vector3[] = [];
    for (const w of this.wheels) {
      const worldPos = new THREE.Vector3();
      w.pivot.getWorldPosition(worldPos);
      worldPos.y = 0.35; // tarmac contact level
      results.push(worldPos);
    }
    return results;
  }

  public dispose(): void {
    this.leftHeadlight.dispose();
    this.rightHeadlight.dispose();
    this.group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });
  }
}

// ============================================================================
// 3D PERSISTENT SKID MARKS (Quad Ribbons)
// ============================================================================

interface SkidSegment {
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  alpha: number;
}

export class SkidmarkSystem3D {
  public mesh: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private material: THREE.MeshBasicMaterial;

  private maxSegments = 1600;
  private segments: SkidSegment[] = [];
  private positions: Float32Array;
  private colors: Float32Array;

  // Track previous tire positions for each car
  private prevTirePositions: Map<string, THREE.Vector3[]> = new Map();

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxSegments * 6 * 3); // 2 triangles (6 verts) per quad
    this.colors = new Float32Array(this.maxSegments * 6 * 4);

    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  public update(cars: CarState[], carModels: Map<string, Car3DModel>, dt: number): void {
    // 1. Gradually fade existing skidmark segments
    const fadeRate = dt * 0.08;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      this.segments[i].alpha -= fadeRate;
      if (this.segments[i].alpha <= 0.01) {
        this.segments.splice(i, 1);
      }
    }

    // 2. Add new skidmark quad segments for drifting cars
    for (const car of cars) {
      if (!car.isAlive) {
        this.prevTirePositions.delete(car.id);
        continue;
      }

      const model = carModels.get(car.id);
      if (!model) continue;

      const currentContacts = model.getWheelContactWorldPositions();
      const prevContacts = this.prevTirePositions.get(car.id);

      const isDrifting = car.isDrifting || (car.skidIntensity && car.skidIntensity > 0.15) || car.handbrake;

      if (isDrifting && prevContacts && prevContacts.length === currentContacts.length) {
        const ribbonWidth = 2.4;
        // Lay down rubber behind rear wheels (index 2 & 3) and hard sliding front wheels
        const activeTireIndices = car.isDrifting ? [0, 1, 2, 3] : [2, 3];

        for (const idx of activeTireIndices) {
          const prev = prevContacts[idx];
          const curr = currentContacts[idx];
          const dist = prev.distanceTo(curr);

          if (dist > 3.0 && dist < 70.0) {
            // Direction of tire motion
            const dirX = curr.x - prev.x;
            const dirZ = curr.z - prev.z;
            const len = Math.hypot(dirX, dirZ);
            if (len > 1e-4) {
              const perpX = (-dirZ / len) * (ribbonWidth / 2);
              const perpZ = (dirX / len) * (ribbonWidth / 2);

              const p1 = new THREE.Vector3(curr.x - perpX, 0.4, curr.z - perpZ);
              const p2 = new THREE.Vector3(curr.x + perpX, 0.4, curr.z + perpZ);

              if (this.segments.length >= this.maxSegments) {
                this.segments.shift();
              }
              this.segments.push({
                p1,
                p2,
                alpha: Math.min(0.75, (car.skidIntensity || 0.6) * 0.8),
              });
            }
          }
        }
      }

      // Store current contacts
      this.prevTirePositions.set(car.id, currentContacts.map((v) => v.clone()));
    }

    // 3. Rebuild BufferGeometry attributes
    let vertIdx = 0;
    const numSegments = this.segments.length;

    for (let i = 1; i < numSegments; i++) {
      const sPrev = this.segments[i - 1];
      const sCurr = this.segments[i];

      // If segments are too far apart, don't bridge them
      if (sPrev.p1.distanceTo(sCurr.p1) > 60) continue;

      // Quad triangle 1: pPrev1, pPrev2, pCurr1
      this.setVertex(vertIdx++, sPrev.p1, sPrev.alpha);
      this.setVertex(vertIdx++, sPrev.p2, sPrev.alpha);
      this.setVertex(vertIdx++, sCurr.p1, sCurr.alpha);

      // Quad triangle 2: pPrev2, pCurr2, pCurr1
      this.setVertex(vertIdx++, sPrev.p2, sPrev.alpha);
      this.setVertex(vertIdx++, sCurr.p2, sCurr.alpha);
      this.setVertex(vertIdx++, sCurr.p1, sCurr.alpha);
    }

    this.geometry.setDrawRange(0, vertIdx);
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  private setVertex(idx: number, pos: THREE.Vector3, alpha: number): void {
    const pOffset = idx * 3;
    this.positions[pOffset] = pos.x;
    this.positions[pOffset + 1] = pos.y;
    this.positions[pOffset + 2] = pos.z;

    const cOffset = idx * 4;
    this.colors[cOffset] = 0.05; // Dark rubber R
    this.colors[cOffset + 1] = 0.06; // G
    this.colors[cOffset + 2] = 0.08; // B
    this.colors[cOffset + 3] = alpha;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.segments = [];
    this.prevTirePositions.clear();
  }
}

// ============================================================================
// 3D COMBAT PROJECTILES SYSTEM
// ============================================================================

interface ProjectileVisual {
  group: THREE.Group;
  type: string;
}

export class ProjectileSystem3D {
  public group: THREE.Group = new THREE.Group();
  private visuals: Map<string, ProjectileVisual> = new Map();

  // Shared Geometries & Materials for high performance
  private plasmaGeo: THREE.BufferGeometry;
  private plasmaMat: THREE.MeshBasicMaterial;

  private rocketBodyGeo: THREE.BufferGeometry;
  private rocketFinGeo: THREE.BufferGeometry;
  private rocketMat: THREE.MeshStandardMaterial;
  private rocketFlameMat: THREE.MeshBasicMaterial;

  private caltropGeo: THREE.BufferGeometry;
  private caltropMat: THREE.MeshStandardMaterial;
  private caltropBeaconMat: THREE.MeshBasicMaterial;

  constructor() {
    // 1. Plasma Bolt: elongated glowing cyan capsule
    this.plasmaGeo = new THREE.CylinderGeometry(2.2, 2.2, 16, 8);
    this.plasmaGeo.rotateZ(Math.PI / 2);
    this.plasmaMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    // 2. Rocket Fuselage & Fins
    this.rocketBodyGeo = new THREE.CylinderGeometry(2.5, 2.5, 18, 10);
    this.rocketBodyGeo.rotateZ(Math.PI / 2);
    this.rocketFinGeo = new THREE.BoxGeometry(4, 0.4, 7);
    this.rocketMat = new THREE.MeshStandardMaterial({
      color: 0x222634,
      roughness: 0.4,
      metalness: 0.7,
    });
    this.rocketFlameMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });

    // 3. Caltrop Landmine
    this.caltropGeo = new THREE.BoxGeometry(4.0, 4.0, 4.0);
    this.caltropMat = new THREE.MeshStandardMaterial({
      color: 0x1f2330,
      roughness: 0.5,
      metalness: 0.8,
    });
    this.caltropBeaconMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
  }

  public update(projectiles: Projectile[], _dt: number, time: number): void {
    const activeIds = new Set<string>();

    for (const p of projectiles) {
      activeIds.add(p.id);
      let visual = this.visuals.get(p.id);

      if (!visual) {
        visual = this.createVisual(p);
        this.visuals.set(p.id, visual);
        this.group.add(visual.group);
      }

      // Update position & orientation
      visual.group.position.set(p.x, 6.0, p.y);
      visual.group.rotation.y = -p.angle;

      // Special animation per kind
      if (p.type === 'mine') {
        visual.group.position.y = 1.5; // ground caltrop
        // Blinking red beacon
        const blink = Math.sin(time * 16) > 0.0 ? 1.0 : 0.15;
        this.caltropBeaconMat.color.setRGB(blink, 0, blink * 0.1);
      } else if (p.type === 'rocket') {
        // Rocket exhaust flicker
        const flame = visual.group.getObjectByName('rocketFlame');
        if (flame) {
          const s = 0.8 + Math.random() * 0.5;
          flame.scale.set(s, s, s);
        }
      }
    }

    // Remove defunct projectiles
    for (const [id, visual] of this.visuals.entries()) {
      if (!activeIds.has(id)) {
        this.group.remove(visual.group);
        this.visuals.delete(id);
      }
    }
  }

  private createVisual(p: Projectile): ProjectileVisual {
    const group = new THREE.Group();

    if (p.type === 'rocket') {
      // Slender missile fuselage
      const body = new THREE.Mesh(this.rocketBodyGeo, this.rocketMat);
      group.add(body);

      // Tail fins
      const fins = new THREE.Mesh(this.rocketFinGeo, this.rocketMat);
      fins.position.set(-7, 0, 0);
      group.add(fins);

      // Fiery exhaust flame cone
      const flameGeo = new THREE.ConeGeometry(2.0, 7, 8);
      flameGeo.rotateZ(Math.PI / 2);
      const flame = new THREE.Mesh(flameGeo, this.rocketFlameMat);
      flame.name = 'rocketFlame';
      flame.position.set(-11, 0, 0);
      group.add(flame);
    } else if (p.type === 'rail_beam') {
      // High-intensity electric beam cylinder
      const beamLength = 40;
      const beamGeo = new THREE.CylinderGeometry(2.5, 2.5, beamLength, 8);
      beamGeo.rotateZ(Math.PI / 2);
      const beamMat = new THREE.MeshBasicMaterial({ color: 0x88ffff });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      group.add(beam);
    } else if (p.type === 'mine') {
      // 3D Caltrop Landmine with radiating spikes
      const body = new THREE.Mesh(this.caltropGeo, this.caltropMat);
      body.rotation.x = Math.PI / 4;
      body.rotation.z = Math.PI / 4;
      group.add(body);

      // Blinking red LED beacon on top
      const beaconGeo = new THREE.SphereGeometry(1.5, 8, 8);
      const beacon = new THREE.Mesh(beaconGeo, this.caltropBeaconMat);
      beacon.position.set(0, 3.2, 0);
      group.add(beacon);
    } else if (p.type === 'emp_cloud') {
      // Expanding electric sphere
      const sphereGeo = new THREE.SphereGeometry(p.cloudRadius || 32, 16, 12);
      const sphereMat = new THREE.MeshBasicMaterial({
        color: 0x0088ff,
        transparent: true,
        opacity: 0.35,
        wireframe: true,
      });
      const cloud = new THREE.Mesh(sphereGeo, sphereMat);
      group.add(cloud);
    } else {
      // Default plasma bolt
      const bolt = new THREE.Mesh(this.plasmaGeo, this.plasmaMat);
      group.add(bolt);
    }

    return { group, type: p.type };
  }

  public dispose(): void {
    this.plasmaGeo.dispose();
    this.plasmaMat.dispose();
    this.rocketBodyGeo.dispose();
    this.rocketFinGeo.dispose();
    this.rocketMat.dispose();
    this.rocketFlameMat.dispose();
    this.caltropGeo.dispose();
    this.caltropMat.dispose();
    this.caltropBeaconMat.dispose();

    for (const visual of this.visuals.values()) {
      this.group.remove(visual.group);
    }
    this.visuals.clear();
  }
}

// ============================================================================
// TOP-LEVEL CAR MODEL MANAGER
// ============================================================================

export class CarModelManager {
  public group: THREE.Group = new THREE.Group();
  public skidmarks: SkidmarkSystem3D;
  public projectiles: ProjectileSystem3D;

  private carModels: Map<string, Car3DModel> = new Map();

  constructor() {
    this.skidmarks = new SkidmarkSystem3D();
    this.projectiles = new ProjectileSystem3D();

    this.group.add(this.skidmarks.mesh);
    this.group.add(this.projectiles.group);
  }

  public update(cars: CarState[], projectiles: Projectile[], dt: number, time: number): void {
    const activeCarIds = new Set<string>();

    for (const car of cars) {
      activeCarIds.add(car.id);
      let model = this.carModels.get(car.id);

      // Recreate model if archetype changed or newly spawned
      if (!model || model.archetype !== car.archetype) {
        if (model) {
          this.group.remove(model.group);
          model.dispose();
        }
        model = new Car3DModel(car.archetype);
        this.carModels.set(car.id, model);
        this.group.add(model.group);
      }

      model.update(car, dt, time);
    }

    // Remove despawned cars
    for (const [id, model] of this.carModels.entries()) {
      if (!activeCarIds.has(id)) {
        this.group.remove(model.group);
        model.dispose();
        this.carModels.delete(id);
      }
    }

    // Update persistent tire skidmarks
    this.skidmarks.update(cars, this.carModels, dt);

    // Update projectiles
    this.projectiles.update(projectiles, dt, time);
  }

  public dispose(): void {
    for (const model of this.carModels.values()) {
      this.group.remove(model.group);
      model.dispose();
    }
    this.carModels.clear();

    this.skidmarks.dispose();
    this.projectiles.dispose();
  }
}
