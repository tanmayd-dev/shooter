import {
  CarState,
  KillfeedEntry,
} from '../types';
import { ARCHETYPE_CONFIGS } from '../physics/configs.ts';

export class HUDRenderer {
  private killfeed: KillfeedEntry[] = [];
  private readonly killfeedDuration: number = 4.5; // seconds

  public addKill(killerName: string, victimName: string, weapon: string): void {
    this.killfeed.push({
      id: `kill_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      killerName,
      victimName,
      weapon,
      timestamp: performance.now(),
    });

    if (this.killfeed.length > 6) {
      this.killfeed.shift();
    }
  }

  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    localCar: CarState | null,
    allCars: CarState[],
    matchTimeRemaining: number,
    countdown: number | null
  ): void {
    ctx.save();

    // 1. Top Center: Match Timer & Stadium Clock
    this.renderMatchTimer(ctx, width, matchTimeRemaining);

    // 2. Top Right: Killfeed Notifications
    this.renderKillfeed(ctx, width);

    // 3. Top Left: Score & Leaderboard
    this.renderScoreboard(ctx, localCar, allCars);

    // 4. Center: 3-2-1-GO Countdown overlay
    if (countdown !== null) {
      this.renderCountdownOverlay(ctx, width, height, countdown);
    }

    // 5. Local Car Telemetry & Controls HUD
    if (localCar) {
      // Bottom Right: Speedometer, Gear, RPM, Drift Slip Gauge
      this.renderSpeedometer(ctx, width, height, localCar);

      // Bottom Left: Health Bar, Armor, Status Buffs
      this.renderHealthBar(ctx, height, localCar);

      // Bottom Center: Action Abilities Cooldown Bar (A, S, D, F)
      this.renderAbilityBar(ctx, width, height, localCar);
    }

    ctx.restore();
  }

  // ==========================================
  // SPEEDOMETER & DRIFT GAUGE
  // ==========================================
  private renderSpeedometer(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    car: CarState
  ): void {
    const rawSpeed = Math.hypot(car.vx, car.vy);
    const kmh = Math.round(rawSpeed * 0.42);
    const config = ARCHETYPE_CONFIGS[car.archetype];
    const maxKmh = config ? config.topSpeed : 500;
    const speedRatio = Math.min(1.2, kmh / maxKmh);

    const centerX = width - 140;
    const centerY = height - 110;
    const radius = 75;

    ctx.save();

    // Backdrop disc
    ctx.fillStyle = 'rgba(10, 14, 22, 0.75)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // RPM / Speed Tachometer Arc (from 135 deg to 405 deg)
    const startAngle = Math.PI * 0.75;
    const totalSweep = Math.PI * 1.5;

    // Background track arc
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + totalSweep);
    ctx.stroke();

    // Active speed arc
    const activeSweep = totalSweep * Math.min(1.0, speedRatio);
    let arcColor = '#00f0ff';
    if (speedRatio > 0.88) {
      arcColor = '#ff2255'; // Redline
    } else if (speedRatio > 0.65) {
      arcColor = '#ffaa00'; // High rev
    } else if (speedRatio > 0.35) {
      arcColor = '#39ff14'; // Mid rev
    }

    ctx.strokeStyle = arcColor;
    ctx.shadowColor = arcColor;
    ctx.shadowBlur = 14;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + activeSweep);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Big Digital Speed Number
    ctx.font = '900 44px monospace, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = arcColor;
    ctx.shadowBlur = 8;
    ctx.fillText(kmh.toString(), centerX, centerY - 8);
    ctx.shadowBlur = 0;

    // "KM/H" Unit label
    ctx.font = 'bold 12px monospace, system-ui';
    ctx.fillStyle = '#88a0c0';
    ctx.fillText('KM / H', centerX, centerY + 24);

    // Gear indicator & Archetype badge
    const gear = Math.min(6, Math.max(1, Math.floor(speedRatio * 5.8) + 1));
    ctx.fillStyle = arcColor;
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.fillText(`GEAR ${gear} • ${config.specName.toUpperCase()}`, centerX, centerY + 42);

    // ==========================================
    // DRIFT METER / SLIP GAUGE
    // ==========================================
    const isDrifting = car.skidIntensity > 0.18;
    const driftBarW = 120;
    const driftBarH = 8;
    const driftX = centerX - driftBarW / 2;
    const driftY = centerY - radius - 24;

    ctx.fillStyle = 'rgba(10, 14, 22, 0.8)';
    ctx.fillRect(driftX, driftY, driftBarW, driftBarH);
    ctx.strokeStyle = isDrifting ? '#ff8c00' : 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(driftX, driftY, driftBarW, driftBarH);

    if (isDrifting) {
      const fillW = driftBarW * Math.min(1.0, car.skidIntensity);
      ctx.fillStyle = '#ffaa00';
      ctx.shadowColor = '#ff8c00';
      ctx.shadowBlur = 10;
      ctx.fillRect(driftX, driftY, fillW, driftBarH);
      ctx.shadowBlur = 0;

      // "DRIFT" label with multiplier
      const mult = (1.0 + car.skidIntensity * 2.5).toFixed(1);
      ctx.font = 'bold 11px monospace, system-ui';
      ctx.fillStyle = '#ffaa00';
      ctx.textAlign = 'center';
      ctx.fillText(`DRIFT x${mult}`, centerX, driftY - 6);
    }

    ctx.restore();
  }

  // ==========================================
  // HEALTH & ARMOR INDICATORS
  // ==========================================
  private renderHealthBar(ctx: CanvasRenderingContext2D, height: number, car: CarState): void {
    const barX = 28;
    const barY = height - 85;
    const barWidth = 240;
    const barHeight = 16;

    ctx.save();

    // Container panel
    ctx.fillStyle = 'rgba(10, 14, 22, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.roundRect(barX - 12, barY - 32, barWidth + 24, 78, 6);
    ctx.fill();
    ctx.stroke();

    // Health Title & Values
    const hpRatio = Math.max(0, Math.min(1.0, car.health / car.maxHealth));
    const isCritical = hpRatio < 0.3;

    ctx.font = 'bold 12px monospace, system-ui';
    ctx.textAlign = 'left';
    ctx.fillStyle = isCritical ? '#ff2244' : '#ffffff';
    ctx.fillText('HULL INTEGRITY', barX, barY - 14);

    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(car.health)} / ${car.maxHealth} HP`, barX + barWidth, barY - 14);

    // Segmented Health Bar
    ctx.fillStyle = 'rgba(20, 24, 35, 0.9)';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Color gradient based on health
    let hpColor = '#39ff14';
    if (hpRatio < 0.25) hpColor = '#ff1744';
    else if (hpRatio < 0.55) hpColor = '#ff9100';

    ctx.fillStyle = hpColor;
    ctx.shadowColor = hpColor;
    ctx.shadowBlur = isCritical ? 14 : 6;
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);
    ctx.shadowBlur = 0;

    // Segment tick dividers
    ctx.strokeStyle = 'rgba(10, 14, 22, 0.9)';
    ctx.lineWidth = 2;
    const segments = 10;
    for (let i = 1; i < segments; i++) {
      const sx = barX + (barWidth / segments) * i;
      ctx.beginPath();
      ctx.moveTo(sx, barY);
      ctx.lineTo(sx, barY + barHeight);
      ctx.stroke();
    }

    // Active Armor / Shield Banner
    if (car.shieldActive) {
      ctx.fillStyle = '#00f0ff';
      ctx.font = 'bold 10px monospace, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('🛡 KINETIC DEFLECTOR ACTIVE', barX, barY + 28);
    } else if (car.ramActive) {
      ctx.fillStyle = '#ff4b1f';
      ctx.font = 'bold 10px monospace, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('⚡ RAM OVERDRIVE ACTIVE (70% ARMOR)', barX, barY + 28);
    } else if (car.boostActive) {
      ctx.fillStyle = '#bc13fe';
      ctx.font = 'bold 10px monospace, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('🚀 TWIN-TURBO BOOST ACTIVE', barX, barY + 28);
    } else if (car.empDisrupted) {
      ctx.fillStyle = '#ff0055';
      ctx.font = 'bold 10px monospace, system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('⚠ EMP DISRUPTION ACTIVE', barX, barY + 28);
    }

    ctx.restore();
  }

  // ==========================================
  // ACTION ABILITY COOLDOWN BAR
  // ==========================================
  private renderAbilityBar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    car: CarState
  ): void {
    const config = ARCHETYPE_CONFIGS[car.archetype];
    const abilities = [
      {
        key: 'A',
        title: config.primaryWeaponName,
        cooldown: car.primaryCooldown,
        maxCooldown: 0.35,
        color: '#00f0ff',
      },
      {
        key: 'S',
        title: config.specialAbilityName,
        cooldown: car.specialCooldown,
        maxCooldown: car.specialMaxCooldown || 6.0,
        color: '#ff4b1f',
      },
      {
        key: 'D',
        title: config.mobilityAbilityName,
        cooldown: car.mobilityCooldown,
        maxCooldown: car.mobilityMaxCooldown || 4.5,
        color: '#39ff14',
      },
      {
        key: 'F',
        title: config.tacticalGadgetName,
        cooldown: car.gadgetCooldown,
        maxCooldown: car.gadgetMaxCooldown || 8.0,
        color: '#bc13fe',
      },
    ];

    const slotW = 76;
    const slotH = 68;
    const gap = 12;
    const totalW = abilities.length * slotW + (abilities.length - 1) * gap;
    const startX = width / 2 - totalW / 2;
    const startY = height - 85;

    ctx.save();

    abilities.forEach((ab, idx) => {
      const x = startX + idx * (slotW + gap);
      const y = startY;
      const isReady = ab.cooldown <= 0;
      const progress = isReady ? 1.0 : 1.0 - ab.cooldown / ab.maxCooldown;

      // Slot Backdrop
      ctx.fillStyle = 'rgba(12, 16, 26, 0.85)';
      ctx.strokeStyle = isReady ? ab.color : 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = isReady ? 2 : 1;
      if (isReady) {
        ctx.shadowColor = ab.color;
        ctx.shadowBlur = 8;
      }
      ctx.roundRect(x, y, slotW, slotH, 5);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Cooldown bottom-to-top wipe
      if (!isReady) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        const wipeH = slotH * (1.0 - progress);
        ctx.fillRect(x, y, slotW, wipeH);

        // Numeric cooldown text
        ctx.font = 'bold 15px monospace, system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${ab.cooldown.toFixed(1)}s`, x + slotW / 2, y + slotH / 2 + 6);
      }

      // Keybind Badge Pill: [A], [S], [D], [F]
      ctx.fillStyle = isReady ? ab.color : 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(x + 6, y + 6, 20, 16);

      ctx.font = 'bold 11px monospace, system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = isReady ? '#000000' : '#ffffff';
      ctx.fillText(ab.key, x + 16, y + 18);

      // Ability Name Label
      ctx.font = 'bold 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isReady ? '#ffffff' : '#8899aa';
      // Truncate long names for slot
      const shortName = ab.title.length > 11 ? ab.title.substring(0, 10) + '..' : ab.title;
      ctx.fillText(shortName.toUpperCase(), x + slotW / 2, y + slotH - 8);
    });

    ctx.restore();
  }

  // ==========================================
  // KILLFEED NOTIFICATIONS
  // ==========================================
  private renderKillfeed(ctx: CanvasRenderingContext2D, width: number): void {
    const now = performance.now();
    const feedX = width - 24;
    let feedY = 32;

    ctx.save();
    ctx.textAlign = 'right';

    // Prune expired
    this.killfeed = this.killfeed.filter((k) => now - k.timestamp < this.killfeedDuration * 1000);

    for (const item of this.killfeed) {
      const ageSec = (now - item.timestamp) / 1000;
      const alpha = Math.max(0, Math.min(1.0, (this.killfeedDuration - ageSec) * 1.5));

      ctx.globalAlpha = alpha;

      // Card background
      const text = `${item.killerName}  [${item.weapon}]  ${item.victimName}`;
      ctx.font = 'bold 12px monospace, system-ui';
      const textW = ctx.measureText(text).width;

      ctx.fillStyle = 'rgba(12, 16, 26, 0.85)';
      ctx.strokeStyle = 'rgba(255, 75, 31, 0.6)';
      ctx.lineWidth = 1;
      ctx.roundRect(feedX - textW - 24, feedY - 14, textW + 24, 24, 4);
      ctx.fill();
      ctx.stroke();

      // Render text
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(item.killerName, feedX - textW - 12 + ctx.measureText(item.killerName).width, feedY + 2);

      ctx.fillStyle = '#ff8c00';
      const weaponOffset = ctx.measureText(`${item.killerName}  [${item.weapon}]`).width;
      ctx.fillText(`[${item.weapon}]`, feedX - textW - 12 + weaponOffset, feedY + 2);

      ctx.fillStyle = '#ff2255';
      ctx.fillText(item.victimName, feedX - 12, feedY + 2);

      feedY += 30;
    }

    ctx.restore();
  }

  // ==========================================
  // MATCH TIMER & STADIUM CLOCK
  // ==========================================
  private renderMatchTimer(
    ctx: CanvasRenderingContext2D,
    width: number,
    matchTimeRemaining: number
  ): void {
    const minutes = Math.floor(Math.max(0, matchTimeRemaining) / 60);
    const seconds = Math.floor(Math.max(0, matchTimeRemaining) % 60);
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    ctx.save();
    const centerX = width / 2;
    const topY = 24;

    ctx.fillStyle = 'rgba(10, 14, 22, 0.85)';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 8;
    ctx.roundRect(centerX - 65, topY - 14, 130, 36, 6);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.font = '900 20px monospace, system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = matchTimeRemaining < 30 ? '#ff2244' : '#ffffff';
    ctx.fillText(timeStr, centerX, topY + 11);

    ctx.restore();
  }

  // ==========================================
  // SCOREBOARD & STATS
  // ==========================================
  private renderScoreboard(
    ctx: CanvasRenderingContext2D,
    localCar: CarState | null,
    allCars: CarState[]
  ): void {
    ctx.save();
    const x = 24;
    let y = 30;

    // Panel
    ctx.fillStyle = 'rgba(10, 14, 22, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.roundRect(x - 10, y - 16, 210, 34 + Math.min(3, allCars.length) * 22, 6);
    ctx.fill();
    ctx.stroke();

    if (localCar) {
      ctx.font = 'bold 12px monospace, system-ui';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#00f0ff';
      ctx.fillText(`FRAGS: ${localCar.kills}  |  DEATHS: ${localCar.deaths}`, x, y);
      y += 24;
    }

    // Top players leaderboard
    const sorted = [...allCars].sort((a, b) => b.kills - a.kills || b.score - a.score).slice(0, 3);
    ctx.font = '11px monospace, system-ui';

    sorted.forEach((car, idx) => {
      ctx.fillStyle = car.isLocal ? '#39ff14' : '#cccccc';
      ctx.fillText(
        `#${idx + 1} ${car.name.padEnd(10, ' ')} ${car.kills} frags`,
        x,
        y
      );
      y += 18;
    });

    ctx.restore();
  }

  // ==========================================
  // COUNTDOWN OVERLAY (3 - 2 - 1 - GO!)
  // ==========================================
  private renderCountdownOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    countdown: number
  ): void {
    ctx.save();
    const centerX = width / 2;
    const centerY = height / 2 - 40;

    let text = countdown.toString();
    let color = '#ff8c00';
    if (countdown === 0) {
      text = 'GO!';
      color = '#39ff14';
    }

    ctx.font = '900 110px monospace, system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Intense Stadium Glow
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 35;
    ctx.fillText(text, centerX, centerY);

    // Inner white pop
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 10;
    ctx.fillText(text, centerX, centerY);

    ctx.restore();
  }
}
