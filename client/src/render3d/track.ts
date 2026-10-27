import * as THREE from 'three';
import type { BoostPad, JumpRamp, StadiumTrack, TrackBarrier, Vector2D } from '../types.ts';

/**
 * Creates procedural textures for asphalt, hazard stripes, and checkered finish gantry.
 */
function createAsphaltTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base asphalt slate
  ctx.fillStyle = '#141724';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle grain / noise
  for (let i = 0; i < 18000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const alpha = Math.random() * 0.06;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }

  // Subtle track expansion seam lines
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= 512; x += 128) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
  }
  for (let y = 0; y <= 512; y += 128) {
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
  }
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(28, 19);
  return texture;
}

function createHazardStripesTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffcc00'; // Safety yellow
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = '#12141c'; // Dark hazard stripe
  const stripeWidth = 22;
  ctx.beginPath();
  for (let i = -128; i < 256; i += stripeWidth * 2) {
    ctx.moveTo(i, 0);
    ctx.lineTo(i + stripeWidth, 0);
    ctx.lineTo(i + stripeWidth + 128, 128);
    ctx.lineTo(i + 128, 128);
    ctx.closePath();
  }
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  return texture;
}

function createCheckeredTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#11131c';

  const tileSize = 32;
  for (let y = 0; y < 128; y += tileSize) {
    for (let x = 0; x < 512; x += tileSize) {
      if ((x / tileSize + y / tileSize) % 2 === 1) {
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

interface AnimatedChevron {
  material: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  offset: number;
}

interface AnimatedBeacon {
  material: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  frequency: number;
}

export class Track3D {
  public group: THREE.Group = new THREE.Group();

  private textures: THREE.Texture[] = [];
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];

  private chevrons: AnimatedChevron[] = [];
  private beacons: AnimatedBeacon[] = [];

  constructor(track: StadiumTrack) {
    this.buildTrack(track);
  }

  private registerTexture<T extends THREE.Texture>(tex: T): T {
    this.textures.push(tex);
    return tex;
  }

  private registerMaterial<T extends THREE.Material>(mat: T): T {
    this.materials.push(mat);
    return mat;
  }

  private registerGeometry<T extends THREE.BufferGeometry>(geo: T): T {
    this.geometries.push(geo);
    return geo;
  }

  private buildTrack(track: StadiumTrack): void {
    const width = track.width;
    const height = track.height;

    // ========================================================================
    // 1. ASPHALT TARMAC PLANE
    // ========================================================================
    const asphaltTex = this.registerTexture(createAsphaltTexture());
    const tarmacGeo = this.registerGeometry(new THREE.PlaneGeometry(width + 400, height + 400));
    const tarmacMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        map: asphaltTex,
        roughness: 0.88,
        metalness: 0.12,
        color: 0x202436,
      })
    );
    const tarmacMesh = new THREE.Mesh(tarmacGeo, tarmacMat);
    tarmacMesh.rotation.x = -Math.PI / 2;
    tarmacMesh.position.set(width / 2, 0, height / 2);
    tarmacMesh.receiveShadow = true;
    this.group.add(tarmacMesh);

    // Neon stadium outer runoff perimeter line
    const runoffGeo = this.registerGeometry(new THREE.PlaneGeometry(width, height));
    const runoffMat = this.registerMaterial(
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.04,
      })
    );
    const runoffMesh = new THREE.Mesh(runoffGeo, runoffMat);
    runoffMesh.rotation.x = -Math.PI / 2;
    runoffMesh.position.set(width / 2, 0.05, height / 2);
    this.group.add(runoffMesh);

    // ========================================================================
    // 2. CHECKERED FINISH GANTRY ARCH
    // ========================================================================
    this.buildFinishGantry(track.finishLine);

    // ========================================================================
    // 3. OUTER & INNER STADIUM BORDER WALLS
    // ========================================================================
    const theme = track.theme || 'neon';
    const outerColor = theme === 'canyon' ? 0xff8800 : theme === 'industrial' ? 0x39ff14 : 0x00f0ff;
    const innerColor = theme === 'canyon' ? 0xff3300 : theme === 'industrial' ? 0x00e5ff : 0xff007f;
    this.buildBorderWalls(track.outerBorder, outerColor, 'outer');
    this.buildBorderWalls(track.innerBorder, innerColor, 'inner');

    // ========================================================================
    // 4. CHICANE HAZARD BARRIERS
    // ========================================================================
    this.buildChicaneBarriers(track.barriers);

    // ========================================================================
    // 5. BOOST PADS ON TARMAC
    // ========================================================================
    this.buildBoostPads(track.boostPads);

    // ========================================================================
    // 6. JUMP RAMPS / CHEVRONS
    // ========================================================================
    this.buildJumpRamps(track.ramps, outerColor);
  }

  // ==========================================================================
  // FINISH GANTRY ARCH
  // ==========================================================================
  private buildFinishGantry(finishLine: StadiumTrack['finishLine']): void {
    const x1 = finishLine.x1;
    const z1 = finishLine.y1;
    const x2 = finishLine.x2;
    const z2 = finishLine.y2;

    const span = Math.hypot(x2 - x1, z2 - z1);
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const angle = Math.atan2(z2 - z1, x2 - x1);

    const gantryGroup = new THREE.Group();
    gantryGroup.position.set(midX, 0, midZ);
    gantryGroup.rotation.y = -angle;

    const gantryHeight = 72;
    const trussMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x3a4256,
        roughness: 0.5,
        metalness: 0.8,
      })
    );
    const neonCyanMat = this.registerMaterial(
      new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    );
    const neonAmberMat = this.registerMaterial(
      new THREE.MeshBasicMaterial({ color: 0xffaa00 })
    );

    // Left structural pylon
    const pylonGeo = this.registerGeometry(new THREE.BoxGeometry(10, gantryHeight, 10));
    const leftPylon = new THREE.Mesh(pylonGeo, trussMat);
    leftPylon.position.set(-span / 2, gantryHeight / 2, 0);
    leftPylon.castShadow = true;
    leftPylon.receiveShadow = true;
    gantryGroup.add(leftPylon);

    // Right structural pylon
    const rightPylon = new THREE.Mesh(pylonGeo, trussMat);
    rightPylon.position.set(span / 2, gantryHeight / 2, 0);
    rightPylon.castShadow = true;
    rightPylon.receiveShadow = true;
    gantryGroup.add(rightPylon);

    // Overhead truss beam
    const beamGeo = this.registerGeometry(new THREE.BoxGeometry(span + 14, 14, 12));
    const beamMesh = new THREE.Mesh(beamGeo, trussMat);
    beamMesh.position.set(0, gantryHeight, 0);
    beamMesh.castShadow = true;
    beamMesh.receiveShadow = true;
    gantryGroup.add(beamMesh);

    // Checkered banner on the crossbeam
    const checkeredTex = this.registerTexture(createCheckeredTexture());
    checkeredTex.repeat.set(Math.max(4, Math.round(span / 45)), 1);
    const bannerGeo = this.registerGeometry(new THREE.BoxGeometry(span, 10, 1.2));
    const bannerMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        map: checkeredTex,
        roughness: 0.4,
        metalness: 0.1,
      })
    );
    const bannerFront = new THREE.Mesh(bannerGeo, bannerMat);
    bannerFront.position.set(0, gantryHeight, 6.2);
    gantryGroup.add(bannerFront);

    const bannerBack = new THREE.Mesh(bannerGeo, bannerMat);
    bannerBack.position.set(0, gantryHeight, -6.2);
    gantryGroup.add(bannerBack);

    // Neon edge rails on overhead gantry
    const neonRailGeo = this.registerGeometry(new THREE.BoxGeometry(span + 14, 1.2, 1.2));
    const neonTopFront = new THREE.Mesh(neonRailGeo, neonCyanMat);
    neonTopFront.position.set(0, gantryHeight + 7, 6.2);
    gantryGroup.add(neonTopFront);

    const neonBottomFront = new THREE.Mesh(neonRailGeo, neonAmberMat);
    neonBottomFront.position.set(0, gantryHeight - 7, 6.2);
    gantryGroup.add(neonBottomFront);

    // Tarmac finish line stripe on the ground
    const stripeGeo = this.registerGeometry(new THREE.PlaneGeometry(span, 16));
    const stripeMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        map: checkeredTex,
        roughness: 0.7,
        metalness: 0.1,
      })
    );
    const tarmacStripe = new THREE.Mesh(stripeGeo, stripeMat);
    tarmacStripe.rotation.x = -Math.PI / 2;
    tarmacStripe.position.set(0, 0.1, 0);
    tarmacStripe.receiveShadow = true;
    gantryGroup.add(tarmacStripe);

    // Finish line arch spotlights pointing down onto the tarmac
    const archLight1 = new THREE.SpotLight(0x00f0ff, 80, 160, Math.PI / 4, 0.4, 1.2);
    archLight1.position.set(-span * 0.25, gantryHeight - 5, 0);
    archLight1.target.position.set(-span * 0.25, 0, 0);
    gantryGroup.add(archLight1);
    gantryGroup.add(archLight1.target);

    const archLight2 = new THREE.SpotLight(0xffffff, 80, 160, Math.PI / 4, 0.4, 1.2);
    archLight2.position.set(span * 0.25, gantryHeight - 5, 0);
    archLight2.target.position.set(span * 0.25, 0, 0);
    gantryGroup.add(archLight2);
    gantryGroup.add(archLight2.target);

    this.group.add(gantryGroup);
  }

  // ==========================================================================
  // STADIUM BORDER WALLS & NEON STRIPS
  // ==========================================================================
  private buildBorderWalls(points: Vector2D[], neonHex: number, type: 'outer' | 'inner'): void {
    if (points.length < 2) return;

    const wallHeight = 36;
    const wallThickness = 12;

    const concreteMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: type === 'outer' ? 0x222634 : 0x1b1e2a,
        roughness: 0.75,
        metalness: 0.25,
      })
    );

    const neonMat = this.registerMaterial(
      new THREE.MeshBasicMaterial({
        color: neonHex,
      })
    );

    const curbMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: type === 'outer' ? 0x00c8e0 : 0xd80068,
        roughness: 0.6,
        metalness: 0.2,
      })
    );

    const count = points.length;
    for (let i = 0; i < count; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % count];

      const dx = p2.x - p1.x;
      const dz = p2.y - p1.y;
      const length = Math.hypot(dx, dz);
      if (length < 1e-4) continue;

      const midX = (p1.x + p2.x) / 2;
      const midZ = (p1.y + p2.y) / 2;
      const angle = Math.atan2(dz, dx);

      const segmentGroup = new THREE.Group();
      segmentGroup.position.set(midX, 0, midZ);
      segmentGroup.rotation.y = -angle;

      // 1. Concrete Barrier Wall
      const wallGeo = this.registerGeometry(new THREE.BoxGeometry(length, wallHeight, wallThickness));
      const wallMesh = new THREE.Mesh(wallGeo, concreteMat);
      wallMesh.position.set(0, wallHeight / 2, 0);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      segmentGroup.add(wallMesh);

      // 2. Glowing Neon Edge Strip along the Top Rim
      const neonGeo = this.registerGeometry(new THREE.BoxGeometry(length, 2.2, 2.2));
      const neonMesh = new THREE.Mesh(neonGeo, neonMat);
      neonMesh.position.set(0, wallHeight + 1.1, 0);
      segmentGroup.add(neonMesh);

      // 3. Track Curb / Rumble Strip on the track side
      const curbGeo = this.registerGeometry(new THREE.BoxGeometry(length, 2.0, 10));
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      const curbOffset = type === 'outer' ? wallThickness / 2 + 5 : -(wallThickness / 2 + 5);
      curbMesh.position.set(0, 1.0, curbOffset);
      curbMesh.receiveShadow = true;
      segmentGroup.add(curbMesh);

      this.group.add(segmentGroup);
    }
  }

  // ==========================================================================
  // CHICANE BARRIERS WITH HAZARD STRIPES
  // ==========================================================================
  private buildChicaneBarriers(barriers: TrackBarrier[]): void {
    const hazardTex = this.registerTexture(createHazardStripesTexture());
    const barrierHeight = 32;

    for (const b of barriers) {
      const bWidth = b.width;
      const bLength = b.height; // in 2D types, 'height' is barrier length

      const chicaneGroup = new THREE.Group();
      chicaneGroup.position.set(b.x, 0, b.y);
      chicaneGroup.rotation.y = -b.angle;

      // Hazard striped barrier body
      const bodyGeo = this.registerGeometry(new THREE.BoxGeometry(bWidth, barrierHeight, bLength));
      const bodyMat = this.registerMaterial(
        new THREE.MeshStandardMaterial({
          map: hazardTex,
          roughness: 0.5,
          metalness: 0.3,
        })
      );
      const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      bodyMesh.position.set(0, barrierHeight / 2, 0);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      chicaneGroup.add(bodyMesh);

      // Top steel cap
      const capGeo = this.registerGeometry(new THREE.BoxGeometry(bWidth + 2, 3, bLength + 2));
      const capMat = this.registerMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x282c3c,
          roughness: 0.4,
          metalness: 0.8,
        })
      );
      const capMesh = new THREE.Mesh(capGeo, capMat);
      capMesh.position.set(0, barrierHeight + 1.5, 0);
      chicaneGroup.add(capMesh);

      // Blinking amber hazard warning beacons on ends of chicane barrier
      for (const zOffset of [-bLength * 0.35, bLength * 0.35]) {
        const beaconGeo = this.registerGeometry(new THREE.CylinderGeometry(2.5, 3.2, 5, 12));
        const beaconMat = this.registerMaterial(
          new THREE.MeshBasicMaterial({ color: 0xffaa00 })
        );
        const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
        beaconMesh.position.set(0, barrierHeight + 4.5, zOffset);
        chicaneGroup.add(beaconMesh);

        this.beacons.push({
          material: beaconMat,
          baseColor: new THREE.Color(0xffaa00),
          frequency: 3.5 + Math.random() * 1.5,
        });
      }

      this.group.add(chicaneGroup);
    }
  }

  // ==========================================================================
  // BOOST PADS WITH PULSING CHEVRONS
  // ==========================================================================
  private buildBoostPads(boostPads: BoostPad[]): void {
    const padMetalMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x181c28,
        roughness: 0.4,
        metalness: 0.85,
      })
    );

    for (const pad of boostPads) {
      const padGroup = new THREE.Group();
      padGroup.position.set(pad.x, 0, pad.y);
      padGroup.rotation.y = -pad.angle;

      const padLength = Math.max(pad.width, pad.height);
      const padWidth = Math.min(pad.width, pad.height);

      // Base metallic induction plate embedded in tarmac (length along X, width along Z)
      const baseGeo = this.registerGeometry(new THREE.BoxGeometry(padLength, 0.6, padWidth));
      const baseMesh = new THREE.Mesh(baseGeo, padMetalMat);
      baseMesh.position.set(0, 0.3, 0);
      baseMesh.receiveShadow = true;
      padGroup.add(baseMesh);

      // Glowing border frame
      const frameGeo = this.registerGeometry(new THREE.BoxGeometry(padLength + 2, 0.8, padWidth + 2));
      const frameMat = this.registerMaterial(
        new THREE.MeshBasicMaterial({ color: 0x00f0ff, wireframe: true })
      );
      const frameMesh = new THREE.Mesh(frameGeo, frameMat);
      frameMesh.position.set(0, 0.4, 0);
      padGroup.add(frameMesh);

      // Multiple chevron arrows ('>') pointing forward along +X in direction of boost
      const numChevrons = 4;
      const spacing = padLength / (numChevrons + 1);

      for (let i = 0; i < numChevrons; i++) {
        const xPos = -padLength / 2 + spacing * (i + 1);

        // Build a chevron arrow pointing toward +X
        const armLength = padWidth * 0.38;
        const armWidth = 4.0;
        const chevronArmGeo = this.registerGeometry(new THREE.BoxGeometry(armLength, 0.8, armWidth));

        const chevronMat = this.registerMaterial(
          new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
          })
        );

        // Top wing (slanted back towards -X)
        const topWing = new THREE.Mesh(chevronArmGeo, chevronMat);
        topWing.position.set(xPos - armLength * 0.25, 0.7, armLength * 0.3);
        topWing.rotation.y = Math.PI / 4;
        padGroup.add(topWing);

        // Bottom wing (slanted back towards -X)
        const botWing = new THREE.Mesh(chevronArmGeo, chevronMat);
        botWing.position.set(xPos - armLength * 0.25, 0.7, -armLength * 0.3);
        botWing.rotation.y = -Math.PI / 4;
        padGroup.add(botWing);

        this.chevrons.push({
          material: chevronMat,
          baseColor: new THREE.Color(0x00f0ff),
          offset: i * 0.25,
        });
      }

      this.group.add(padGroup);
    }
  }

  // ==========================================================================
  // JUMP RAMPS / CHEVRONS
  // ==========================================================================
  // JUMP RAMPS (High-speed stadium launches with neon rails)
  // ==========================================================================
  private buildJumpRamps(ramps?: JumpRamp[], accentColor: number = 0x00f0ff): void {
    const rampLocations = (ramps && ramps.length > 0)
      ? ramps.map((r) => ({
          x: r.x,
          z: r.y,
          angle: r.angle,
          width: r.width,
          length: r.length,
          height: r.height,
        }))
      : [
          { x: 1950, z: 380, angle: 0, width: 85, length: 110, height: 18 },
          { x: 1950, z: 2400 - 380, angle: Math.PI, width: 85, length: 110, height: 18 },
        ];

    const rampMat = this.registerMaterial(
      new THREE.MeshStandardMaterial({
        color: 0x222738,
        roughness: 0.65,
        metalness: 0.35,
      })
    );

    const neonRampMat = this.registerMaterial(
      new THREE.MeshBasicMaterial({ color: accentColor })
    );

    for (const r of rampLocations) {
      const rampGroup = new THREE.Group();
      rampGroup.position.set(r.x, 0, r.z);
      rampGroup.rotation.y = -r.angle;

      const halfL = r.length / 2;
      const halfW = r.width / 2;
      const H = r.height;

      // 1. Build precisely aligned right-triangular wedge prism
      const positions: number[] = [
        // Inclined drive slope (top)
        -halfL, 0, -halfW,   -halfL, 0,  halfW,    halfL, H, -halfW,
         halfL, H, -halfW,   -halfL, 0,  halfW,    halfL, H,  halfW,

        // Vertical back face (under launch lip)
         halfL, 0, -halfW,    halfL, H, -halfW,    halfL, 0,  halfW,
         halfL, 0,  halfW,    halfL, H, -halfW,    halfL, H,  halfW,

        // Bottom face (tarmac contact)
        -halfL, 0, -halfW,    halfL, 0, -halfW,   -halfL, 0,  halfW,
        -halfL, 0,  halfW,    halfL, 0, -halfW,    halfL, 0,  halfW,

        // Left flank triangle
        -halfL, 0, -halfW,    halfL, H, -halfW,    halfL, 0, -halfW,

        // Right flank triangle
        -halfL, 0,  halfW,    halfL, 0,  halfW,    halfL, H,  halfW,
      ];

      const wedgeGeo = this.registerGeometry(new THREE.BufferGeometry());
      wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      wedgeGeo.computeVertexNormals();

      const wedgeMesh = new THREE.Mesh(wedgeGeo, rampMat);
      wedgeMesh.castShadow = true;
      wedgeMesh.receiveShadow = true;
      rampGroup.add(wedgeMesh);

      // 2. Perfectly aligned neon rails along left & right incline edges
      const slopeLen = Math.hypot(r.length, H);
      const pitchAngle = Math.atan2(H, r.length);

      const railGeo = this.registerGeometry(new THREE.CylinderGeometry(1.2, 1.2, slopeLen, 8));

      // Left incline rail
      const leftRail = new THREE.Mesh(railGeo, neonRampMat);
      leftRail.position.set(0, H / 2, -halfW);
      leftRail.rotation.z = -pitchAngle + Math.PI / 2;
      rampGroup.add(leftRail);

      // Right incline rail
      const rightRail = new THREE.Mesh(railGeo, neonRampMat);
      rightRail.position.set(0, H / 2, halfW);
      rightRail.rotation.z = -pitchAngle + Math.PI / 2;
      rampGroup.add(rightRail);

      // Launch lip neon strip across the top edge
      const lipGeo = this.registerGeometry(new THREE.CylinderGeometry(1.4, 1.4, r.width, 8));
      const lipRail = new THREE.Mesh(lipGeo, neonRampMat);
      lipRail.position.set(halfL, H, 0);
      lipRail.rotation.x = Math.PI / 2;
      rampGroup.add(lipRail);

      this.group.add(rampGroup);
    }
  }

  // ==========================================================================
  // ANIMATION LOOP (Boost pulse, blinking beacons)
  // ==========================================================================
  public update(_dt: number, time: number): void {
    // 1. Pulsing boost pad chevrons: sequential high-speed light wave
    const waveSpeed = 6.0;
    for (const ch of this.chevrons) {
      const pulse = Math.sin((time * waveSpeed - ch.offset * Math.PI * 2)) * 0.5 + 0.5;
      const intensity = 0.35 + pulse * 1.65;
      ch.material.color.copy(ch.baseColor).multiplyScalar(intensity);
    }

    // 2. Chicane hazard warning beacons: rhythmic strobe blink
    for (const b of this.beacons) {
      const blink = Math.sin(time * b.frequency * Math.PI * 2) > 0.1 ? 1.4 : 0.15;
      b.material.color.copy(b.baseColor).multiplyScalar(blink);
    }
  }

  public dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries = [];
    this.materials = [];
    this.textures = [];
    this.chevrons = [];
    this.beacons = [];
  }
}
