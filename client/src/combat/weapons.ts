import { GunShot, HitSound, ExplosionSound } from '../audio/sfx';
import { ParticleSystem } from '../render/particles';
import { CarState, Projectile, StadiumTrack } from '../types';

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
  const bumperDist = car.archetype === 'desert' ? 29 : car.archetype === 'stadium' ? 27 : 22;
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
  const massRatio = car.archetype === 'desert' ? 0.08 : car.archetype === 'rally' ? 0.14 : 0.11;
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
    if (proj.type === 'bullet' || proj.type === 'rocket') {
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

    // Collision detection against boundaries
    if (proj.type === 'bullet' || proj.type === 'rocket') {
      if (
        proj.x < 0 ||
        proj.x > track.width ||
        proj.y < 0 ||
        proj.y > track.height
      ) {
        particles.emitSparks(proj.x, proj.y, proj.angle + Math.PI, 6);
        continue;
      }

      // Check collision against track barriers
      let hitBarrier = false;
      for (const b of track.barriers) {
        const dx = Math.abs(proj.x - b.x);
        const dy = Math.abs(proj.y - b.y);
        if (dx < b.width / 2 + proj.radius && dy < b.height / 2 + proj.radius) {
          hitBarrier = true;
          if (proj.type === 'rocket') {
            particles.emitExplosion(proj.x, proj.y, 0.9);
            ExplosionSound();
            if (onImpact) onImpact(proj.x, proj.y, 0.4);
          } else {
            particles.emitSparks(proj.x, proj.y, proj.angle + Math.PI, 8);
            HitSound();
          }
          break;
        }
      }
      if (hitBarrier) continue;
    }

    // Collision detection against cars
    let hitCar = false;
    for (const car of cars) {
      if (!car.isAlive) continue;

      // Projectiles cannot hit their owner immediately (unless landmine after arming)
      if (proj.ownerId === car.id && proj.type !== 'mine' && proj.lifetime < 0.25) {
        continue;
      }

      const carRadius = car.archetype === 'desert' ? 24 : car.archetype === 'stadium' ? 21 : 18;
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
            proj.damage >= 30 ? 'HEAVY AUTOCANNON' : proj.damage >= 22 ? 'RAIL SLUG' : 'PULSE BLASTER';
          applyDamageToCar(car, proj.damage, proj.ownerId, weaponName, cars, onKill);

          // Kinetic push
          car.vx += proj.vx * 0.05;
          car.vy += proj.vy * 0.05;
          break;
        }
      }
    }

    if (hitCar && proj.type !== 'emp_cloud') {
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
