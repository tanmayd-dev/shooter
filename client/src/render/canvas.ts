import {
  CarState,
  Projectile,
  StadiumTrack,
  Vector2D,
} from '../types';
import { ParticleSystem } from './particles';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  trauma: number; // 0.0 to 1.0
}

export type CameraMode = 'chase' | 'stadium';

export class GameRenderer {
  private mainCanvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // Offscreen canvas for persistent tire skid marks
  private skidCanvas: HTMLCanvasElement;
  private skidCtx: CanvasRenderingContext2D;
  private skidWidth: number = 4000;
  private skidHeight: number = 3000;

  public camera: Camera = { x: 0, y: 0, zoom: 1.0, trauma: 0.0 };
  public cameraMode: CameraMode = 'chase';
  public particles: ParticleSystem;

  // Track previous wheel positions per car ID to draw continuous skid strokes
  private prevWheelPositions: Map<string, { fl: Vector2D; fr: Vector2D; rl: Vector2D; rr: Vector2D }> = new Map();

  constructor(canvas: HTMLCanvasElement, particles: ParticleSystem) {
    this.mainCanvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
    this.particles = particles;

    // Create persistent skidmark buffer
    this.skidCanvas = document.createElement('canvas');
    this.skidCanvas.width = this.skidWidth;
    this.skidCanvas.height = this.skidHeight;
    const skidCtx = this.skidCanvas.getContext('2d');
    if (!skidCtx) throw new Error('Failed to create skidmark offscreen context');
    this.skidCtx = skidCtx;

    // Initialize transparent skid canvas
    this.skidCtx.clearRect(0, 0, this.skidWidth, this.skidHeight);
  }

  public resize(width: number, height: number): void {
    this.mainCanvas.width = width;
    this.mainCanvas.height = height;
  }

  /**
   * Triggers camera trauma for screen shake.
   * @param amount 0.0 to 1.0
   */
  public addScreenShake(amount: number): void {
    this.camera.trauma = Math.min(1.0, this.camera.trauma + amount);
  }

  /**
   * Toggles between 3D chase camera and wide arena stadium camera.
   */
  public toggleCameraMode(): CameraMode {
    this.cameraMode = this.cameraMode === 'chase' ? 'stadium' : 'chase';
    return this.cameraMode;
  }

  /**
   * Projects a world-space coordinate to viewport screen coordinates.
   */
  public toScreen(worldX: number, worldY: number): Vector2D {
    return {
      x: (worldX - this.camera.x) * this.camera.zoom + this.mainCanvas.width / 2,
      y: (worldY - this.camera.y) * this.camera.zoom + this.mainCanvas.height / 2,
    };
  }

  /**
   * Updates camera position and smooth zoom towards the focused vehicle.
   */
  public updateCamera(target: CarState | null, dt: number): void {
    // Decay screen shake
    if (this.camera.trauma > 0) {
      this.camera.trauma = Math.max(0, this.camera.trauma - dt * 1.8);
    }

    if (this.cameraMode === 'stadium') {
      // Wide stadium overview cam: smooth lerp to stadium center and wide zoom
      const arenaCenterX = 1800;
      const arenaCenterY = 1200;
      const targetZoom = 0.42;

      const lerpSpeed = 5.0;
      this.camera.x += (arenaCenterX - this.camera.x) * Math.min(1.0, dt * lerpSpeed);
      this.camera.y += (arenaCenterY - this.camera.y) * Math.min(1.0, dt * lerpSpeed);
      this.camera.zoom += (targetZoom - this.camera.zoom) * Math.min(1.0, dt * lerpSpeed);
      return;
    }

    if (!target) return;

    // Lead camera slightly in direction of vehicle velocity for high-speed visibility
    const leadFactor = 0.22;
    const targetX = target.x + target.vx * leadFactor;
    const targetY = target.y + target.vy * leadFactor;

    // Smooth lerp camera
    const lerpSpeed = 7.0;
    this.camera.x += (targetX - this.camera.x) * Math.min(1.0, dt * lerpSpeed);
    this.camera.y += (targetY - this.camera.y) * Math.min(1.0, dt * lerpSpeed);

    // Dynamic zoom based on speed: pull out at 500+ km/h
    const speed = Math.hypot(target.vx, target.vy);
    const speedRatio = Math.min(1.0, speed / 1400);
    const targetZoom = 1.0 - speedRatio * 0.28; // zooms out to ~0.72 at top speed
    this.camera.zoom += (targetZoom - this.camera.zoom) * Math.min(1.0, dt * 4.0);
  }

  /**
   * Main render loop entry.
   */
  public render(
    track: StadiumTrack,
    cars: CarState[],
    projectiles: Projectile[],
    dt: number
  ): void {
    const width = this.mainCanvas.width;
    const height = this.mainCanvas.height;
    const ctx = this.ctx;

    // 1. Clear background
    ctx.fillStyle = '#0d0f17';
    ctx.fillRect(0, 0, width, height);

    // 2. Fade skidmark canvas gradually over time (fade out old tire rubber)
    this.fadeSkidmarks(dt);

    // 3. Compute screen shake offsets
    const shake = this.camera.trauma * this.camera.trauma;
    const maxOffset = 22;
    const offsetX = shake * maxOffset * (Math.random() * 2 - 1);
    const offsetY = shake * maxOffset * (Math.random() * 2 - 1);
    const maxAngle = 0.035;
    const shakeAngle = shake * maxAngle * (Math.random() * 2 - 1);

    // 4. Begin World Viewport Transformation
    ctx.save();
    ctx.translate(width / 2 + offsetX, height / 2 + offsetY);
    ctx.rotate(shakeAngle);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // 5. Draw Track & Stadium Floor
    this.renderTrackFloor(ctx, track);

    // 6. Draw Persistent Skidmarks from Offscreen Canvas
    ctx.drawImage(this.skidCanvas, 0, 0);

    // 7. Update & Draw Dynamic Skidmarks from active cars
    this.updateAndDrawSkidmarks(cars);

    // 8. Draw Speed Boost Pads & Barriers
    this.renderBoostPads(ctx, track.boostPads);
    this.renderBarriers(ctx, track.barriers);
    this.renderFinishLine(ctx, track.finishLine);

    // 9. Draw Track Stadium Glowing Borders & Chevron Curbs
    this.renderTrackBorders(ctx, track);

    // 10. Draw Directional Headlights for all cars
    for (const car of cars) {
      if (car.isAlive) {
        this.renderHeadlights(ctx, car);
      }
    }

    // 11. Draw Projectiles
    this.renderProjectiles(ctx, projectiles);

    // 12. Draw Particles (under cars for smoke, over cars for sparks)
    this.particles.render(ctx);

    // 13. Draw Cars
    for (const car of cars) {
      if (car.isAlive) {
        this.renderCar(ctx, car);
      }
    }

    // 14. Restore World Transform
    ctx.restore();
  }

  // ==========================================
  // TRACK & FLOOR RENDERING
  // ==========================================
  private renderTrackFloor(ctx: CanvasRenderingContext2D, track: StadiumTrack): void {
    // Dark asphalt arena floor
    ctx.fillStyle = '#121522';
    ctx.fillRect(0, 0, track.width, track.height);

    // Subtle high-speed neon stadium grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    const gridSize = 120;
    ctx.beginPath();
    for (let x = 0; x <= track.width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, track.height);
    }
    for (let y = 0; y <= track.height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(track.width, y);
    }
    ctx.stroke();

    // Soft stadium floodlight glows at arena corners
    this.renderFloodlight(ctx, 100, 100, 600);
    this.renderFloodlight(ctx, track.width - 100, 100, 600);
    this.renderFloodlight(ctx, 100, track.height - 100, 600);
    this.renderFloodlight(ctx, track.width - 100, track.height - 100, 600);
  }

  private renderFloodlight(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
    const grad = ctx.createRadialGradient(x, y, 10, x, y, radius);
    grad.addColorStop(0, 'rgba(0, 240, 255, 0.08)');
    grad.addColorStop(0.5, 'rgba(0, 120, 255, 0.03)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ==========================================
  // TRACK BORDERS & CHEVRON CURBS
  // ==========================================
  private renderTrackBorders(ctx: CanvasRenderingContext2D, track: StadiumTrack): void {
    // Outer neon barrier
    this.drawCurvedBorder(ctx, track.outerBorder, '#00f0ff', 10, true);
    // Inner neon barrier
    this.drawCurvedBorder(ctx, track.innerBorder, '#ff007f', 10, true);
  }

  private drawCurvedBorder(
    ctx: CanvasRenderingContext2D,
    points: Vector2D[],
    neonColor: string,
    width: number,
    closed: boolean
  ): void {
    if (points.length < 2) return;

    // 1. Draw glowing neon tube
    ctx.save();
    ctx.strokeStyle = neonColor;
    ctx.shadowColor = neonColor;
    ctx.shadowBlur = 16;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    if (closed) ctx.closePath();
    ctx.stroke();

    // White core line for intense glow
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = width * 0.35;
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.restore();

    // 2. Draw Chevron Curbs along segments
    this.drawChevronCurbs(ctx, points, closed);
  }

  private drawChevronCurbs(ctx: CanvasRenderingContext2D, points: Vector2D[], closed: boolean): void {
    ctx.save();
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 10) continue;

      const angle = Math.atan2(dy, dx);
      const perpAngle = angle + Math.PI / 2;
      const curbWidth = 14;
      const step = 20;

      for (let d = 0; d < dist; d += step) {
        const t = d / dist;
        const cx = p1.x + dx * t;
        const cy = p1.y + dy * t;
        const isRed = Math.floor(d / step) % 2 === 0;

        ctx.fillStyle = isRed ? '#ff2a2a' : '#f0f0f0';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(perpAngle) * curbWidth, cy + Math.sin(perpAngle) * curbWidth);
        ctx.lineTo(
          cx + Math.cos(perpAngle) * curbWidth + Math.cos(angle) * (step * 0.8),
          cy + Math.sin(perpAngle) * curbWidth + Math.sin(angle) * (step * 0.8)
        );
        ctx.lineTo(cx + Math.cos(angle) * (step * 0.8), cy + Math.sin(angle) * (step * 0.8));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ==========================================
  // BOOST PADS & CHICANES & FINISH LINE
  // ==========================================
  private renderBoostPads(ctx: CanvasRenderingContext2D, boostPads: StadiumTrack['boostPads']): void {
    const time = performance.now() * 0.006;

    for (const pad of boostPads) {
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.rotate(pad.angle);

      // Pad backing
      ctx.fillStyle = '#0a1a24';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00f0ff';
      ctx.shadowBlur = 14;
      ctx.fillRect(-pad.width / 2, -pad.height / 2, pad.width, pad.height);
      ctx.strokeRect(-pad.width / 2, -pad.height / 2, pad.width, pad.height);

      // Animated glowing chevron arrows flowing forward
      const numChevrons = 4;
      const spacing = pad.width / (numChevrons + 1);

      for (let i = 0; i < numChevrons; i++) {
        const offset = ((i * spacing + time * 40) % pad.width) - pad.width / 2;
        const pulse = Math.sin(time * 3 + i) * 0.3 + 0.7;

        ctx.strokeStyle = `rgba(0, 240, 255, ${pulse})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(offset - 10, -pad.height / 3);
        ctx.lineTo(offset + 10, 0);
        ctx.lineTo(offset - 10, pad.height / 3);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private renderBarriers(ctx: CanvasRenderingContext2D, barriers: StadiumTrack['barriers']): void {
    for (const b of barriers) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);

      // Safety barrier body
      ctx.fillStyle = '#1c2233';
      ctx.strokeStyle = b.color || '#ff8c00';
      ctx.lineWidth = 3;
      ctx.shadowColor = b.color || '#ff8c00';
      ctx.shadowBlur = 8;
      ctx.fillRect(-b.width / 2, -b.height / 2, b.width, b.height);
      ctx.strokeRect(-b.width / 2, -b.height / 2, b.width, b.height);

      // Hazard warning stripes (yellow & black diagonal)
      ctx.save();
      ctx.beginPath();
      ctx.rect(-b.width / 2, -b.height / 2, b.width, b.height);
      ctx.clip();

      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 6;
      for (let x = -b.width; x < b.width; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, -b.height / 2);
        ctx.lineTo(x + b.height, b.height / 2);
        ctx.stroke();
      }
      ctx.restore();

      ctx.restore();
    }
  }

  private renderFinishLine(ctx: CanvasRenderingContext2D, finish: StadiumTrack['finishLine']): void {
    ctx.save();
    const dx = finish.x2 - finish.x1;
    const dy = finish.y2 - finish.y1;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    ctx.translate(finish.x1, finish.y1);
    ctx.rotate(angle);

    const checkWidth = 14;
    const checkHeight = 12;
    const rows = 2;
    const cols = Math.floor(length / checkWidth);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const isWhite = (r + c) % 2 === 0;
        ctx.fillStyle = isWhite ? '#ffffff' : '#111111';
        ctx.fillRect(c * checkWidth, (r - 1) * checkHeight, checkWidth, checkHeight);
      }
    }

    // Glowing neon start/finish gantry frame
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.strokeRect(0, -checkHeight, length, checkHeight * 2);

    ctx.restore();
  }

  // ==========================================
  // SKIDMARKS ENGINE
  // ==========================================
  private fadeSkidmarks(dt: number): void {
    // Very gentle fade out over time so skid marks persist for tens of seconds
    this.skidCtx.save();
    this.skidCtx.globalCompositeOperation = 'destination-out';
    this.skidCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.015, dt * 0.02)})`;
    this.skidCtx.fillRect(0, 0, this.skidWidth, this.skidHeight);
    this.skidCtx.restore();
  }

  private updateAndDrawSkidmarks(cars: CarState[]): void {
    for (const car of cars) {
      if (!car.isAlive) continue;

      const cos = Math.cos(car.angle);
      const sin = Math.sin(car.angle);

      // Calculate 4 wheel world coordinates
      const halfL = car.archetype === 'desert' ? 24 : car.archetype === 'stadium' ? 22 : 18;
      const halfW = car.archetype === 'desert' ? 14 : car.archetype === 'stadium' ? 12 : 11;

      // Front Left, Front Right, Rear Left, Rear Right
      const fl: Vector2D = {
        x: car.x + cos * halfL - sin * halfW,
        y: car.y + sin * halfL + cos * halfW,
      };
      const fr: Vector2D = {
        x: car.x + cos * halfL + sin * halfW,
        y: car.y + sin * halfL - cos * halfW,
      };
      const rl: Vector2D = {
        x: car.x - cos * halfL - sin * halfW,
        y: car.y - sin * halfL + cos * halfW,
      };
      const rr: Vector2D = {
        x: car.x - cos * halfL + sin * halfW,
        y: car.y - sin * halfL - cos * halfW,
      };

      const prev = this.prevWheelPositions.get(car.id);

      if (prev && car.skidIntensity > 0.18) {
        this.skidCtx.save();
        this.skidCtx.strokeStyle = `rgba(12, 14, 20, ${Math.min(0.75, car.skidIntensity * 0.7)})`;
        this.skidCtx.lineWidth = car.archetype === 'desert' ? 4.5 : 3.2;
        this.skidCtx.lineCap = 'round';

        // Connect previous wheel contact points to current
        this.skidCtx.beginPath();
        this.skidCtx.moveTo(prev.rl.x, prev.rl.y);
        this.skidCtx.lineTo(rl.x, rl.y);
        this.skidCtx.moveTo(prev.rr.x, prev.rr.y);
        this.skidCtx.lineTo(rr.x, rr.y);

        // Front wheels also leave skids under hard slide
        if (car.skidIntensity > 0.45) {
          this.skidCtx.moveTo(prev.fl.x, prev.fl.y);
          this.skidCtx.lineTo(fl.x, fl.y);
          this.skidCtx.moveTo(prev.fr.x, prev.fr.y);
          this.skidCtx.lineTo(fr.x, fr.y);
        }
        this.skidCtx.stroke();
        this.skidCtx.restore();

        // Emit tire smoke particles
        this.particles.emitTireSmoke(rl.x, rl.y, car.vx, car.vy, car.skidIntensity);
        this.particles.emitTireSmoke(rr.x, rr.y, car.vx, car.vy, car.skidIntensity);
      }

      this.prevWheelPositions.set(car.id, { fl, fr, rl, rr });
    }
  }

  // ==========================================
  // DIRECTIONAL HEADLIGHTS
  // ==========================================
  private renderHeadlights(ctx: CanvasRenderingContext2D, car: CarState): void {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    const length = 26;
    const beamDistance = 320;
    const beamAngle = 0.42; // rad spread
    const headlightY = car.archetype === 'desert' ? 10 : 8;

    // Dual headlights: Left and Right beams
    for (const yOffset of [-headlightY, headlightY]) {
      const grad = ctx.createRadialGradient(length, yOffset, 5, length + beamDistance * 0.7, yOffset, beamDistance);
      grad.addColorStop(0, 'rgba(230, 245, 255, 0.35)');
      grad.addColorStop(0.3, 'rgba(180, 230, 255, 0.12)');
      grad.addColorStop(1, 'rgba(180, 230, 255, 0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(length, yOffset);
      ctx.arc(length, yOffset, beamDistance, -beamAngle / 2, beamAngle / 2);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  // ==========================================
  // CAR RENDERING (TOP-DOWN ARCHETYPES)
  // ==========================================
  public renderCar(ctx: CanvasRenderingContext2D, car: CarState): void {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    // 1. Draw Active Kinetic Deflector Shield Bubble
    if (car.shieldActive) {
      this.renderShieldBubble(ctx, car);
    }

    // 2. Draw Ram Overdrive Aura
    if (car.ramActive) {
      this.renderRamAura(ctx, car);
    }

    // 3. Draw Wheels with Dynamic Steering on Front Wheels
    this.renderCarWheels(ctx, car);

    // 4. Render Archetype Chassis
    switch (car.archetype) {
      case 'desert':
        this.renderDesertCar(ctx, car);
        break;
      case 'rally':
        this.renderRallyCar(ctx, car);
        break;
      case 'apex':
        this.renderApexCar(ctx, car);
        break;
      case 'titan':
        this.renderTitanCar(ctx, car);
        break;
      case 'stadium':
      default:
        this.renderStadiumCar(ctx, car);
        break;
    }

    // 5. Draw EMP Ionization Disruptor Effect on Car
    if (car.empDisrupted) {
      this.renderEMPEffect(ctx, car);
    }

    ctx.restore();
  }

  private renderCarWheels(ctx: CanvasRenderingContext2D, car: CarState): void {
    const halfL = car.archetype === 'desert' || car.archetype === 'titan' ? 20 : car.archetype === 'stadium' || car.archetype === 'apex' ? 22 : 16;
    const halfW = car.archetype === 'desert' || car.archetype === 'titan' ? 14 : car.archetype === 'stadium' || car.archetype === 'apex' ? 13 : 11;
    const wheelW = car.archetype === 'desert' || car.archetype === 'titan' ? 12 : 10;
    const wheelH = car.archetype === 'desert' || car.archetype === 'titan' ? 6 : 5;
    const steerAngle = (car.steer || 0) * 0.42;

    const drawWheel = (x: number, y: number, angle: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      // Tire rubber
      ctx.fillStyle = '#11141c';
      ctx.fillRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
      // Rim highlight
      ctx.strokeStyle = car.handbrake || (car.throttle && car.throttle < -0.1) ? '#ff3a00' : '#445066';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-wheelW / 2, -wheelH / 2, wheelW, wheelH);
      ctx.restore();
    };

    // Front steered wheels
    drawWheel(halfL, -halfW, steerAngle);
    drawWheel(halfL, halfW, steerAngle);

    // Rear straight wheels
    drawWheel(-halfL, -halfW, 0);
    drawWheel(-halfL, halfW, 0);

    // Exhaust flames if accelerating or boosting
    if ((car.throttle && car.throttle > 0.05) || car.boostActive) {
      const isBoosting = car.boostActive;
      if (car.archetype === 'desert') {
        // Dual side exhaust tips
        this.particles.emitExhaust(car.x, car.y, car.angle, isBoosting, car.archetype);
      } else {
        // Rear tailpipes
        const backX = car.x - Math.cos(car.angle) * halfL;
        const backY = car.y - Math.sin(car.angle) * halfL;
        this.particles.emitExhaust(backX, backY, car.angle, isBoosting, car.archetype);
      }
    }
  }

  /**
   * Stadium Spec: Sleek aerodynamic formula single-seater
   * Front/rear spoilers, exposed suspension wishbones, glowing neon cockpit.
   */
  private renderStadiumCar(ctx: CanvasRenderingContext2D, _car: CarState): void {
    // 1. Suspension wishbones (exposed open-wheel rods)
    ctx.strokeStyle = '#60728c';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(22, -13);
    ctx.moveTo(12, 0);
    ctx.lineTo(22, 13);
    ctx.moveTo(-10, 0);
    ctx.lineTo(-22, -13);
    ctx.moveTo(-10, 0);
    ctx.lineTo(-22, 13);
    ctx.stroke();

    // 2. Wide front splitter / wing with endplates
    ctx.fillStyle = '#0a101a';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(23, -16, 5, 32);
    ctx.strokeRect(23, -16, 5, 32);

    // 3. Central Formula monocoque chassis (needle nose tapering forward)
    ctx.fillStyle = '#0b1626';
    ctx.beginPath();
    ctx.moveTo(27, 0); // nose tip
    ctx.lineTo(12, -7);
    ctx.lineTo(-6, -11); // sidepod
    ctx.lineTo(-22, -9);
    ctx.lineTo(-26, 0); // tail
    ctx.lineTo(-22, 9);
    ctx.lineTo(-6, 11); // sidepod
    ctx.lineTo(12, 7);
    ctx.closePath();
    ctx.fill();

    // Electric Cyan Livery Stripe
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 10;
    ctx.stroke();

    // 4. Glowing Neon Cockpit / Halo Ring
    ctx.fillStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(3, 0, 8, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Driver helmet visor
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(4, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Dual-tier rear elevated spoiler
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#07101c';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.fillRect(-28, -15, 6, 30);
    ctx.strokeRect(-28, -15, 6, 30);

    // Center rear LED rain light
    ctx.fillStyle = '#ff0055';
    ctx.shadowColor = '#ff0055';
    ctx.shadowBlur = 6;
    ctx.fillRect(-29, -2, 2, 4);
  }

  /**
   * Desert Spec: Wide muscle body with exposed engine blower,
   * racing stripes, and dual side exhaust pipes.
   */
  private renderDesertCar(ctx: CanvasRenderingContext2D, _car: CarState): void {
    // 1. Heavy muscular body shell
    ctx.fillStyle = '#1c0c07';
    ctx.beginPath();
    ctx.roundRect(-27, -14, 54, 28, 4);
    ctx.fill();

    // Main blazing orange body
    ctx.fillStyle = '#ff4b1f';
    ctx.strokeStyle = '#ffa200';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff4b1f';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(-25, -13, 50, 26, 3);
    ctx.fill();
    ctx.stroke();

    // 2. Bold black racing stripes down the center
    ctx.fillStyle = '#11131a';
    ctx.fillRect(-25, -4, 50, 2.8);
    ctx.fillRect(-25, 1.2, 50, 2.8);

    // 3. Exposed engine blower / supercharger scoop on hood
    ctx.fillStyle = '#222833';
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.2;
    ctx.shadowBlur = 0;
    ctx.fillRect(8, -5, 10, 10);
    ctx.strokeRect(8, -5, 10, 10);

    // 3 red butterfly intake valves
    ctx.fillStyle = '#ff0033';
    ctx.beginPath();
    ctx.arc(17, -3, 1.8, 0, Math.PI * 2);
    ctx.arc(17, 0, 1.8, 0, Math.PI * 2);
    ctx.arc(17, 3, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // 4. Tinted cabin glass & rollcage
    ctx.fillStyle = 'rgba(10, 15, 25, 0.9)';
    ctx.fillRect(-14, -9, 18, 18);

    // Rollcage bars inside
    ctx.strokeStyle = '#ff8c00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-12, -8);
    ctx.lineTo(2, 8);
    ctx.moveTo(-12, 8);
    ctx.lineTo(2, -8);
    ctx.stroke();

    // 5. Heavy steel front push-bar bumper
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(27, -10);
    ctx.lineTo(27, 10);
    ctx.stroke();

    // 6. Side exhaust pipes
    ctx.fillStyle = '#8c94a6';
    ctx.fillRect(0, -15, 8, 2.5);
    ctx.fillRect(0, 12.5, 8, 2.5);

    // Quad fiery tail lights
    ctx.fillStyle = '#ff1100';
    ctx.shadowColor = '#ff1100';
    ctx.shadowBlur = 6;
    ctx.fillRect(-27, -11, 2, 4);
    ctx.fillRect(-27, 7, 2, 4);
  }

  /**
   * Rally Spec: Compact rally hatchback with roof scoop,
   * rollcage, and aggressive mudflaps.
   */
  private renderRallyCar(ctx: CanvasRenderingContext2D, _car: CarState): void {
    // 1. Mudflaps trailing behind wheels
    ctx.fillStyle = '#ff0033';
    ctx.fillRect(-22, -14, 4, 3);
    ctx.fillRect(-22, 11, 4, 3);

    // 2. Compact hot-hatch body shell
    ctx.fillStyle = '#08170d';
    ctx.beginPath();
    ctx.roundRect(-22, -12, 44, 24, 5);
    ctx.fill();

    // Electric lime bodywork
    ctx.fillStyle = '#39ff14';
    ctx.strokeStyle = '#00ffaa';
    ctx.lineWidth = 1.8;
    ctx.shadowColor = '#39ff14';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(-20, -11, 40, 22, 4);
    ctx.fill();
    ctx.stroke();

    // Dark carbon roof & window band
    ctx.fillStyle = '#0d1a16';
    ctx.fillRect(-12, -8, 22, 16);

    // Rollcage visible through windshield
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-10, -7);
    ctx.lineTo(8, 7);
    ctx.moveTo(-10, 7);
    ctx.lineTo(8, -7);
    ctx.stroke();

    // 3. Aerodynamic roof air scoop
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 1.2;
    ctx.fillRect(-3, -3, 8, 6);
    ctx.strokeRect(-3, -3, 8, 6);

    // 4. Quad rally fog pods on front grille
    ctx.fillStyle = '#ffff66';
    ctx.shadowColor = '#ffff66';
    ctx.shadowBlur = 6;
    for (const y of [-7, -2.5, 2.5, 7]) {
      ctx.beginPath();
      ctx.arc(21, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Rally rear roof spoiler
    ctx.fillStyle = '#0b1f14';
    ctx.strokeStyle = '#39ff14';
    ctx.lineWidth = 2;
    ctx.fillRect(-24, -10, 4, 20);
    ctx.strokeRect(-24, -10, 4, 20);
  }

  /**
   * Apex Spec: Sleek futuristic Aero-GT hypercar with swept winglets,
   * violet glowing canopy visor, and dual jet turbines.
   */
  private renderApexCar(ctx: CanvasRenderingContext2D, _car: CarState): void {
    // 1. Swept-back active aero winglets
    ctx.fillStyle = '#100518';
    ctx.strokeStyle = '#d000ff';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#d000ff';
    ctx.shadowBlur = 8;
    // Upper winglet
    ctx.beginPath();
    ctx.moveTo(-4, -9);
    ctx.lineTo(8, -19);
    ctx.lineTo(2, -19);
    ctx.lineTo(-14, -9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Lower winglet
    ctx.beginPath();
    ctx.moveTo(-4, 9);
    ctx.lineTo(8, 19);
    ctx.lineTo(2, 19);
    ctx.lineTo(-14, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 2. Sleek aerodynamic hypercar body
    ctx.fillStyle = '#180726';
    ctx.strokeStyle = '#d000ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(30, 0); // nose tip
    ctx.lineTo(16, -6);
    ctx.lineTo(-4, -10);
    ctx.lineTo(-24, -8);
    ctx.lineTo(-28, 0);
    ctx.lineTo(-24, 8);
    ctx.lineTo(-4, 10);
    ctx.lineTo(16, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 3. Canopy with glowing magenta visor
    ctx.fillStyle = '#d000ff';
    ctx.shadowColor = '#ff00ff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(2, 0, 10, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 4. Dual rear jet turbine exhaust nozzles (violet plasma glow)
    ctx.fillStyle = '#e040fb';
    ctx.fillRect(-31, -7, 4, 4);
    ctx.fillRect(-31, 3, 4, 4);

    // 5. Rear aerodynamic GT wing
    ctx.fillStyle = '#0f0518';
    ctx.strokeStyle = '#d000ff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-27, -15, 5, 30);
    ctx.strokeRect(-27, -15, 5, 30);
  }

  /**
   * Titan Spec: Heavy tactical police interceptor cruiser with wrap-around
   * steel bull-bar and overhead emergency red/blue strobe lightbar.
   */
  private renderTitanCar(ctx: CanvasRenderingContext2D, _car: CarState): void {
    // 1. Heavy armored cruiser body
    ctx.fillStyle = '#081426';
    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#0066ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(-27, -13, 54, 26, 3);
    ctx.fill();
    ctx.stroke();

    // 2. Heavy steel wrap-around push bumper / bull-bar on front
    ctx.fillStyle = '#404c60';
    ctx.strokeStyle = '#788ca6';
    ctx.lineWidth = 1.5;
    ctx.fillRect(27, -11, 4, 22);
    ctx.strokeRect(27, -11, 4, 22);
    // Rubber push bumper pads
    ctx.fillStyle = '#11141c';
    ctx.fillRect(30, -7, 2, 5);
    ctx.fillRect(30, 2, 2, 5);

    // 3. Armored cabin windscreen
    ctx.fillStyle = '#050c18';
    ctx.fillRect(-10, -9, 22, 18);

    // 4. Overhead emergency police LED strobe lightbar on roof
    // Lightbar base
    ctx.fillStyle = '#11141c';
    ctx.fillRect(-2, -9, 5, 18);
    // Red LED (upper)
    const flash = Math.sin(performance.now() * 0.02) > 0;
    ctx.fillStyle = flash ? '#ff0033' : '#440011';
    ctx.shadowColor = '#ff0033';
    ctx.shadowBlur = flash ? 12 : 2;
    ctx.fillRect(-1.5, -8, 4, 7);
    // Blue LED (lower)
    ctx.fillStyle = !flash ? '#0066ff' : '#001144';
    ctx.shadowColor = '#0066ff';
    ctx.shadowBlur = !flash ? 12 : 2;
    ctx.fillRect(-1.5, 1, 4, 7);
  }

  // ==========================================
  // STATUS EFFECTS (SHIELD / RAM / EMP)
  // ==========================================
  private renderShieldBubble(ctx: CanvasRenderingContext2D, car: CarState): void {
    const pulse = Math.sin(performance.now() * 0.008) * 0.15 + 0.85;
    const radius = (car.archetype === 'desert' ? 36 : 32) * pulse;

    ctx.save();
    ctx.strokeStyle = '#00f0ff';
    ctx.fillStyle = 'rgba(0, 240, 255, 0.14)';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 18;

    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Rotating hexagonal shield segments
    const angleOffset = performance.now() * 0.002;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = angleOffset + (i * Math.PI) / 3;
      const hx = Math.cos(a) * (radius * 0.85);
      const hy = Math.sin(a) * (radius * 0.85);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.stroke();
    ctx.restore();
  }

  private renderRamAura(ctx: CanvasRenderingContext2D, _car: CarState): void {
    const time = performance.now() * 0.015;
    ctx.save();
    ctx.strokeStyle = '#ff4b1f';
    ctx.lineWidth = 3;
    ctx.shadowColor = '#ff4b1f';
    ctx.shadowBlur = 20;

    // Shockwave rings projecting forward
    for (let i = 0; i < 3; i++) {
      const phase = ((time + i * 2) % 6) / 6;
      const x = 20 + phase * 25;
      const ySpread = 16 + phase * 18;
      ctx.globalAlpha = 1.0 - phase;
      ctx.beginPath();
      ctx.moveTo(x, -ySpread);
      ctx.lineTo(x + 10, 0);
      ctx.lineTo(x, ySpread);
      ctx.stroke();
    }
    ctx.restore();
  }

  private renderEMPEffect(ctx: CanvasRenderingContext2D, _car: CarState): void {
    ctx.save();
    ctx.strokeStyle = '#bc13fe';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#bc13fe';
    ctx.shadowBlur = 14;

    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const x1 = (Math.random() - 0.5) * 35;
      const y1 = (Math.random() - 0.5) * 20;
      const x2 = x1 + (Math.random() - 0.5) * 20;
      const y2 = y1 + (Math.random() - 0.5) * 20;
      ctx.moveTo(x1, y1);
      ctx.lineTo((x1 + x2) / 2 + (Math.random() - 0.5) * 8, (y1 + y2) / 2 + (Math.random() - 0.5) * 8);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==========================================
  // PROJECTILES RENDERING
  // ==========================================
  private renderProjectiles(ctx: CanvasRenderingContext2D, projectiles: Projectile[]): void {
    for (const proj of projectiles) {
      ctx.save();

      if (proj.type === 'bullet') {
        // Fast kinetic / plasma bolt
        ctx.translate(proj.x, proj.y);
        ctx.rotate(proj.angle);

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = proj.color || '#00f0ff';
        ctx.shadowBlur = 12;

        ctx.beginPath();
        ctx.roundRect(-8, -2, 16, 4, 2);
        ctx.fill();

        ctx.strokeStyle = proj.color || '#00f0ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else if (proj.type === 'rocket') {
        // Micro-rocket with fins and flame exhaust
        ctx.translate(proj.x, proj.y);
        ctx.rotate(proj.angle);

        ctx.fillStyle = '#222938';
        ctx.fillRect(-7, -3, 14, 6);

        // Nosecone
        ctx.fillStyle = '#ff4b1f';
        ctx.beginPath();
        ctx.moveTo(7, -3);
        ctx.lineTo(12, 0);
        ctx.lineTo(7, 3);
        ctx.closePath();
        ctx.fill();

        // Rocket fins
        ctx.fillStyle = '#00f0ff';
        ctx.fillRect(-7, -5, 3, 10);

        // Rocket trail emission
        this.particles.emitRocketTrail(proj.x, proj.y, proj.vx, proj.vy);
      } else if (proj.type === 'rail_beam') {
        // Electric rail beam (instantaneous piercing ray with jagged arcing branches)
        const sx = proj.startX ?? proj.x;
        const sy = proj.startY ?? proj.y;
        const ex = proj.endX ?? proj.x + Math.cos(proj.angle) * 1400;
        const ey = proj.endY ?? proj.y + Math.sin(proj.angle) * 1400;

        const fade = Math.max(0, 1.0 - proj.lifetime / proj.maxLifetime);
        ctx.globalAlpha = fade;

        // Outer glow
        ctx.strokeStyle = proj.color || '#39ff14';
        ctx.shadowColor = proj.color || '#39ff14';
        ctx.shadowBlur = 20;
        ctx.lineWidth = 6 * fade;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.stroke();

        // Inner intense white core
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 * fade;
        ctx.shadowBlur = 6;
        ctx.stroke();

        // Random electric lightning branches
        const dist = Math.hypot(ex - sx, ey - sy);
        const steps = Math.floor(dist / 60);
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 1.5 * fade;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (let i = 1; i < steps; i++) {
          const t = i / steps;
          const px = sx + (ex - sx) * t + (Math.random() - 0.5) * 16;
          const py = sy + (ey - sy) * t + (Math.random() - 0.5) * 16;
          ctx.lineTo(px, py);
        }
        ctx.lineTo(ex, ey);
        ctx.stroke();
      } else if (proj.type === 'mine') {
        // Deployable Caltrop Landmine
        ctx.translate(proj.x, proj.y);

        // Proximity detection ring
        ctx.strokeStyle = 'rgba(255, 40, 40, 0.18)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 45, 0, Math.PI * 2);
        ctx.stroke();

        // 4-pointed metallic spiked body
        ctx.fillStyle = '#1c212e';
        ctx.strokeStyle = '#5a667d';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          const spX = Math.cos(a) * 9;
          const spY = Math.sin(a) * 9;
          if (i === 0) ctx.moveTo(spX, spY);
          else ctx.lineTo(spX, spY);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Central blinking red LED (blinks rapidly when armed)
        const isArmed = proj.isArmed ?? true;
        const blinkSpeed = isArmed ? 0.015 : 0.006;
        const isLEDOn = Math.sin(performance.now() * blinkSpeed) > 0;

        ctx.fillStyle = isLEDOn ? '#ff0033' : '#440011';
        ctx.shadowColor = '#ff0033';
        ctx.shadowBlur = isLEDOn ? 12 : 2;
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (proj.type === 'emp_cloud') {
        // Expanding EMP Ionization Smoke Screen
        const currentRadius = proj.cloudRadius ?? 120;
        const fade = Math.max(0, 1.0 - proj.lifetime / proj.maxLifetime);

        ctx.globalAlpha = fade * 0.7;
        const grad = ctx.createRadialGradient(proj.x, proj.y, 5, proj.x, proj.y, currentRadius);
        grad.addColorStop(0, 'rgba(188, 19, 254, 0.45)');
        grad.addColorStop(0.5, 'rgba(0, 240, 255, 0.25)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, currentRadius, 0, Math.PI * 2);
        ctx.fill();

        // Emit electric sparks inside the EMP cloud
        if (Math.random() > 0.4) {
          const sparkAngle = Math.random() * Math.PI * 2;
          const sparkDist = Math.random() * currentRadius * 0.8;
          this.particles.emitEMPSpark(
            proj.x + Math.cos(sparkAngle) * sparkDist,
            proj.y + Math.sin(sparkAngle) * sparkDist
          );
        }
      } else if (proj.type === 'decoy') {
        // Holographic Decoy ghost drone
        ctx.save();
        ctx.translate(proj.x, proj.y);
        ctx.rotate(proj.angle);
        const fade = Math.max(0, 1.0 - proj.lifetime / proj.maxLifetime);
        ctx.globalAlpha = fade * (0.6 + Math.sin(performance.now() * 0.02) * 0.2);
        ctx.strokeStyle = proj.color || '#d000ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#d000ff';
        ctx.shadowBlur = 15;
        ctx.strokeRect(-16, -10, 32, 20);
        ctx.fillStyle = 'rgba(208, 0, 255, 0.25)';
        ctx.fillRect(-16, -10, 32, 20);
        ctx.restore();
      }

      ctx.restore();
    }
  }
}
