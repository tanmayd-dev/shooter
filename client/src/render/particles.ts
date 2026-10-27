import type { CarArchetype } from '../types.ts';

export type ParticleType =
  | 'tire_smoke'
  | 'exhaust_flame'
  | 'spark'
  | 'muzzle_flash'
  | 'rocket_smoke'
  | 'debris'
  | 'emp_spark'
  | 'shockwave';

export interface Particle {
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // elapsed seconds
  maxLife: number; // duration
  size: number;
  startSize: number;
  endSize: number;
  color: string;
  endColor?: string;
  alpha: number;
  startAlpha: number;
  rotation: number;
  rotationSpeed: number;
  // Specific properties
  shockwaveMaxRadius?: number;
  shockwaveWidth?: number;
  debrisSides?: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private readonly maxParticles: number = 1200;

  public clear(): void {
    this.particles = [];
  }

  public update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;

      if (p.life >= p.maxLife) {
        // Swap with last element and pop for fast O(1) removal
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }

      // Physics integration
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.rotationSpeed * dt;

      // Friction / drag
      if (p.type === 'tire_smoke' || p.type === 'rocket_smoke') {
        p.vx *= 0.94;
        p.vy *= 0.94;
      } else if (p.type === 'debris' || p.type === 'spark') {
        p.vx *= 0.92;
        p.vy *= 0.92;
      }

      // Linear interpolation for size and alpha
      const progress = p.life / p.maxLife;
      p.size = p.startSize + (p.endSize - p.startSize) * progress;
      p.alpha = Math.max(0, p.startAlpha * (1.0 - progress));
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      ctx.save();

      if (p.type === 'shockwave') {
        const progress = p.life / p.maxLife;
        const currentRadius = (p.shockwaveMaxRadius || 80) * progress;
        ctx.globalAlpha = p.alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = (p.shockwaveWidth || 4) * (1.0 - progress * 0.7);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, currentRadius), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'spark') {
        ctx.globalAlpha = p.alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size);
        ctx.lineCap = 'round';
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);
        ctx.stroke();
      } else if (p.type === 'debris') {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      } else if (p.type === 'emp_spark') {
        ctx.globalAlpha = p.alpha;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        const midX = p.x + (Math.random() - 0.5) * 14;
        const midY = p.y + (Math.random() - 0.5) * 14;
        ctx.lineTo(midX, midY);
        ctx.lineTo(p.x + p.vx * 0.1, p.y + p.vy * 0.1);
        ctx.stroke();
      } else if (p.type === 'exhaust_flame') {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size), 0, Math.PI * 2);
        ctx.fill();
      } else {
        // tire_smoke, rocket_smoke, muzzle_flash
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, p.size), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // ==========================================
  // EMITTER HELPERS
  // ==========================================

  /**
   * Spawns tire smoke puffs behind skidding wheels.
   */
  public emitTireSmoke(x: number, y: number, vx: number, vy: number, intensity: number, color?: string): void {
    if (this.particles.length >= this.maxParticles) return;
    const count = Math.min(3, Math.ceil(intensity * 3));

    for (let i = 0; i < count; i++) {
      const spread = 6;
      this.particles.push({
        type: 'tire_smoke',
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: vx * 0.2 + (Math.random() - 0.5) * 20,
        vy: vy * 0.2 + (Math.random() - 0.5) * 20,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.35,
        startSize: 3 + Math.random() * 3,
        endSize: 12 + Math.random() * 10 * intensity,
        size: 3,
        color: color || 'rgba(210, 220, 240, 0.4)',
        alpha: 0.35 * intensity,
        startAlpha: 0.35 * intensity,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 2.5,
      });
    }
  }

  /**
   * Spawns dynamic exhaust flames from vehicle rear/side pipes.
   */
  public emitExhaust(
    x: number,
    y: number,
    carAngle: number,
    isBoosting: boolean,
    archetype: CarArchetype
  ): void {
    if (this.particles.length >= this.maxParticles) return;

    // Flame shoots backwards relative to car angle
    const backAngle = carAngle + Math.PI + (Math.random() - 0.5) * 0.28;
    const flameSpeed = isBoosting ? 260 + Math.random() * 120 : 130 + Math.random() * 80;

    let flameColor = '#ff6b00';
    if (isBoosting) {
      flameColor = archetype === 'stadium' ? '#00f0ff' : archetype === 'apex' ? '#d000ff' : archetype === 'titan' ? '#0066ff' : archetype === 'rally' ? '#bc13fe' : '#ff1361';
    } else if (archetype === 'stadium') {
      flameColor = '#00d2ff';
    } else if (archetype === 'desert') {
      flameColor = Math.random() > 0.4 ? '#ff3a00' : '#ffaa00';
    } else if (archetype === 'apex') {
      flameColor = '#d000ff';
    } else if (archetype === 'titan') {
      flameColor = '#0066ff';
    } else {
      flameColor = '#39ff14';
    }

    this.particles.push({
      type: 'exhaust_flame',
      x,
      y,
      vx: Math.cos(backAngle) * flameSpeed,
      vy: Math.sin(backAngle) * flameSpeed,
      life: 0,
      maxLife: isBoosting ? 0.18 : 0.1,
      startSize: isBoosting ? 6 : 4,
      endSize: isBoosting ? 1.5 : 1,
      size: 4,
      color: flameColor,
      alpha: 0.9,
      startAlpha: 0.9,
      rotation: 0,
      rotationSpeed: 0,
    });
  }

  /**
   * Spawns metallic sparks on impacts or wall scrapes.
   */
  public emitSparks(x: number, y: number, normalAngle: number, count: number = 8): void {
    const sparkCount = Math.min(count, 20);
    for (let i = 0; i < sparkCount; i++) {
      if (this.particles.length >= this.maxParticles) return;
      const spreadAngle = normalAngle + (Math.random() - 0.5) * Math.PI * 0.8;
      const speed = 120 + Math.random() * 280;

      this.particles.push({
        type: 'spark',
        x,
        y,
        vx: Math.cos(spreadAngle) * speed,
        vy: Math.sin(spreadAngle) * speed,
        life: 0,
        maxLife: 0.12 + Math.random() * 0.2,
        startSize: 2.2,
        endSize: 0.5,
        size: 2.2,
        color: Math.random() > 0.3 ? '#fff59d' : '#ff9800',
        alpha: 1.0,
        startAlpha: 1.0,
        rotation: 0,
        rotationSpeed: 0,
      });
    }
  }

  /**
   * Spawns muzzle flash at gun barrel.
   */
  public emitMuzzleFlash(x: number, y: number, angle: number, color: string = '#00f0ff'): void {
    if (this.particles.length >= this.maxParticles) return;

    this.particles.push({
      type: 'muzzle_flash',
      x: x + Math.cos(angle) * 4,
      y: y + Math.sin(angle) * 4,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.05,
      startSize: 14,
      endSize: 4,
      size: 14,
      color,
      alpha: 1.0,
      startAlpha: 1.0,
      rotation: angle,
      rotationSpeed: 0,
    });
  }

  /**
   * Spawns dense smoke/fire trail behind micro-rockets.
   */
  public emitRocketTrail(x: number, y: number, vx: number, vy: number): void {
    if (this.particles.length >= this.maxParticles) return;

    this.particles.push({
      type: 'rocket_smoke',
      x,
      y,
      vx: -vx * 0.1 + (Math.random() - 0.5) * 15,
      vy: -vy * 0.1 + (Math.random() - 0.5) * 15,
      life: 0,
      maxLife: 0.35 + Math.random() * 0.2,
      startSize: 4,
      endSize: 14,
      size: 4,
      color: Math.random() > 0.4 ? 'rgba(255, 140, 0, 0.7)' : 'rgba(180, 190, 210, 0.4)',
      alpha: 0.7,
      startAlpha: 0.7,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 3,
    });
  }

  /**
   * Spawns an explosion: shockwave, fire core, debris, and sparks.
   */
  public emitExplosion(x: number, y: number, scale: number = 1.0): void {
    // 1. Shockwave ring
    this.emitShockwave(x, y, 90 * scale, '#ff8c00');

    // 2. Fire & smoke blast
    const fireCount = Math.floor(18 * scale);
    for (let i = 0; i < fireCount; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 180 * scale;
      this.particles.push({
        type: 'tire_smoke',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.35,
        startSize: 8 * scale,
        endSize: (26 + Math.random() * 18) * scale,
        size: 8 * scale,
        color: Math.random() > 0.4 ? '#ff4b1f' : '#ffa500',
        alpha: 0.85,
        startAlpha: 0.85,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 4,
      });
    }

    // 3. Flying wreckage debris
    const debrisCount = Math.floor(12 * scale);
    for (let i = 0; i < debrisCount; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 260 * scale;
      this.particles.push({
        type: 'debris',
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.6 + Math.random() * 0.5,
        startSize: (3 + Math.random() * 4) * scale,
        endSize: 2 * scale,
        size: 3 * scale,
        color: Math.random() > 0.5 ? '#333b4d' : '#ff4b1f',
        alpha: 1.0,
        startAlpha: 1.0,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 12,
      });
    }

    // 4. Hot sparks
    this.emitSparks(x, y, 0, 16);
  }

  /**
   * Spawns expanding neon shockwave ring.
   */
  public emitShockwave(x: number, y: number, maxRadius: number = 80, color: string = '#00f0ff'): void {
    if (this.particles.length >= this.maxParticles) return;

    this.particles.push({
      type: 'shockwave',
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 0.35,
      startSize: 4,
      endSize: maxRadius,
      size: 4,
      color,
      alpha: 0.95,
      startAlpha: 0.95,
      rotation: 0,
      rotationSpeed: 0,
      shockwaveMaxRadius: maxRadius,
      shockwaveWidth: 5,
    });
  }

  /**
   * Spawns electric lightning sparks for the Rally EMP cloud.
   */
  public emitEMPSpark(x: number, y: number): void {
    if (this.particles.length >= this.maxParticles) return;

    this.particles.push({
      type: 'emp_spark',
      x,
      y,
      vx: (Math.random() - 0.5) * 40,
      vy: (Math.random() - 0.5) * 40,
      life: 0,
      maxLife: 0.12 + Math.random() * 0.1,
      startSize: 1.5,
      endSize: 1,
      size: 1.5,
      color: Math.random() > 0.5 ? '#bc13fe' : '#00f0ff',
      alpha: 0.95,
      startAlpha: 0.95,
      rotation: 0,
      rotationSpeed: 0,
    });
  }
}
