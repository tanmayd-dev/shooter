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

  // Emergency Police LED Strobes (Titan Spec)
  private titanStrobeLeds?: {
    red: THREE.MeshBasicMaterial;
    blue: THREE.MeshBasicMaterial;
  };

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
      case 'apex':
        this.buildApexSpec();
        break;
      case 'titan':
        this.buildTitanSpec();
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
      roughness: 0.2,
      metalness: 0.85,
    });
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x14161f,
      roughness: 0.55,
      metalness: 0.6,
    });
    const neonCyan = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x081520,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.85,
    });
    const helmetMat = new THREE.MeshStandardMaterial({
      color: 0xf5f8fc,
      roughness: 0.25,
      metalness: 0.4,
    });
    const helmetVisorMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const rainLightMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });

    // 1. Sleek Arrow Aerodynamic Monocoque Tub (Center survival cell & dorsal shark fin)
    const tubGeo = new THREE.BoxGeometry(28, 5.2, 11);
    const tubMesh = new THREE.Mesh(tubGeo, primaryMat);
    tubMesh.position.set(-2, 4.8, 0);
    this.group.add(tubMesh);

    // Front chassis tapered bridge
    const frontBridgeGeo = new THREE.BoxGeometry(10, 4.4, 8);
    const frontBridge = new THREE.Mesh(frontBridgeGeo, primaryMat);
    frontBridge.position.set(13, 4.4, 0);
    this.group.add(frontBridge);

    // Aerodynamic dorsal shark fin along engine cover
    const finGeo = new THREE.BoxGeometry(15, 4.2, 0.7);
    const finMesh = new THREE.Mesh(finGeo, primaryMat);
    finMesh.position.set(-7, 8.5, 0);
    this.group.add(finMesh);

    const finTrimGeo = new THREE.BoxGeometry(15, 0.4, 0.8);
    const finTrimMesh = new THREE.Mesh(finTrimGeo, neonCyan);
    finTrimMesh.position.set(-7, 10.6, 0);
    this.group.add(finTrimMesh);

    // 2. Tapered Aerodynamic Nose Cone (Multi-sided ConeGeometry with 14 segments)
    const noseGeo = new THREE.ConeGeometry(4.2, 17, 14);
    noseGeo.rotateZ(-Math.PI / 2);
    const noseMesh = new THREE.Mesh(noseGeo, primaryMat);
    noseMesh.position.set(22.5, 3.8, 0);
    noseMesh.scale.set(1.0, 0.65, 0.85);
    this.group.add(noseMesh);

    // Nose tip aerodynamic camera sensor fin
    const noseFinGeo = new THREE.BoxGeometry(3.5, 1.2, 0.5);
    const noseFin = new THREE.Mesh(noseFinGeo, carbonMat);
    noseFin.position.set(30, 4.2, 0);
    this.group.add(noseFin);

    // 3. Low-slung Front Double-Wing Splitter with Angled Endplates & Neon Cyan Edge Strips
    const lowerSplitterGeo = new THREE.BoxGeometry(8, 0.9, 28);
    const lowerSplitter = new THREE.Mesh(lowerSplitterGeo, carbonMat);
    lowerSplitter.position.set(24, 1.8, 0);
    this.group.add(lowerSplitter);

    const upperSplitterGeo = new THREE.BoxGeometry(5.5, 0.7, 25);
    const upperSplitter = new THREE.Mesh(upperSplitterGeo, primaryMat);
    upperSplitter.position.set(22, 3.2, 0);
    this.group.add(upperSplitter);

    // Splitter Vertical Endplates & Neon Cyan Edge
    for (const z of [-14, 14]) {
      const endplateGeo = new THREE.BoxGeometry(9.5, 4.2, 0.8);
      const endplate = new THREE.Mesh(endplateGeo, carbonMat);
      endplate.position.set(23, 3.4, z);
      this.group.add(endplate);

      const neonStripGeo = new THREE.BoxGeometry(9.5, 0.5, 0.9);
      const neonStrip = new THREE.Mesh(neonStripGeo, neonCyan);
      neonStrip.position.set(23, 5.5, z);
      this.group.add(neonStrip);
    }

    // 4. Exposed Front Suspension Wishbone Struts (A-arms)
    for (const z of [-1, 1]) {
      // Upper A-Arm front strut
      const upperStrutGeo = new THREE.CylinderGeometry(0.35, 0.35, 8.5, 6);
      upperStrutGeo.rotateZ(Math.PI / 2);
      const upperStrut = new THREE.Mesh(upperStrutGeo, carbonMat);
      upperStrut.position.set(13.5, 4.8, z * 7.5);
      upperStrut.rotation.y = z * 0.45;
      this.group.add(upperStrut);

      // Lower wishbone strut
      const lowerStrutGeo = new THREE.CylinderGeometry(0.35, 0.35, 9.0, 6);
      lowerStrutGeo.rotateZ(Math.PI / 2);
      const lowerStrut = new THREE.Mesh(lowerStrutGeo, carbonMat);
      lowerStrut.position.set(13.5, 2.6, z * 7.5);
      lowerStrut.rotation.y = z * 0.45;
      this.group.add(lowerStrut);
    }

    // 5. Cockpit Opening, Aerodynamic Visor/Windscreen, Safety Halo Hoop & Detailed Pilot Helmet
    const cockpitRecessGeo = new THREE.BoxGeometry(11, 2.2, 7.5);
    const cockpitRecess = new THREE.Mesh(cockpitRecessGeo, carbonMat);
    cockpitRecess.position.set(0, 7.0, 0);
    this.group.add(cockpitRecess);

    // Aerodynamic tinted visor/windscreen
    const visorGeo = new THREE.BoxGeometry(3.0, 1.8, 6.8);
    const visorMesh = new THREE.Mesh(visorGeo, visorMat);
    visorMesh.position.set(4.8, 7.8, 0);
    visorMesh.rotation.z = -0.4;
    this.group.add(visorMesh);

    // Detailed Pilot Helmet
    const helmetGeo = new THREE.SphereGeometry(2.1, 16, 12);
    const helmetMesh = new THREE.Mesh(helmetGeo, helmetMat);
    helmetMesh.position.set(-0.5, 8.2, 0);
    this.group.add(helmetMesh);

    const helmetVisorGeo = new THREE.BoxGeometry(1.6, 0.9, 2.6);
    const helmetVisorMesh = new THREE.Mesh(helmetVisorGeo, helmetVisorMat);
    helmetVisorMesh.position.set(0.8, 8.3, 0);
    this.group.add(helmetVisorMesh);

    // Holographic HUD instrument readout
    const hudGeo = new THREE.BoxGeometry(1.2, 1.6, 4.0);
    const hudMesh = new THREE.Mesh(hudGeo, neonCyan);
    hudMesh.position.set(4.0, 7.2, 0);
    this.group.add(hudMesh);

    // Titanium Safety Halo Hoop & central pillar
    const haloGeo = new THREE.TorusGeometry(3.6, 0.65, 8, 16, Math.PI);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMesh = new THREE.Mesh(haloGeo, carbonMat);
    haloMesh.position.set(-1, 9.4, 0);
    this.group.add(haloMesh);

    const haloPillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 3.4, 8);
    const haloPillar = new THREE.Mesh(haloPillarGeo, carbonMat);
    haloPillar.position.set(2.4, 9.0, 0);
    this.group.add(haloPillar);

    // 6. Sidepod Air Intakes with Sculpted Radiator Vents
    for (const z of [-8.6, 8.6]) {
      const podGeo = new THREE.BoxGeometry(19, 5.2, 5.2);
      const podMesh = new THREE.Mesh(podGeo, primaryMat);
      podMesh.position.set(-3, 4.6, z);
      this.group.add(podMesh);

      // Radiator intake mouth (dark recessed intake)
      const intakeGeo = new THREE.BoxGeometry(1.2, 4.2, 4.2);
      const intakeMesh = new THREE.Mesh(intakeGeo, carbonMat);
      intakeMesh.position.set(6.6, 4.6, z);
      this.group.add(intakeMesh);

      // Louvered cooling vents on top of sidepod
      const ventGeo = new THREE.BoxGeometry(8, 0.5, 3.6);
      const ventMesh = new THREE.Mesh(ventGeo, carbonMat);
      ventMesh.position.set(-1, 7.3, z);
      this.group.add(ventMesh);

      // Turning vane / bargeboard
      const vaneGeo = new THREE.BoxGeometry(1.0, 4.8, 1.5);
      const vaneMesh = new THREE.Mesh(vaneGeo, carbonMat);
      vaneMesh.position.set(7.5, 4.2, z > 0 ? 11.6 : -11.6);
      this.group.add(vaneMesh);
    }

    // 7. High Elevated Dual-Deck Rear Wing with Endplates & Rear LED Rain Light
    const wingPillarGeo = new THREE.BoxGeometry(2, 8, 1.2);
    for (const z of [-4, 4]) {
      const pillar = new THREE.Mesh(wingPillarGeo, carbonMat);
      pillar.position.set(-17.5, 9, z);
      this.group.add(pillar);
    }

    // Lower deck wing
    const lowerWingGeo = new THREE.BoxGeometry(7, 1.1, 26);
    const lowerWing = new THREE.Mesh(lowerWingGeo, carbonMat);
    lowerWing.position.set(-17, 11.4, 0);
    this.group.add(lowerWing);

    // Upper deck wing
    const upperWingGeo = new THREE.BoxGeometry(6, 1.1, 28);
    const upperWing = new THREE.Mesh(upperWingGeo, primaryMat);
    upperWing.position.set(-18, 13.8, 0);
    this.group.add(upperWing);

    // Rear wing vertical endplates with neon cyan edge
    for (const z of [-14, 14]) {
      const wingEndGeo = new THREE.BoxGeometry(9.5, 6.2, 0.8);
      const wingEnd = new THREE.Mesh(wingEndGeo, carbonMat);
      wingEnd.position.set(-17.5, 12.6, z);
      this.group.add(wingEnd);

      const wingNeonGeo = new THREE.BoxGeometry(9.5, 0.6, 0.9);
      const wingNeon = new THREE.Mesh(wingNeonGeo, neonCyan);
      wingNeon.position.set(-17.5, 15.7, z);
      this.group.add(wingNeon);
    }

    // Rear LED Rain Light (F1 style hazard flasher)
    const rainLightGeo = new THREE.BoxGeometry(1.2, 1.4, 2.2);
    const rainLight = new THREE.Mesh(rainLightGeo, rainLightMat);
    rainLight.position.set(-20.5, 3.5, 0);
    this.group.add(rainLight);

    // 8. Wheels & Suspension with Cyan Glowing Rims & Brake Discs
    this.setupWheels({
      frontX: 14,
      rearX: -14,
      widthZ: 13,
      radius: 4.8,
      thickness: 3.2,
      rimColor: 0x00f0ff,
      openWheel: true,
      hasBrakeDiscs: true,
    });
  }

  // ==========================================================================
  // ARCHETYPE 2: DESERT SPEC (Muscle Car Heavy Brawler)
  // ==========================================================================
  private buildDesertSpec(): void {
    const muscleOrangeMat = new THREE.MeshStandardMaterial({
      color: 0xff5500, // Desert Muscle Orange
      roughness: 0.32,
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
    const steelBarMat = new THREE.MeshStandardMaterial({
      color: 0x242832,
      roughness: 0.45,
      metalness: 0.85,
    });

    // 1. Aggressive Low Wide-Body Muscle Silhouette (Main chassis & sloped hood)
    const bodyGeo = new THREE.BoxGeometry(46, 7.2, 20.5);
    const bodyMesh = new THREE.Mesh(bodyGeo, muscleOrangeMat);
    bodyMesh.position.set(0, 5.0, 0);
    this.group.add(bodyMesh);

    // Sloped aerodynamic hood wedge
    const hoodGeo = new THREE.BoxGeometry(18, 1.8, 19.5);
    const hoodMesh = new THREE.Mesh(hoodGeo, muscleOrangeMat);
    hoodMesh.position.set(13, 8.2, 0);
    hoodMesh.rotation.z = -0.05; // slight forward rake
    this.group.add(hoodMesh);

    // Front recessed dark radiator grille
    const grilleGeo = new THREE.BoxGeometry(2.0, 5.0, 19.0);
    const grilleMesh = new THREE.Mesh(grilleGeo, darkChassisMat);
    grilleMesh.position.set(23.2, 5.2, 0);
    this.group.add(grilleMesh);

    // Flared Muscular Wheel Arches hugging wide drag slicks
    for (const x of [-13, 13]) {
      for (const z of [-11.5, 11.5]) {
        const archGeo = new THREE.BoxGeometry(12, 6.5, 2.8);
        const archMesh = new THREE.Mesh(archGeo, muscleOrangeMat);
        archMesh.position.set(x, 5.8, z);
        this.group.add(archMesh);
      }
    }

    // 2. Cabin with Raked Windscreen & Fastback Rear
    // Dark glass cabin house
    const cabinGeo = new THREE.BoxGeometry(21, 5.8, 16.5);
    const cabinMesh = new THREE.Mesh(cabinGeo, darkChassisMat);
    cabinMesh.position.set(-4, 10.6, 0);
    this.group.add(cabinMesh);

    // Sloped windscreen
    const windscreenGeo = new THREE.BoxGeometry(5.0, 5.2, 16.0);
    const windscreenMesh = new THREE.Mesh(windscreenGeo, darkChassisMat);
    windscreenMesh.position.set(6.8, 9.6, 0);
    windscreenMesh.rotation.z = -0.55;
    this.group.add(windscreenMesh);

    // Fastback roof plate
    const roofGeo = new THREE.BoxGeometry(20, 1.2, 16.0);
    const roofMesh = new THREE.Mesh(roofGeo, muscleOrangeMat);
    roofMesh.position.set(-4, 13.8, 0);
    this.group.add(roofMesh);

    // Fastback sloping rear window / deck
    const fastbackSlopeGeo = new THREE.BoxGeometry(7.0, 4.5, 15.8);
    const fastbackSlope = new THREE.Mesh(fastbackSlopeGeo, darkChassisMat);
    fastbackSlope.position.set(-14.2, 10.4, 0);
    fastbackSlope.rotation.z = 0.52;
    this.group.add(fastbackSlope);

    // Rear trunk ducktail spoiler
    const spoilerGeo = new THREE.BoxGeometry(3.5, 2.0, 19.5);
    const spoilerMesh = new THREE.Mesh(spoilerGeo, darkChassisMat);
    spoilerMesh.position.set(-21.5, 8.8, 0);
    spoilerMesh.rotation.z = 0.25;
    this.group.add(spoilerMesh);

    // 3. Dual Longitudinal White Racing Stripes (running along hood and roof)
    for (const z of [-2.6, 2.6]) {
      // Hood stripe
      const hoodStripeGeo = new THREE.BoxGeometry(19, 0.4, 2.0);
      const hoodStripe = new THREE.Mesh(hoodStripeGeo, stripeMat);
      hoodStripe.position.set(13.2, 9.2, z);
      hoodStripe.rotation.z = -0.05;
      this.group.add(hoodStripe);

      // Roof stripe
      const roofStripeGeo = new THREE.BoxGeometry(20, 0.4, 2.0);
      const roofStripe = new THREE.Mesh(roofStripeGeo, stripeMat);
      roofStripe.position.set(-4, 14.5, z);
      this.group.add(roofStripe);

      // Rear deck stripe
      const rearStripeGeo = new THREE.BoxGeometry(6, 0.4, 2.0);
      const rearStripe = new THREE.Mesh(rearStripeGeo, stripeMat);
      rearStripe.position.set(-19.5, 8.8, z);
      this.group.add(rearStripe);
    }

    // 4. Exposed Sculpted Hood Supercharger Scoop with Chrome Blower & Butterfly Valves
    const scoopBaseGeo = new THREE.BoxGeometry(9.5, 3.8, 8.5);
    const scoopBase = new THREE.Mesh(scoopBaseGeo, chromeMat);
    scoopBase.position.set(9, 10.5, 0);
    this.group.add(scoopBase);

    // Front intake snout with 3 red butterfly valves
    const intakeSnoutGeo = new THREE.BoxGeometry(3.0, 3.2, 7.8);
    const intakeSnout = new THREE.Mesh(intakeSnoutGeo, chromeMat);
    intakeSnout.position.set(14.2, 10.5, 0);
    this.group.add(intakeSnout);

    // Supercharger drive pulley wheel
    const pulleyGeo = new THREE.CylinderGeometry(1.6, 1.6, 1.2, 12);
    pulleyGeo.rotateZ(Math.PI / 2);
    const pulley = new THREE.Mesh(pulleyGeo, chromeMat);
    pulley.position.set(15.2, 8.6, 0);
    this.group.add(pulley);

    for (let i = -1; i <= 1; i++) {
      const valveGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.4, 12);
      valveGeo.rotateZ(Math.PI / 2);
      const valveMesh = new THREE.Mesh(valveGeo, butterflyValveMat);
      valveMesh.position.set(15.6, 10.5, i * 2.2);
      this.group.add(valveMesh);
      this.butterflyValves.push(valveMesh);
    }

    // 5. Heavy Front Steel Ramming Bull-Bar & Rear Diffuser
    // Main push bumper
    const bullBarGeo = new THREE.BoxGeometry(3.5, 6.5, 22.5);
    const bullBar = new THREE.Mesh(bullBarGeo, steelBarMat);
    bullBar.position.set(24.0, 5.0, 0);
    this.group.add(bullBar);

    // Push bar vertical teeth
    for (const z of [-6.5, 6.5]) {
      const toothGeo = new THREE.BoxGeometry(4.0, 8.0, 2.2);
      const tooth = new THREE.Mesh(toothGeo, steelBarMat);
      tooth.position.set(24.2, 5.6, z);
      this.group.add(tooth);
    }

    // Rear Aerodynamic Diffuser
    const diffuserGeo = new THREE.BoxGeometry(6.0, 2.2, 20.0);
    const diffuser = new THREE.Mesh(diffuserGeo, darkChassisMat);
    diffuser.position.set(-22.8, 2.4, 0);
    diffuser.rotation.z = -0.15;
    this.group.add(diffuser);

    for (const z of [-6, -2, 2, 6]) {
      const finGeo = new THREE.BoxGeometry(5.0, 2.0, 0.6);
      const fin = new THREE.Mesh(finGeo, darkChassisMat);
      fin.position.set(-23.0, 2.2, z);
      this.group.add(fin);
    }

    // 6. Side-Exit Dual Chrome Exhausts with Flame Bursts
    const exhaustMat = chromeMat;
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff7700,
      transparent: true,
      opacity: 0.85,
    });

    for (const z of [-11.8, 11.8]) {
      const pipeGeo = new THREE.CylinderGeometry(1.3, 1.3, 6.5, 8);
      pipeGeo.rotateX(Math.PI / 2);
      const pipeMesh = new THREE.Mesh(pipeGeo, exhaustMat);
      pipeMesh.position.set(-6, 3.0, z);
      this.group.add(pipeMesh);

      // Flame burst mesh (cone extending outward)
      const flameGeo = new THREE.ConeGeometry(1.8, 7.5, 6);
      flameGeo.rotateX(z > 0 ? Math.PI / 2 : -Math.PI / 2);
      const flameMesh = new THREE.Mesh(flameGeo, flameMat);
      flameMesh.position.set(-6, 3.0, z + (z > 0 ? 4.5 : -4.5));
      flameMesh.visible = false;
      this.group.add(flameMesh);
      this.exhaustFlames.push(flameMesh);
    }

    // 7. Chunky Wide Racing Wheels with Wide Drag Slicks & Deep-Dish Orange Rims
    this.setupWheels({
      frontX: 13,
      rearX: -13,
      widthZ: 12.5,
      radius: 5.4,
      thickness: 4.2,
      rearThickness: 5.4, // Wide rear drag slicks
      rimColor: 0xff5500,
      deepDish: true,
      hasBrakeDiscs: true,
    });
  }

  // ==========================================================================
  // ARCHETYPE 3: RALLY SPEC (Compact Hot-Hatch Agile Skirmisher)
  // ==========================================================================
  private buildRallySpec(): void {
    const rallyGreenMat = new THREE.MeshStandardMaterial({
      color: 0x33e600, // Electric Rally Lime
      roughness: 0.28,
      metalness: 0.7,
    });
    const darkTrimMat = new THREE.MeshStandardMaterial({
      color: 0x161822,
      roughness: 0.6,
      metalness: 0.4,
    });
    const neonLimeMat = new THREE.MeshBasicMaterial({
      color: 0x39ff14, // Piercing Lime Neon Decal
    });
    const fogLightLensMat = new THREE.MeshBasicMaterial({
      color: 0xfff488, // Warm yellow fog lamps
    });
    const mudflapMat = new THREE.MeshStandardMaterial({
      color: 0x0f1118,
      roughness: 0.95,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe8ecf2,
      roughness: 0.18,
      metalness: 0.9,
    });

    // 1. Compact Aerodynamic Hot-Hatch Chassis (Wide stance)
    const bodyGeo = new THREE.BoxGeometry(41, 7.2, 18.5);
    const bodyMesh = new THREE.Mesh(bodyGeo, rallyGreenMat);
    bodyMesh.position.set(0, 5.0, 0);
    this.group.add(bodyMesh);

    // Sloped aerodynamic hood
    const hoodGeo = new THREE.BoxGeometry(15, 1.6, 17.5);
    const hoodMesh = new THREE.Mesh(hoodGeo, rallyGreenMat);
    hoodMesh.position.set(12.5, 7.8, 0);
    hoodMesh.rotation.z = -0.08;
    this.group.add(hoodMesh);

    // Front rally sump skid-plate
    const skidPlateGeo = new THREE.BoxGeometry(8, 1.2, 16);
    const skidPlate = new THREE.Mesh(skidPlateGeo, darkTrimMat);
    skidPlate.position.set(20.5, 2.0, 0);
    skidPlate.rotation.z = -0.25;
    this.group.add(skidPlate);

    // Flared Boxy Rally Wheel Arches (Group B / WRC Blister Fenders)
    for (const x of [-12, 12]) {
      for (const z of [-10.5, 10.5]) {
        const archGeo = new THREE.BoxGeometry(11.5, 6.2, 2.6);
        const archMesh = new THREE.Mesh(archGeo, rallyGreenMat);
        archMesh.position.set(x, 5.6, z);
        this.group.add(archMesh);
      }
    }

    // 2. Rally Hatchback Cabin with Forward-Raked Roof
    const cabinGeo = new THREE.BoxGeometry(22, 6.2, 15.2);
    const cabinMesh = new THREE.Mesh(cabinGeo, darkTrimMat);
    cabinMesh.position.set(-2.5, 10.4, 0);
    this.group.add(cabinMesh);

    // Sloped rally windscreen
    const windscreenGeo = new THREE.BoxGeometry(5.2, 5.6, 14.8);
    const windscreenMesh = new THREE.Mesh(windscreenGeo, darkTrimMat);
    windscreenMesh.position.set(8.5, 9.8, 0);
    windscreenMesh.rotation.z = -0.48;
    this.group.add(windscreenMesh);

    // Forward-raked roof plate
    const roofGeo = new THREE.BoxGeometry(20, 1.1, 14.8);
    const roofMesh = new THREE.Mesh(roofGeo, rallyGreenMat);
    roofMesh.position.set(-2.5, 13.6, 0);
    roofMesh.rotation.z = 0.03; // forward rake
    this.group.add(roofMesh);

    // Lime Neon Side-skirt Decal Strips
    for (const z of [-9.4, 9.4]) {
      const skirtDecalGeo = new THREE.BoxGeometry(34, 0.6, 0.4);
      const skirtDecal = new THREE.Mesh(skirtDecalGeo, neonLimeMat);
      skirtDecal.position.set(0, 2.2, z);
      this.group.add(skirtDecal);
    }

    // 3. Sculpted Roof Air-Intake Scoop
    const scoopGeo = new THREE.BoxGeometry(6.5, 2.2, 5.0);
    const scoopMesh = new THREE.Mesh(scoopGeo, darkTrimMat);
    scoopMesh.position.set(3.5, 14.8, 0);
    this.group.add(scoopMesh);

    // Dual front intake nostrils on roof scoop
    const nostrilGeo = new THREE.BoxGeometry(0.8, 1.4, 3.8);
    const nostrilMesh = new THREE.Mesh(nostrilGeo, neonLimeMat);
    nostrilMesh.position.set(6.8, 14.8, 0);
    this.group.add(nostrilMesh);

    // 4. Front Bumper Quad Circular Yellow Rally Fog Light Pods
    const podX = 21.0;
    const fogPositions = [-6.6, -2.2, 2.2, 6.6];
    for (const z of fogPositions) {
      // Pod housing
      const housingGeo = new THREE.CylinderGeometry(1.6, 1.8, 2.2, 14);
      housingGeo.rotateZ(Math.PI / 2);
      const housing = new THREE.Mesh(housingGeo, darkTrimMat);
      housing.position.set(podX, 6.2, z);
      this.group.add(housing);

      // Glowing circular yellow lens
      const lensGeo = new THREE.CircleGeometry(1.4, 14);
      lensGeo.rotateY(Math.PI / 2);
      const lens = new THREE.Mesh(lensGeo, fogLightLensMat);
      lens.position.set(podX + 1.15, 6.2, z);
      this.group.add(lens);
    }

    // 5. Elevated WRC Multi-Element Rear Rally Wing
    const wingPillarGeo = new THREE.BoxGeometry(1.8, 5.5, 1.0);
    for (const z of [-4.5, 4.5]) {
      const pillar = new THREE.Mesh(wingPillarGeo, darkTrimMat);
      pillar.position.set(-14, 14.6, z);
      this.group.add(pillar);
    }

    const wingGeo = new THREE.BoxGeometry(6.5, 1.2, 20.5);
    const wingMesh = new THREE.Mesh(wingGeo, rallyGreenMat);
    wingMesh.position.set(-15.2, 16.5, 0);
    wingMesh.rotation.z = -0.1;
    this.group.add(wingMesh);

    // Rear wing endplates with lime neon highlights
    for (const z of [-10.4, 10.4]) {
      const endplateGeo = new THREE.BoxGeometry(7.5, 4.5, 0.6);
      const endplate = new THREE.Mesh(endplateGeo, darkTrimMat);
      endplate.position.set(-15.2, 16.5, z);
      this.group.add(endplate);

      const neonEndGeo = new THREE.BoxGeometry(7.5, 0.4, 0.7);
      const neonEnd = new THREE.Mesh(neonEndGeo, neonLimeMat);
      neonEnd.position.set(-15.2, 18.8, z);
      this.group.add(neonEnd);
    }

    // 6. Mudflaps Behind All Four Wheels
    for (const x of [-17.5, 6.8]) {
      for (const z of [-9.8, 9.8]) {
        const flapGeo = new THREE.BoxGeometry(0.6, 4.0, 3.6);
        const flapMesh = new THREE.Mesh(flapGeo, mudflapMat);
        flapMesh.position.set(x, 2.4, z);
        this.group.add(flapMesh);
      }
    }

    // 7. Dual Rear Chrome Exhaust Pipes
    for (const z of [-4.5, 4.5]) {
      const exhaustGeo = new THREE.CylinderGeometry(1.0, 1.0, 4.0, 8);
      exhaustGeo.rotateZ(Math.PI / 2);
      const exhaustMesh = new THREE.Mesh(exhaustGeo, chromeMat);
      exhaustMesh.position.set(-21.5, 3.2, z);
      this.group.add(exhaustMesh);
    }

    // 8. High-Traction Wheels with White/Lime Multi-Spoke Alloy Rims & Brake Discs
    this.setupWheels({
      frontX: 12,
      rearX: -12,
      widthZ: 10.5,
      radius: 4.6,
      thickness: 3.2,
      rimColor: 0xf5f8fc, // Crisp rally white OZ-style rim
      rallySpokes: true,
      hasBrakeDiscs: true,
    });
  }

  // ==========================================================================
  // ARCHETYPE 4: APEX SPEC (Aero-GT Hypercar Precision Acrobat)
  // ==========================================================================
  private buildApexSpec(): void {
    const primaryMat = new THREE.MeshStandardMaterial({
      color: 0xd000ff, // Neon Violet / Magenta
      roughness: 0.22,
      metalness: 0.82,
    });
    const carbonMat = new THREE.MeshStandardMaterial({
      color: 0x14151e, // Dark carbon trim
      roughness: 0.5,
      metalness: 0.6,
    });
    const neonMagentaMat = new THREE.MeshBasicMaterial({ color: 0xd000ff });
    const glowingVisorMat = new THREE.MeshBasicMaterial({ color: 0xff00ff }); // Magenta glowing visor
    const plasmaGlowMat = new THREE.MeshBasicMaterial({ color: 0xd000ff }); // Violet plasma
    const cockpitGlassMat = new THREE.MeshStandardMaterial({
      color: 0x1a0526,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity: 0.85,
    });

    // 1. Sleek futuristic Aero-GT hypercar silhouette & monocoque chassis
    const bodyGeo = new THREE.BoxGeometry(34, 5.0, 14);
    const bodyMesh = new THREE.Mesh(bodyGeo, primaryMat);
    bodyMesh.position.set(-1, 4.6, 0);
    this.group.add(bodyMesh);

    // Carbon fiber aerodynamic undertray & front splitter
    const splitterGeo = new THREE.BoxGeometry(10, 0.8, 22);
    const splitterMesh = new THREE.Mesh(splitterGeo, carbonMat);
    splitterMesh.position.set(21, 1.8, 0);
    this.group.add(splitterMesh);

    // Front splitter endplates with glowing magenta edge strips
    for (const z of [-11, 11]) {
      const spEndGeo = new THREE.BoxGeometry(8, 3.2, 0.6);
      const spEnd = new THREE.Mesh(spEndGeo, carbonMat);
      spEnd.position.set(21, 3.2, z);
      this.group.add(spEnd);

      const spNeonGeo = new THREE.BoxGeometry(8, 0.4, 0.7);
      const spNeon = new THREE.Mesh(spNeonGeo, neonMagentaMat);
      spNeon.position.set(21, 4.8, z);
      this.group.add(spNeon);
    }

    // Tapered aerodynamic nose cone
    const noseGeo = new THREE.ConeGeometry(5.0, 17, 14);
    noseGeo.rotateZ(-Math.PI / 2);
    const noseMesh = new THREE.Mesh(noseGeo, primaryMat);
    noseMesh.position.set(21.5, 4.0, 0);
    noseMesh.scale.set(1.0, 0.6, 0.85);
    this.group.add(noseMesh);

    // 2. Tapered aerodynamic canopy cockpit with magenta glowing visor
    const canopyGeo = new THREE.BoxGeometry(18, 3.8, 9.2);
    const canopyMesh = new THREE.Mesh(canopyGeo, cockpitGlassMat);
    canopyMesh.position.set(-1, 7.2, 0);
    this.group.add(canopyMesh);

    const roofSpineGeo = new THREE.BoxGeometry(16, 0.6, 3.0);
    const roofSpine = new THREE.Mesh(roofSpineGeo, carbonMat);
    roofSpine.position.set(-1, 9.2, 0);
    this.group.add(roofSpine);

    const visorGeo = new THREE.BoxGeometry(5.2, 1.8, 8.4);
    const visorMesh = new THREE.Mesh(visorGeo, glowingVisorMat);
    visorMesh.position.set(5.2, 7.4, 0);
    visorMesh.rotation.z = -0.32;
    this.group.add(visorMesh);

    // 3. Swept-back active aero winglets on both sides
    for (const z of [-10.5, 10.5]) {
      const wingletGeo = new THREE.BoxGeometry(14, 0.8, 4.8);
      const winglet = new THREE.Mesh(wingletGeo, carbonMat);
      winglet.position.set(-2, 5.4, z);
      winglet.rotation.y = (z > 0 ? -1 : 1) * 0.28;
      this.group.add(winglet);

      const edgeGeo = new THREE.BoxGeometry(14, 0.5, 0.7);
      const edge = new THREE.Mesh(edgeGeo, neonMagentaMat);
      edge.position.set(-2, 5.6, z > 0 ? z + 2.4 : z - 2.4);
      edge.rotation.y = (z > 0 ? -1 : 1) * 0.28;
      this.group.add(edge);

      const tipFinGeo = new THREE.BoxGeometry(7, 3.0, 0.6);
      const tipFin = new THREE.Mesh(tipFinGeo, primaryMat);
      tipFin.position.set(-4, 6.4, z > 0 ? z + 2.4 : z - 2.4);
      this.group.add(tipFin);
    }

    // 4. Rear dual jet turbine exhaust nozzles (cylinders with glowing violet plasma)
    for (const z of [-4.5, 4.5]) {
      const turbineGeo = new THREE.CylinderGeometry(2.2, 2.5, 7.0, 16);
      turbineGeo.rotateZ(Math.PI / 2);
      const turbine = new THREE.Mesh(turbineGeo, carbonMat);
      turbine.position.set(-18, 4.8, z);
      this.group.add(turbine);

      const plasmaGeo = new THREE.CylinderGeometry(1.7, 1.7, 1.2, 16);
      plasmaGeo.rotateZ(Math.PI / 2);
      const plasmaCore = new THREE.Mesh(plasmaGeo, plasmaGlowMat);
      plasmaCore.position.set(-21.6, 4.8, z);
      this.group.add(plasmaCore);

      const flameGeo = new THREE.ConeGeometry(1.6, 6.0, 8);
      flameGeo.rotateZ(Math.PI / 2);
      const flame = new THREE.Mesh(flameGeo, plasmaGlowMat);
      flame.position.set(-24.5, 4.8, z);
      flame.visible = false;
      this.group.add(flame);
      this.exhaustFlames.push(flame);
    }

    // Rear high-downforce GT aero wing
    for (const z of [-4.5, 4.5]) {
      const wingPillarGeo = new THREE.BoxGeometry(1.8, 5.5, 0.8);
      const pillar = new THREE.Mesh(wingPillarGeo, carbonMat);
      pillar.position.set(-15, 8.2, z);
      this.group.add(pillar);
    }

    const wingGeo = new THREE.BoxGeometry(5.8, 0.9, 24);
    const wingMesh = new THREE.Mesh(wingGeo, primaryMat);
    wingMesh.position.set(-16, 11.0, 0);
    this.group.add(wingMesh);

    for (const z of [-12, 12]) {
      const endplateGeo = new THREE.BoxGeometry(7.5, 3.8, 0.6);
      const endplate = new THREE.Mesh(endplateGeo, carbonMat);
      endplate.position.set(-16, 11.2, z);
      this.group.add(endplate);
    }

    // 5. Low-profile racing wheels with glowing magenta rim edges
    this.setupWheels({
      frontX: 13,
      rearX: -13,
      widthZ: 11.5,
      radius: 4.6,
      thickness: 3.2,
      rimColor: 0xd000ff,
      hasBrakeDiscs: true,
    });
  }

  // ==========================================================================
  // ARCHETYPE 5: TITAN SPEC (Heavy Tactical Police Interceptor Cruiser)
  // ==========================================================================
  private buildTitanSpec(): void {
    const primaryMat = new THREE.MeshStandardMaterial({
      color: 0x0044cc, // Tactical Cobalt Blue
      roughness: 0.35,
      metalness: 0.7,
    });
    const matteBlackMat = new THREE.MeshStandardMaterial({
      color: 0x12141a, // Reinforced matte black
      roughness: 0.8,
      metalness: 0.3,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x5a6375, // Heavy steel push bumper
      roughness: 0.4,
      metalness: 0.85,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0a121e,
      roughness: 0.15,
      metalness: 0.9,
      transparent: true,
      opacity: 0.8,
    });
    const lightbarHousingMat = new THREE.MeshStandardMaterial({
      color: 0x101218,
      roughness: 0.5,
      metalness: 0.5,
    });
    const redLedMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
    const blueLedMat = new THREE.MeshBasicMaterial({ color: 0x0066ff });

    // 1. Heavy tactical police interceptor / enforcer cruiser silhouette
    const bodyGeo = new THREE.BoxGeometry(43, 6.8, 19.5);
    const bodyMesh = new THREE.Mesh(bodyGeo, primaryMat);
    bodyMesh.position.set(0, 5.2, 0);
    this.group.add(bodyMesh);

    // Reinforced matte black side skirt & lower body armor
    const skirtGeo = new THREE.BoxGeometry(44, 2.2, 20.2);
    const skirtMesh = new THREE.Mesh(skirtGeo, matteBlackMat);
    skirtMesh.position.set(0, 2.4, 0);
    this.group.add(skirtMesh);

    // Heavy flared armored wheel wells
    for (const x of [-13.5, 13.5]) {
      for (const z of [-10.2, 10.2]) {
        const flareGeo = new THREE.BoxGeometry(11, 5.8, 2.2);
        const flare = new THREE.Mesh(flareGeo, matteBlackMat);
        flare.position.set(x, 5.6, z);
        this.group.add(flare);
      }
    }

    // 2. Cruiser cabin and armored windows
    const cabinGeo = new THREE.BoxGeometry(22, 5.0, 16.5);
    const cabinMesh = new THREE.Mesh(cabinGeo, primaryMat);
    cabinMesh.position.set(-3, 9.8, 0);
    this.group.add(cabinMesh);

    const windshieldGeo = new THREE.BoxGeometry(4.0, 4.4, 15.6);
    const windshield = new THREE.Mesh(windshieldGeo, glassMat);
    windshield.position.set(7.5, 9.5, 0);
    windshield.rotation.z = -0.32;
    this.group.add(windshield);

    const rearWinGeo = new THREE.BoxGeometry(3.5, 4.2, 15.6);
    const rearWin = new THREE.Mesh(rearWinGeo, glassMat);
    rearWin.position.set(-13.5, 9.5, 0);
    rearWin.rotation.z = 0.32;
    this.group.add(rearWin);

    // 3. Overhead emergency police LED strobe lightbar on roof (BoxGeometry(4, 1.5, 12))
    const barGeo = new THREE.BoxGeometry(4, 1.5, 12);
    const barMesh = new THREE.Mesh(barGeo, lightbarHousingMat);
    barMesh.position.set(-2, 12.8, 0);
    this.group.add(barMesh);

    const redLedGeo = new THREE.BoxGeometry(3.4, 1.2, 5.0);
    const redLedMesh = new THREE.Mesh(redLedGeo, redLedMat);
    redLedMesh.position.set(-2, 12.8, -2.8);
    this.group.add(redLedMesh);

    const blueLedGeo = new THREE.BoxGeometry(3.4, 1.2, 5.0);
    const blueLedMesh = new THREE.Mesh(blueLedGeo, blueLedMat);
    blueLedMesh.position.set(-2, 12.8, 2.8);
    this.group.add(blueLedMesh);

    this.titanStrobeLeds = { red: redLedMat, blue: blueLedMat };

    // 4. Heavy steel wrap-around push bumper / bull-bar on front grille
    const pushBarGeo = new THREE.BoxGeometry(3.5, 7.2, 18.5);
    const pushBar = new THREE.Mesh(pushBarGeo, steelMat);
    pushBar.position.set(23.2, 5.0, 0);
    this.group.add(pushBar);

    for (const z of [-9.2, 9.2]) {
      const wrapGeo = new THREE.BoxGeometry(7.5, 5.2, 2.0);
      const wrap = new THREE.Mesh(wrapGeo, steelMat);
      wrap.position.set(20.0, 5.0, z);
      this.group.add(wrap);
    }

    for (const z of [-4.2, 4.2]) {
      const padGeo = new THREE.BoxGeometry(2.0, 8.5, 2.2);
      const pad = new THREE.Mesh(padGeo, matteBlackMat);
      pad.position.set(24.8, 5.0, z);
      this.group.add(pad);
    }

    // 5. Rear reinforced matte black bumper
    const rearBumperGeo = new THREE.BoxGeometry(4.0, 5.5, 20.4);
    const rearBumper = new THREE.Mesh(rearBumperGeo, matteBlackMat);
    rearBumper.position.set(-21.8, 4.8, 0);
    this.group.add(rearBumper);

    // 6. Rugged armored wheels with reinforced steel hubs (rimColor: 0x0066ff)
    this.setupWheels({
      frontX: 14,
      rearX: -14,
      widthZ: 12.2,
      radius: 5.2,
      thickness: 4.0,
      rimColor: 0x0066ff,
      hasBrakeDiscs: true,
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
    rearThickness?: number;
    hasBrakeDiscs?: boolean;
    openWheel?: boolean;
    deepDish?: boolean;
    rallySpokes?: boolean;
  }): void {
    const tireMat = new THREE.MeshStandardMaterial({
      color: 0x11131a, // Dark rubber
      roughness: 0.9,
      metalness: 0.1,
    });
    const rimMat = new THREE.MeshStandardMaterial({
      color: config.rimColor,
      roughness: 0.32,
      metalness: 0.8,
    });
    const brakeDiscMat = new THREE.MeshStandardMaterial({
      color: 0x828b98,
      roughness: 0.35,
      metalness: 0.85,
    });
    const brakeCaliperMat = new THREE.MeshStandardMaterial({
      color: config.openWheel ? 0x00f0ff : (config.rimColor === 0xff5500 ? 0xff2200 : 0x33e600),
      roughness: 0.4,
      metalness: 0.6,
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

      const thickness = (!p.front && config.rearThickness) ? config.rearThickness : config.thickness;

      // Tire cylinder oriented with axle along Z
      const wheelGeo = new THREE.CylinderGeometry(config.radius, config.radius, thickness, 18);
      wheelGeo.rotateX(Math.PI / 2);
      const wheelMesh = new THREE.Mesh(wheelGeo, tireMat);

      // Detailed Rim Hubcap
      const rimRadius = config.radius * (config.openWheel ? 0.7 : (config.rallySpokes ? 0.72 : 0.65));
      const rimGeo = new THREE.CylinderGeometry(rimRadius, rimRadius, thickness + 0.15, config.rallySpokes ? 16 : 12);
      rimGeo.rotateX(Math.PI / 2);
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      wheelMesh.add(rimMesh);

      // Open wheel center locknut / deep dish center
      if (config.openWheel || config.deepDish) {
        const nutGeo = new THREE.CylinderGeometry(config.radius * 0.22, config.radius * 0.22, thickness + 0.3, 8);
        nutGeo.rotateX(Math.PI / 2);
        const nutMesh = new THREE.Mesh(nutGeo, new THREE.MeshStandardMaterial({ color: 0x222634, metalness: 0.9 }));
        wheelMesh.add(nutMesh);
      }

      pivot.add(wheelMesh);

      // Brake Disc Rotor & Caliper (anchored to steering hub, non-rolling)
      if (config.hasBrakeDiscs) {
        const inwardOffset = p.z > 0 ? -1.0 : 1.0;
        const discGeo = new THREE.CylinderGeometry(config.radius * 0.6, config.radius * 0.6, 0.4, 14);
        discGeo.rotateX(Math.PI / 2);
        const discMesh = new THREE.Mesh(discGeo, brakeDiscMat);
        discMesh.position.set(0, 0, inwardOffset);
        pivot.add(discMesh);

        const caliperGeo = new THREE.BoxGeometry(1.4, config.radius * 0.55, 1.2);
        const caliperMesh = new THREE.Mesh(caliperGeo, brakeCaliperMat);
        caliperMesh.position.set(0, config.radius * 0.32, inwardOffset);
        pivot.add(caliperMesh);
      }

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
    // 1. World Position & Heading / Elevation / Pitch Rotation
    // 2D x -> 3D X; 2D y -> 3D Z; 3D Y is vertical elevation
    this.group.position.set(car.x, car.z ?? 0, car.y);
    this.group.rotation.order = 'YXZ';
    this.group.rotation.y = -car.angle;
    this.group.rotation.z = car.pitch ?? 0;

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

    // 7.5. Titan Police Emergency LED Strobes
    if (this.titanStrobeLeds) {
      const flash = Math.sin(time * 20) > 0;
      this.titanStrobeLeds.red.color.setHex(flash ? 0xff0033 : 0x440011);
      this.titanStrobeLeds.blue.color.setHex(!flash ? 0x0066ff : 0x001144);
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

      // If car is launched airborne from jump ramps, suppress skidmarks
      if (car.isAirborne || (car.z && car.z > 2)) {
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

  // Rail beam visuals (1400 units forward piercing beam)
  private railCoreGeo: THREE.BufferGeometry;
  private railCoreMat: THREE.MeshBasicMaterial;
  private railSheathGeo: THREE.BufferGeometry;
  private railSheathMat: THREE.MeshBasicMaterial;
  private railRingGeo: THREE.BufferGeometry;
  private railRingMat: THREE.MeshBasicMaterial;

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

    // 4. Overcharge Rail Beam (1400-unit forward piercing beam)
    const beamLength = 1400;
    this.railCoreGeo = new THREE.CylinderGeometry(2.2, 2.2, beamLength, 12);
    this.railCoreGeo.rotateZ(Math.PI / 2);
    this.railCoreMat = new THREE.MeshBasicMaterial({
      color: 0x55ffff,
      blending: THREE.AdditiveBlending,
    });

    this.railSheathGeo = new THREE.CylinderGeometry(5.0, 5.0, beamLength, 12);
    this.railSheathGeo.rotateZ(Math.PI / 2);
    this.railSheathMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });

    this.railRingGeo = new THREE.TorusGeometry(8.0, 1.4, 8, 24);
    this.railRingGeo.rotateY(Math.PI / 2); // face forward along X axis
    this.railRingMat = new THREE.MeshBasicMaterial({
      color: 0x55ffff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
  }

  public update(projectiles: Projectile[], dt: number, time: number): void {
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
      } else if (p.type === 'rail_beam') {
        // High-frequency electric rail beam energy pulse
        const pulse = 0.95 + Math.sin(time * 35) * 0.12;
        const ring = visual.group.getObjectByName('railRing');
        if (ring) {
          ring.scale.set(pulse, pulse, pulse);
        }
        const sheath = visual.group.getObjectByName('railSheath');
        if (sheath) {
          sheath.scale.set(1.0, pulse, pulse);
        }
      } else if (p.type === 'decoy') {
        const decoy = visual.group.getObjectByName('decoyMesh');
        if (decoy) {
          decoy.rotation.y += dt * 3.0;
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
      // Magnificent 1400-unit forward piercing electric rail beam
      // Inner core beam: radius 2.2, begins at car bumper x=0, extends forward to x=+1400
      const core = new THREE.Mesh(this.railCoreGeo, this.railCoreMat);
      core.name = 'railCore';
      core.position.set(700, 0, 0);
      group.add(core);

      // Outer glow sheath: radius 5.0, begins at bumper x=0, extends forward to x=+1400
      const sheath = new THREE.Mesh(this.railSheathGeo, this.railSheathMat);
      sheath.name = 'railSheath';
      sheath.position.set(700, 0, 0);
      group.add(sheath);

      // Muzzle shockwave ring at car bumper (x = 0) facing forward
      const ring = new THREE.Mesh(this.railRingGeo, this.railRingMat);
      ring.name = 'railRing';
      ring.position.set(0, 0, 0);
      group.add(ring);
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
    } else if (p.type === 'decoy') {
      // Holographic Decoy ghost drone
      const geo = new THREE.BoxGeometry(18, 6, 28);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xd000ff,
        wireframe: true,
        transparent: true,
        opacity: 0.65,
      });
      const decoyMesh = new THREE.Mesh(geo, mat);
      decoyMesh.name = 'decoyMesh';
      group.add(decoyMesh);
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
    this.railCoreGeo.dispose();
    this.railCoreMat.dispose();
    this.railSheathGeo.dispose();
    this.railSheathMat.dispose();
    this.railRingGeo.dispose();
    this.railRingMat.dispose();

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
