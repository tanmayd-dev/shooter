import { GunShot, HitSound, ExplosionSound } from '../audio/sfx.ts';
import { ParticleSystem } from '../render/particles.ts';
import type { CarState, Projectile, StadiumTrack } from '../types.ts';

let nextProjectileId = 1;

export interface WeaponFireResult {
  projectile: Projectile;
  recoil: { x: number; y: number };
}

/**
 * Fires the vehicle's fixed forward primary weapon.
 * Applies chassis recoil impulse: F_recoil = -k * u_fwd
 */
export function firePrimaryWeapon(
  car: CarState,
  particles: ParticleSystem
): WeaponFireResult | null {
  if (!car.isAlive || car.empDisrupted || car.primaryCooldown > 0) {
    return null;
  }

  const uFwdX = Math.cos(car.angle);
  const uFwdY = Math.sin(car.angle);

  // Front bumper offset
  const bumperDist = car.archetype === 'desert' || car.archetype === 'titan' ? 29 : car.archetype === 'stadium' || car.archetype === 'apex' ? 27 : 22;
  const spawnX = car.x + uFwdX * bumperDist;
  const spawnY = car.y + uFwdY * bumperDist;

  let speed = 1300;
  let damage = 14;
  let recoilK = 40;
  let cooldown = 0.12;
  let color = '#00f0ff';
  let radius = 4;
  let maxLife = 1.6;

  switch (car.archetype) {
    case 'desert':
      // Heavy autocannon: heavy punch, strong recoil
      speed = 1050;
      damage = 32;
      recoilK = 115;
      cooldown = 0.30;
      color = '#ff8c00';
      radius = 5.5;
      maxLife = 1.4;
      break;
    case 'rally':
      // Precision rail slug: supersonic kinetic bolt
      speed = 1750;
      damage = 25;
      recoilK = 65;
      cooldown = 0.22;
      color = '#39ff14';
      radius = 4;
      maxLife = 1.3;
      break;
    case 'apex':
      // Plasma Scatter Flak: high burst spread
      speed = 1150;
      damage = 38;
      recoilK = 60;
      cooldown = 0.36;
      color = '#d000ff';
      radius = 5.0;
      maxLife = 1.0;
      break;
    case 'titan':
      // Kinetic Taser Dart: electrifying precision bolt
      speed = 1200;
      damage = 18;
      recoilK = 45;
      cooldown = 0.28;
      color = '#0066ff';
      radius = 4.2;
      maxLife = 1.4;
      break;
    case 'stadium':
    default:
      // Rapid pulse blaster: fast cadence, light recoil
      speed = 1350;
      damage = 15;
      recoilK = 40;
      cooldown = 0.13;
      color = '#00f0ff';
      radius = 4;
      maxLife = 1.5;
      break;
  }

  car.primaryCooldown = cooldown;

  // Compute recoil impulse: F_recoil = -k * u_fwd
  const recoilX = -recoilK * uFwdX;
  const recoilY = -recoilK * uFwdY;

  // Apply recoil impulse to vehicle velocity based on chassis mass
  const massRatio =
    car.archetype === 'desert' ? 0.08 :
    car.archetype === 'titan' ? 0.09 :
    car.archetype === 'apex' ? 0.12 :
    car.archetype === 'rally' ? 0.14 :
    0.11;
  car.vx += recoilX * massRatio;
  car.vy += recoilY * massRatio;

  // Muzzle flash particle effect at the gun barrel
  particles.emitMuzzleFlash(spawnX, spawnY, car.angle, color);

  // Procedural audio trigger
  GunShot(car.archetype);

  // Combine vehicle velocity with bullet muzzle velocity
  const projectile: Projectile = {
    id: `proj_${nextProjectileId++}`,
    type: 'bullet',
    x: spawnX,
    y: spawnY,
    vx: car.vx * 0.35 + uFwdX * speed,
    vy: car.vy * 0.35 + uFwdY * speed,
    angle: car.angle,
    radius,
    damage,
    ownerId: car.id,
    lifetime: 0,
    maxLifetime: maxLife,
    color,
  };

  return { projectile, recoil: { x: recoilX, y: recoilY } };
}

/**
 * Updates physics, collisions, and damage for all active projectiles.
 */
export function updateProjectiles(
  projectiles: Projectile[],
  cars: CarState[],
  track: StadiumTrack,
  dt: number,
  particles: ParticleSystem,
  onImpact?: (x: number, y: number, trauma: number) => void,
  onKill?: (killerId: string, victimId: string, weapon: string) => void
): Projectile[] {
  const active: Projectile[] = [];

  for (const proj of projectiles) {
    proj.lifetime += dt;

    // Check expiration
    if (proj.lifetime >= proj.maxLifetime) {
      if (proj.type === 'mine' && !proj.detonated) {
        // Mine quietly expires or stays
        continue;
      }
      continue;
    }

    // Update position
    if (proj.type === 'bullet' || proj.type === 'rocket' || proj.type === 'decoy') {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
    } else if (proj.type === 'mine') {
      // Arm mine after 0.5s
      if (proj.lifetime >= 0.5) {
        proj.isArmed = true;
      }
    } else if (proj.type === 'emp_cloud') {
      // EMP cloud expands up to max radius
      const progress = Math.min(1.0, proj.lifetime / (proj.maxLifetime * 0.3));
      const maxR = proj.maxCloudRadius || 140;
      proj.cloudRadius = maxR * progress;
    }

function checkSegmentIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): boolean {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-6) return false;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function distToSegmentSq(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return (px - x1) * (px - x1) + (py - y1) * (py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const cx = x1 + t * dx;
  const cy = y1 + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

    // Collision detection against boundaries, walls, barriers, and ramps
    if (proj.type === 'bullet' || proj.type === 'rocket') {
      const prevX = proj.x - proj.vx * dt;
      const prevY = proj.y - proj.vy * dt;

      if (
        proj.x < 0 ||
        proj.x > track.width ||
        proj.y < 0 ||
        proj.y > track.height
      ) {
        particles.emitSparks(proj.x, proj.y, proj.angle + Math.PI, 6);
        continue;
      }

      let hitObstacle = false;

      // 1. Check outer stadium perimeter walls
      if (track.outerBorder && track.outerBorder.length > 2) {
        const pts = track.outerBorder;
        for (let i = 0; i < pts.length; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % pts.length];
          if (
            checkSegmentIntersection(prevX, prevY, proj.x, proj.y, p1.x, p1.y, p2.x, p2.y) ||
            distToSegmentSq(proj.x, proj.y, p1.x, p1.y, p2.x, p2.y) < (proj.radius + 6) * (proj.radius + 6)
          ) {
            hitObstacle = true;
            break;
          }
        }
      }

      // 2. Check inner island border walls
      if (!hitObstacle && track.innerBorder && track.innerBorder.length > 2) {
        const pts = track.innerBorder;
        for (let i = 0; i < pts.length; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % pts.length];
          if (
            checkSegmentIntersection(prevX, prevY, proj.x, proj.y, p1.x, p1.y, p2.x, p2.y) ||
            distToSegmentSq(proj.x, proj.y, p1.x, p1.y, p2.x, p2.y) < (proj.radius + 6) * (proj.radius + 6)
          ) {
            hitObstacle = true;
            break;
          }
        }
      }

      // 3. Check track chicane barriers
      if (!hitObstacle && track.barriers) {
        for (const b of track.barriers) {
          const dx = Math.abs(proj.x - b.x);
          const dy = Math.abs(proj.y - b.y);
          if (dx < b.width / 2 + proj.radius && dy < b.height / 2 + proj.radius) {
            hitObstacle = true;
            break;
          }
        }
      }

      // 4. Check track ramps (solid concrete incline barriers)
      if (!hitObstacle && track.ramps) {
        for (const r of track.ramps) {
          const dx = proj.x - r.x;
          const dy = proj.y - r.y;
          const cosR = Math.cos(-r.angle);
          const sinR = Math.sin(-r.angle);
          const localX = dx * cosR - dy * sinR;
          const localY = dx * sinR + dy * cosR;
          if (
            Math.abs(localX) <= r.length / 2 + proj.radius &&
            Math.abs(localY) <= r.width / 2 + proj.radius
          ) {
            hitObstacle = true;
            break;
          }
        }
      }

      if (hitObstacle) {
        if (proj.type === 'rocket') {
          particles.emitExplosion(proj.x, proj.y, 0.9);
          ExplosionSound();
          if (onImpact) onImpact(proj.x, proj.y, 0.4);
        } else {
          particles.emitSparks(proj.x, proj.y, proj.angle + Math.PI, 8);
          HitSound();
        }
        continue;
      }
    }

    // Collision detection against cars
    let hitCar = false;
    for (const car of cars) {
      if (!car.isAlive) continue;

      // Projectiles cannot hit their owner immediately (unless landmine after arming)
      if (proj.ownerId === car.id && proj.type !== 'mine' && proj.lifetime < 0.25) {
        continue;
      }
      if (proj.type === 'decoy') {
        continue;
      }

      const carRadius = car.archetype === 'desert' || car.archetype === 'titan' ? 24 : car.archetype === 'stadium' || car.archetype === 'apex' ? 21 : 18;
      const dist = Math.hypot(car.x - proj.x, car.y - proj.y);

      if (proj.type === 'emp_cloud') {
        const cloudR = proj.cloudRadius ?? 120;
        if (dist < cloudR + carRadius && proj.ownerId !== car.id) {
          // Disrupt car inside EMP smoke
          car.empDisrupted = true;
          car.empDuration = 1.2;
        }
        continue;
      }

      if (dist < carRadius + proj.radius) {
        hitCar = true;

        if (proj.type === 'mine') {
          if (!proj.isArmed) continue;
          // Detonate mine
          particles.emitExplosion(proj.x, proj.y, 1.2);
          ExplosionSound();
          if (onImpact) onImpact(proj.x, proj.y, 0.6);

          applyDamageToCar(car, proj.damage, proj.ownerId, 'CALTROP MINE', cars, onKill);
          // Spin car out
          car.angularVelocity += (Math.random() > 0.5 ? 1 : -1) * 6.5;
          car.vx *= 0.4;
          car.vy *= 0.4;
          break;
        } else if (proj.type === 'rocket') {
          particles.emitExplosion(proj.x, proj.y, 1.1);
          ExplosionSound();
          if (onImpact) onImpact(proj.x, proj.y, 0.5);

          applyDamageToCar(car, proj.damage, proj.ownerId, 'ROCKET SALVO', cars, onKill);
          // Kinetic impulse
          car.vx += proj.vx * 0.2;
          car.vy += proj.vy * 0.2;
          break;
        } else if (proj.type === 'bullet') {
          particles.emitSparks(proj.x, proj.y, proj.angle + Math.PI, 10);
          HitSound();
          if (onImpact) onImpact(proj.x, proj.y, 0.15);

          const weaponName =
            proj.color === '#d000ff' || proj.damage === 38 ? 'PLASMA SCATTER FLAK' :
            proj.color === '#0066ff' || proj.damage === 18 ? 'KINETIC TASER DART' :
            proj.damage >= 30 ? 'HEAVY AUTOCANNON' :
            proj.damage >= 22 ? 'RAIL SLUG' :
            'PULSE BLASTER';
          applyDamageToCar(car, proj.damage, proj.ownerId, weaponName, cars, onKill);

          // Kinetic push
          car.vx += proj.vx * 0.05;
          car.vy += proj.vy * 0.05;
          break;
        }
      }
    }

    if (hitCar && proj.type !== 'emp_cloud' && proj.type !== 'decoy') {
      continue;
    }

    active.push(proj);
  }

  return active;
}

/**
 * Applies damage to a car, respecting active kinetic shields, armor reduction, and frags.
 */
export function applyDamageToCar(
  car: CarState,
  rawDamage: number,
  attackerId: string,
  weaponName: string,
  allCars: CarState[],
  onKill?: (killerId: string, victimId: string, weapon: string) => void
): void {
  // Kinetic Deflector Shield absorbs 100% of damage
  if (car.shieldActive) {
    HitSound();
    return;
  }

  // Ram Overdrive grants 70% damage reduction
  const effectiveDamage = car.ramActive ? rawDamage * 0.3 : rawDamage;

  car.health -= effectiveDamage;

  if (car.health <= 0) {
    car.health = 0;
    car.isAlive = false;
    car.deaths += 1;
    car.respawnTimer = 3.5;

    // Credit attacker
    const attacker = allCars.find((c) => c.id === attackerId);
    if (attacker && attacker.id !== car.id) {
      attacker.kills += 1;
      attacker.score += 100;
    }

    if (onKill) {
      const killerName = attacker ? attacker.name : 'WORLD';
      onKill(killerName, car.name, weaponName);
    }
  }
}
