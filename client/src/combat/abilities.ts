import { BoostPadWhoosh, SpecialWeaponSound } from '../audio/sfx.ts';
import { ParticleSystem } from '../render/particles.ts';
import type { CarState, Projectile } from '../types.ts';
import { applyDamageToCar } from './weapons.ts';

let nextAbilityProjId = 1000;

export interface AbilityActivationResult {
  newProjectiles: Projectile[];
}

/**
 * Trigger Special Weapon (`S` key):
 * - Stadium: Micro-rocket salvo (3 projectiles with slight spread)
 * - Desert: Ram Overdrive (grants temporary armor shield and speed impulse for collision damage)
 * - Rally: Overcharge Rail Beam (instant high-speed piercing ray)
 */
export function activateSpecialAbility(
  car: CarState,
  allCars: CarState[],
  particles: ParticleSystem,
  onImpact?: (x: number, y: number, trauma: number) => void,
  onKill?: (killerId: string, victimId: string, weapon: string) => void,
  allProjectiles?: Projectile[]
): AbilityActivationResult | null {
  if (!car.isAlive || car.empDisrupted || car.specialCooldown > 0) {
    return null;
  }

  const newProjectiles: Projectile[] = [];

  switch (car.archetype) {
    case 'stadium': {
      // Micro-Rocket Salvo: 3 rockets with slight spread angles
      car.specialCooldown = 6.0;
      car.specialMaxCooldown = 6.0;
      SpecialWeaponSound('stadium');

      const spreads = [-0.08, 0, 0.08];
      const speed = 1150;
      const frontDist = 26;

      for (const spread of spreads) {
        const fireAngle = car.angle + spread;
        const uX = Math.cos(fireAngle);
        const uY = Math.sin(fireAngle);

        newProjectiles.push({
          id: `rocket_${nextAbilityProjId++}`,
          type: 'rocket',
          x: car.x + uX * frontDist,
          y: car.y + uY * frontDist,
          vx: car.vx * 0.4 + uX * speed,
          vy: car.vy * 0.4 + uY * speed,
          angle: fireAngle,
          radius: 6,
          damage: 42,
          ownerId: car.id,
          lifetime: 0,
          maxLifetime: 2.2,
          color: '#ff4b1f',
        });
      }

      // Small recoil
      car.vx -= Math.cos(car.angle) * 45;
      car.vy -= Math.sin(car.angle) * 45;
      break;
    }

    case 'desert': {
      // Ram Overdrive: temporary armor shield + speed impulse for collision devastation
      car.specialCooldown = 8.0;
      car.specialMaxCooldown = 8.0;
      car.ramActive = true;
      car.ramDuration = 3.5;
      SpecialWeaponSound('desert');

      // Forward speed surge
      const boostSpeed = 420;
      car.vx += Math.cos(car.angle) * boostSpeed;
      car.vy += Math.sin(car.angle) * boostSpeed;

      // Shockwave visual
      particles.emitShockwave(car.x, car.y, 110, '#ff4b1f');
      if (onImpact) onImpact(car.x, car.y, 0.45);
      break;
    }

    case 'rally': {
      // Overcharge Rail Beam: instantaneous piercing ray
      car.specialCooldown = 7.0;
      car.specialMaxCooldown = 7.0;
      SpecialWeaponSound('rally');

      const uX = Math.cos(car.angle);
      const uY = Math.sin(car.angle);
      const beamLength = 1400;
      const startX = car.x + uX * 24;
      const startY = car.y + uY * 24;
      const endX = startX + uX * beamLength;
      const endY = startY + uY * beamLength;

      // Piercing hitscan damage check against enemies along beam line
      for (const target of allCars) {
        if (!target.isAlive || target.id === car.id) continue;

        // Point-to-line segment distance
        const t = Math.max(
          0,
          Math.min(
            1,
            ((target.x - startX) * uX + (target.y - startY) * uY) / beamLength
          )
        );
        const projX = startX + uX * beamLength * t;
        const projY = startY + uY * beamLength * t;
        const dist = Math.hypot(target.x - projX, target.y - projY);

        if (dist < 32) {
          applyDamageToCar(target, 65, car.id, 'OVERCHARGE RAIL BEAM', allCars, onKill);
          particles.emitExplosion(target.x, target.y, 0.8);
        }
      }

      // Visual beam projectile
      newProjectiles.push({
        id: `beam_${nextAbilityProjId++}`,
        type: 'rail_beam',
        x: startX,
        y: startY,
        startX,
        startY,
        endX,
        endY,
        vx: 0,
        vy: 0,
        angle: car.angle,
        radius: 12,
        damage: 65,
        ownerId: car.id,
        lifetime: 0,
        maxLifetime: 0.35,
        color: '#39ff14',
      });

      // Recoil
      car.vx -= uX * 85;
      car.vy -= uY * 85;
      if (onImpact) onImpact(car.x, car.y, 0.3);
      break;
    }

    case 'apex': {
      // Sonic Repulsor: Emits a 360° radial shockwave blast. Dealing 30 damage to enemies within 120px and pushing them away with radial impulse (vx += cos * 350, vy += sin * 350), deflects incoming rockets. car.specialCooldown = 5.0; car.specialMaxCooldown = 5.0; Emit shockwave particles with color '#d000ff'.
      car.specialCooldown = 5.0;
      car.specialMaxCooldown = 5.0;
      SpecialWeaponSound('apex');

      particles.emitShockwave(car.x, car.y, 120, '#d000ff');
      if (onImpact) onImpact(car.x, car.y, 0.4);

      for (const target of allCars) {
        if (!target.isAlive || target.id === car.id) continue;
        const dx = target.x - car.x;
        const dy = target.y - car.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= 120 && dist > 0.001) {
          const cos = dx / dist;
          const sin = dy / dist;
          target.vx += cos * 350;
          target.vy += sin * 350;
          applyDamageToCar(target, 30, car.id, 'SONIC REPULSOR', allCars, onKill);
          particles.emitExplosion(target.x, target.y, 0.6);
        }
      }

      if (allProjectiles) {
        for (const proj of allProjectiles) {
          if (proj.type === 'rocket' && proj.ownerId !== car.id) {
            const dx = proj.x - car.x;
            const dy = proj.y - car.y;
            const dist = Math.hypot(dx, dy);
            if (dist <= 120 && dist > 0.001) {
              const cos = dx / dist;
              const sin = dy / dist;
              const speed = Math.hypot(proj.vx, proj.vy) || 1150;
              proj.vx = cos * speed;
              proj.vy = sin * speed;
              proj.angle = Math.atan2(sin, cos);
              proj.ownerId = car.id;
            }
          }
        }
      }
      break;
    }

    case 'titan': {
      // Energy Siphon Ray: Channeled beam dealing 35 damage to the closest enemy in front within 500px, siphoning 35 HP back to Titan (car.health = Math.min(car.maxHealth, car.health + 35)). car.specialCooldown = 6.0; car.specialMaxCooldown = 6.0;
      car.specialCooldown = 6.0;
      car.specialMaxCooldown = 6.0;
      SpecialWeaponSound('titan');

      const uX = Math.cos(car.angle);
      const uY = Math.sin(car.angle);

      let closestEnemy: CarState | null = null;
      let closestDist = Infinity;

      for (const target of allCars) {
        if (!target.isAlive || target.id === car.id) continue;
        const dx = target.x - car.x;
        const dy = target.y - car.y;
        const dist = Math.hypot(dx, dy);
        const dot = dx * uX + dy * uY;
        if (dot > 0 && dist <= 500 && dist < closestDist) {
          closestDist = dist;
          closestEnemy = target;
        }
      }

      const startX = car.x + uX * 24;
      const startY = car.y + uY * 24;

      if (closestEnemy) {
        applyDamageToCar(closestEnemy, 35, car.id, 'ENERGY SIPHON RAY', allCars, onKill);
        car.health = Math.min(car.maxHealth, car.health + 35);
        particles.emitExplosion(closestEnemy.x, closestEnemy.y, 0.6);
        particles.emitShockwave(car.x, car.y, 40, '#0066ff');

        newProjectiles.push({
          id: `beam_${nextAbilityProjId++}`,
          type: 'rail_beam',
          x: startX,
          y: startY,
          startX,
          startY,
          endX: closestEnemy.x,
          endY: closestEnemy.y,
          vx: 0,
          vy: 0,
          angle: Math.atan2(closestEnemy.y - car.y, closestEnemy.x - car.x),
          radius: 10,
          damage: 35,
          ownerId: car.id,
          lifetime: 0,
          maxLifetime: 0.35,
          color: '#0066ff',
        });
      } else {
        newProjectiles.push({
          id: `beam_${nextAbilityProjId++}`,
          type: 'rail_beam',
          x: startX,
          y: startY,
          startX,
          startY,
          endX: startX + uX * 500,
          endY: startY + uY * 500,
          vx: 0,
          vy: 0,
          angle: car.angle,
          radius: 10,
          damage: 35,
          ownerId: car.id,
          lifetime: 0,
          maxLifetime: 0.3,
          color: '#0066ff',
        });
      }

      if (onImpact) onImpact(car.x, car.y, 0.3);
      break;
    }
  }

  return { newProjectiles };
}

/**
 * Trigger Mobility Ability (`D` key):
 * - Stadium: Air-Brake Drift Snap (snaps lateral slide to heading immediately)
 * - Desert: Twin-Turbo Burner (forward surge + boost flames)
 * - Rally: 180° Slide Pivot (reverses heading angle while preserving drift momentum)
 */
export function activateMobilityAbility(
  car: CarState,
  particles: ParticleSystem,
  allCars?: CarState[]
): boolean {
  if (!car.isAlive || car.empDisrupted || car.mobilityCooldown > 0) {
    return false;
  }

  switch (car.archetype) {
    case 'stadium': {
      // Air-Brake Drift Snap: instantly align velocity with car angle, 100% grip restore
      car.mobilityCooldown = 4.0;
      car.mobilityMaxCooldown = 4.0;
      BoostPadWhoosh();

      const speed = Math.hypot(car.vx, car.vy);
      car.vx = Math.cos(car.angle) * speed;
      car.vy = Math.sin(car.angle) * speed;
      car.angularVelocity = 0;
      car.skidIntensity = 0;

      particles.emitShockwave(car.x, car.y, 70, '#00f0ff');
      break;
    }

    case 'desert': {
      // Twin-Turbo Burner: rocket boost surge
      car.mobilityCooldown = 5.5;
      car.mobilityMaxCooldown = 5.5;
      car.boostActive = true;
      car.boostDuration = 2.0;
      BoostPadWhoosh();

      const boostSpeed = 380;
      car.vx += Math.cos(car.angle) * boostSpeed;
      car.vy += Math.sin(car.angle) * boostSpeed;

      particles.emitShockwave(car.x, car.y, 85, '#ff8c00');
      break;
    }

    case 'rally': {
      // 180° Slide Pivot: instant 180 flip
      car.mobilityCooldown = 4.5;
      car.mobilityMaxCooldown = 4.5;
      BoostPadWhoosh();

      car.angle = (car.angle + Math.PI) % (Math.PI * 2);
      particles.emitShockwave(car.x, car.y, 65, '#39ff14');
      break;
    }

    case 'apex': {
      // Aero Thruster Jump: Vertical leap into air (car.isAirborne = true; car.vz = 260;) + forward boost (car.vx += Math.cos(car.angle) * 220; car.vy += Math.sin(car.angle) * 220;). car.mobilityCooldown = 4.0; car.mobilityMaxCooldown = 4.0;
      car.mobilityCooldown = 4.0;
      car.mobilityMaxCooldown = 4.0;
      car.isAirborne = true;
      car.vz = 260;
      if ((car.z ?? 0) <= 0) car.z = 2;
      car.vx += Math.cos(car.angle) * 220;
      car.vy += Math.sin(car.angle) * 220;

      BoostPadWhoosh();
      particles.emitShockwave(car.x, car.y, 80, '#d000ff');
      break;
    }

    case 'titan': {
      // Gravity Harpoon Tether: Tethers closest enemy within 450px in front, pulling them back and reducing their speed by 50% for 2.0s (target.empDisrupted = true; target.empDuration = 2.0;). car.mobilityCooldown = 5.0; car.mobilityMaxCooldown = 5.0;
      car.mobilityCooldown = 5.0;
      car.mobilityMaxCooldown = 5.0;
      BoostPadWhoosh();

      const uX = Math.cos(car.angle);
      const uY = Math.sin(car.angle);

      if (allCars) {
        let closestEnemy: CarState | null = null;
        let closestDist = Infinity;

        for (const target of allCars) {
          if (!target.isAlive || target.id === car.id) continue;
          const dx = target.x - car.x;
          const dy = target.y - car.y;
          const dist = Math.hypot(dx, dy);
          const dot = dx * uX + dy * uY;
          if (dot > 0 && dist <= 450 && dist < closestDist) {
            closestDist = dist;
            closestEnemy = target;
          }
        }

        if (closestEnemy) {
          closestEnemy.vx *= 0.5;
          closestEnemy.vy *= 0.5;
          const pullDirX = (car.x - closestEnemy.x) / closestDist;
          const pullDirY = (car.y - closestEnemy.y) / closestDist;
          closestEnemy.vx += pullDirX * 220;
          closestEnemy.vy += pullDirY * 220;
          closestEnemy.empDisrupted = true;
          closestEnemy.empDuration = 2.0;

          particles.emitShockwave(closestEnemy.x, closestEnemy.y, 60, '#0066ff');
        }
      }

      particles.emitShockwave(car.x, car.y, 70, '#0066ff');
      break;
    }
  }

  return true;
}

/**
 * Trigger Tactical Gadget (`F` key):
 * - Stadium: Kinetic Deflector Shield (active barrier rendering around car)
 * - Desert: Caltrop Landmines (drop behind car)
 * - Rally: EMP Smoke Screen (expanding cloud lingering on track)
 * - Apex: Holographic Decoy (ghost decoy drone hazard)
 * - Titan: Disruptor EMP Pulse (radial burst setting empDisrupted)
 */
export function activateTacticalGadget(
  car: CarState,
  particles: ParticleSystem,
  allCars?: CarState[]
): AbilityActivationResult | null {
  if (!car.isAlive || car.empDisrupted || car.gadgetCooldown > 0) {
    return null;
  }

  const newProjectiles: Projectile[] = [];

  switch (car.archetype) {
    case 'stadium': {
      // Kinetic Deflector Shield
      car.gadgetCooldown = 10.0;
      car.gadgetMaxCooldown = 10.0;
      car.shieldActive = true;
      car.shieldDuration = 4.0;
      particles.emitShockwave(car.x, car.y, 60, '#00f0ff');
      break;
    }

    case 'desert': {
      // Caltrop Landmines: drop 2 mines behind vehicle
      car.gadgetCooldown = 9.0;
      car.gadgetMaxCooldown = 9.0;

      const rearDist = 28;
      const backX = car.x - Math.cos(car.angle) * rearDist;
      const backY = car.y - Math.sin(car.angle) * rearDist;
      const perpX = -Math.sin(car.angle);
      const perpY = Math.cos(car.angle);

      for (const offset of [-14, 14]) {
        newProjectiles.push({
          id: `mine_${nextAbilityProjId++}`,
          type: 'mine',
          x: backX + perpX * offset,
          y: backY + perpY * offset,
          vx: 0,
          vy: 0,
          angle: 0,
          radius: 12,
          damage: 55,
          ownerId: car.id,
          lifetime: 0,
          maxLifetime: 30.0,
          isArmed: false,
          color: '#ff2200',
        });
      }
      break;
    }

    case 'rally': {
      // EMP Smoke Screen: deploy expanding ionization cloud
      car.gadgetCooldown = 8.5;
      car.gadgetMaxCooldown = 8.5;

      const rearDist = 20;
      const dropX = car.x - Math.cos(car.angle) * rearDist;
      const dropY = car.y - Math.sin(car.angle) * rearDist;

      newProjectiles.push({
        id: `emp_${nextAbilityProjId++}`,
        type: 'emp_cloud',
        x: dropX,
        y: dropY,
        vx: 0,
        vy: 0,
        angle: 0,
        radius: 140,
        cloudRadius: 20,
        maxCloudRadius: 150,
        damage: 0,
        ownerId: car.id,
        lifetime: 0,
        maxLifetime: 6.0,
        color: '#bc13fe',
      });
      break;
    }

    case 'apex': {
      // Holographic Decoy: Deploys a ghost decoy drone hazard (`type: 'decoy'`) that lingers for 4s. car.gadgetCooldown = 8.0; car.gadgetMaxCooldown = 8.0;
      car.gadgetCooldown = 8.0;
      car.gadgetMaxCooldown = 8.0;

      const rearDist = 24;
      const dropX = car.x - Math.cos(car.angle) * rearDist;
      const dropY = car.y - Math.sin(car.angle) * rearDist;

      newProjectiles.push({
        id: `decoy_${nextAbilityProjId++}`,
        type: 'decoy',
        x: dropX,
        y: dropY,
        vx: car.vx * 0.25,
        vy: car.vy * 0.25,
        angle: car.angle,
        radius: 18,
        damage: 0,
        ownerId: car.id,
        lifetime: 0,
        maxLifetime: 4.0,
        color: '#d000ff',
      });

      particles.emitShockwave(dropX, dropY, 50, '#d000ff');
      break;
    }

    case 'titan': {
      // Disruptor EMP Pulse: Radial EMP burst within 130px that sets empDisrupted = true; empDuration = 2.2; on all enemy cars. car.gadgetCooldown = 9.0; car.gadgetMaxCooldown = 9.0;
      car.gadgetCooldown = 9.0;
      car.gadgetMaxCooldown = 9.0;

      particles.emitShockwave(car.x, car.y, 130, '#0066ff');

      if (allCars) {
        for (const target of allCars) {
          if (!target.isAlive || target.id === car.id) continue;
          const dist = Math.hypot(target.x - car.x, target.y - car.y);
          if (dist <= 130) {
            target.empDisrupted = true;
            target.empDuration = 2.2;
            particles.emitEMPSpark(target.x, target.y);
          }
        }
      }
      break;
    }
  }

  return { newProjectiles };
}

/**
 * Updates active abilities, cooldowns, and duration timers for each tick.
 */
export function updateCarAbilities(car: CarState, dt: number): void {
  // Cooldown timers
  if (car.primaryCooldown > 0) car.primaryCooldown = Math.max(0, car.primaryCooldown - dt);
  if (car.specialCooldown > 0) car.specialCooldown = Math.max(0, car.specialCooldown - dt);
  if (car.mobilityCooldown > 0) car.mobilityCooldown = Math.max(0, car.mobilityCooldown - dt);
  if (car.gadgetCooldown > 0) car.gadgetCooldown = Math.max(0, car.gadgetCooldown - dt);

  // Active duration timers
  if (car.shieldActive) {
    car.shieldDuration -= dt;
    if (car.shieldDuration <= 0) {
      car.shieldActive = false;
    }
  }

  if (car.ramActive) {
    car.ramDuration -= dt;
    if (car.ramDuration <= 0) {
      car.ramActive = false;
    }
  }

  if (car.boostActive) {
    car.boostDuration -= dt;
    if (car.boostDuration <= 0) {
      car.boostActive = false;
    }
  }

  if (car.empDisrupted) {
    car.empDuration -= dt;
    if (car.empDuration <= 0) {
      car.empDisrupted = false;
    }
  }
}

/**
 * Resolves Ram Overdrive collisions between cars.
 */
export function resolveCarCollisions(
  cars: CarState[],
  particles: ParticleSystem,
  onImpact?: (x: number, y: number, trauma: number) => void,
  onKill?: (killerId: string, victimId: string, weapon: string) => void
): void {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const c1 = cars[i];
      const c2 = cars[j];

      if (!c1.isAlive || !c2.isAlive) continue;

      const dx = c2.x - c1.x;
      const dy = c2.y - c1.y;
      const dist = Math.hypot(dx, dy);
      const r1 = c1.archetype === 'desert' ? 24 : 20;
      const r2 = c2.archetype === 'desert' ? 24 : 20;
      const minDist = r1 + r2;

      if (dist < minDist && dist > 0.001) {
        // Overlap resolution
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - dist) / 2;

        c1.x -= nx * overlap;
        c1.y -= ny * overlap;
        c2.x += nx * overlap;
        c2.y += ny * overlap;

        // Ram Overdrive devastating damage
        if (c1.ramActive && !c2.ramActive) {
          applyDamageToCar(c2, 80, c1.id, 'RAM OVERDRIVE', cars, onKill);
          c2.vx += nx * 500;
          c2.vy += ny * 500;
          particles.emitExplosion((c1.x + c2.x) / 2, (c1.y + c2.y) / 2, 1.0);
          if (onImpact) onImpact((c1.x + c2.x) / 2, (c1.y + c2.y) / 2, 0.7);
        } else if (c2.ramActive && !c1.ramActive) {
          applyDamageToCar(c1, 80, c2.id, 'RAM OVERDRIVE', cars, onKill);
          c1.vx -= nx * 500;
          c1.vy -= ny * 500;
          particles.emitExplosion((c1.x + c2.x) / 2, (c1.y + c2.y) / 2, 1.0);
          if (onImpact) onImpact((c1.x + c2.x) / 2, (c1.y + c2.y) / 2, 0.7);
        } else {
          // Standard kinetic collision exchange
          const relVx = c1.vx - c2.vx;
          const relVy = c1.vy - c2.vy;
          const velAlongNormal = relVx * nx + relVy * ny;

          // Only apply kinetic impulse if cars are moving towards each other (closing velocity > 0)
          if (velAlongNormal > 0) {
            const m1 = c1.archetype === 'desert' ? 1.6 : c1.archetype === 'rally' ? 0.85 : 1.0;
            const m2 = c2.archetype === 'desert' ? 1.6 : c2.archetype === 'rally' ? 0.85 : 1.0;
            const restitution = 0.5;
            const impulseMag = Math.min(350, ((1.0 + restitution) * velAlongNormal) / (1.0 / m1 + 1.0 / m2));

            c1.vx -= (nx * impulseMag) / m1;
            c1.vy -= (ny * impulseMag) / m1;
            c2.vx += (nx * impulseMag) / m2;
            c2.vy += (ny * impulseMag) / m2;

            particles.emitSparks((c1.x + c2.x) / 2, (c1.y + c2.y) / 2, Math.atan2(ny, nx), 12);
          }
        }
      }
    }
  }
}
