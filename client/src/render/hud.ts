import {
  CarState,
  KillfeedEntry,
} from '../types';
import { ARCHETYPE_CONFIGS } from '../physics/configs.ts';

export type ScreenCoordProvider =
  | Map<string, { x: number; y: number }>
  | Record<string, { x: number; y: number }>
  | ((car: CarState) => { x: number; y: number } | null | undefined)
  | { cameraX: number; cameraY: number; zoom: number };

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
    countdown: number | null,
    screenCoordsProvider?: ScreenCoordProvider
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

    // 5. 3D Projected Car Name Tags & Health Bars (Overlay pass, no double camera transform)
    this.renderCarTags(ctx, width, height, allCars, screenCoordsProvider);

    // 6. On-Screen Controls Legend in semi-transparent corner card
    this.renderControlsLegend(ctx, width, height);

    // 7. Local Car Telemetry & Controls HUD
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
  // ON-SCREEN CONTROLS LEGEND CORNER CARD
  // ==========================================
  private renderControlsLegend(
    ctx: CanvasRenderingContext2D,
    _width: number,
    height: number
  ): void {
    ctx.save();

    // Semi-transparent corner card placed at bottom-left corner directly above health bar
    const cardW = 264;
    const cardH = 92;
    const cardX = 16;
    const cardY = height >= 450 ? height - 117 - 10 - cardH : 140;

    // Semi-transparent glassmorphism container
    ctx.fillStyle = 'rgba(10, 14, 22, 0.8)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, 6);
    ctx.fill();
    ctx.stroke();

    // Card Header
    ctx.font = '900 10px monospace, system-ui';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('⌨ CONTROLS', cardX + 12, cardY + 10);

    // Subtle divider
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 10, cardY + 23);
    ctx.lineTo(cardX + cardW - 10, cardY + 23);
    ctx.stroke();

    // Row 1: Right Hand (Steering & Momentum)
    const row1Y = cardY + 30;
    ctx.font = 'bold 9px monospace, system-ui';
    ctx.fillStyle = '#88a0c0';
    ctx.fillText('RIGHT HAND:', cardX + 12, row1Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Vim HJKL / Arrows', cardX + 85, row1Y);
    ctx.fillStyle = '#ffaa00';
    ctx.fillText('(Drive & Drift)', cardX + 192, row1Y);

    // Row 2: Left Hand (Combat & Abilities)
    const row2Y = cardY + 48;
    ctx.fillStyle = '#88a0c0';
    ctx.fillText('LEFT HAND:', cardX + 12, row2Y);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('A', cardX + 85, row2Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('(Fire)', cardX + 94, row2Y);
    ctx.fillStyle = '#ff4b1f';
    ctx.fillText('S', cardX + 130, row2Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('(Special)', cardX + 139, row2Y);
    ctx.fillStyle = '#39ff14';
    ctx.fillText('D', cardX + 188, row2Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('(Boost)', cardX + 197, row2Y);
    ctx.fillStyle = '#bc13fe';
    ctx.fillText('F', cardX + 238, row2Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('(Gdg)', cardX + 246, row2Y);

    // Row 3: Camera Toggle
    const row3Y = cardY + 66;
    ctx.fillStyle = '#88a0c0';
    ctx.fillText('CAMERA:', cardX + 12, row3Y);
    ctx.fillStyle = '#00f0ff';
    ctx.fillText('C', cardX + 85, row3Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('(Toggle 3D Chase Cam / Stadium Cam)', cardX + 96, row3Y);

    ctx.restore();
  }

  // ==========================================
  // 3D PROJECTED CAR NAME TAGS & HEALTH BARS
  // ==========================================
  public renderCarTags(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    allCars: CarState[],
    screenCoordsProvider?: ScreenCoordProvider
  ): void {
    if (!allCars || allCars.length === 0) return;

    ctx.save();

    for (const car of allCars) {
      if (!car.isAlive) continue;

      let screenPos: { x: number; y: number } | null | undefined = null;

      if (typeof screenCoordsProvider === 'function') {
        screenPos = screenCoordsProvider(car);
      } else if (screenCoordsProvider instanceof Map) {
        screenPos = screenCoordsProvider.get(car.id);
      } else if (screenCoordsProvider && typeof (screenCoordsProvider as Record<string, unknown>).cameraX === 'number') {
        const cam = screenCoordsProvider as { cameraX: number; cameraY: number; zoom: number };
        screenPos = {
          x: (car.x - cam.cameraX) * cam.zoom + width / 2,
          y: (car.y - cam.cameraY) * cam.zoom + height / 2,
        };
      } else if (screenCoordsProvider && typeof screenCoordsProvider === 'object') {
        screenPos = (screenCoordsProvider as Record<string, { x: number; y: number }>)[car.id];
      }

      if (!screenPos) {
        const anyCar = car as unknown as {
          screenX?: number;
          screenY?: number;
          screenPos?: { x: number; y: number };
        };
        if (typeof anyCar.screenX === 'number' && typeof anyCar.screenY === 'number') {
          screenPos = { x: anyCar.screenX, y: anyCar.screenY };
        } else if (anyCar.screenPos) {
          screenPos = anyCar.screenPos;
        }
      }

      if (!screenPos) continue;

      const { x: sx, y: sy } = screenPos;
      // Skip tags positioned outside the visible viewport
      if (sx < -80 || sx > width + 80 || sy < -80 || sy > height + 80) continue;

      const tagY = sy - 38;

      // 1. Pilot Name Tag
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const displayName = car.isLocal ? `${car.name} (YOU)` : car.name;
      const textMetrics = ctx.measureText(displayName);
      const nameW = textMetrics.width;

      // Dark backing capsule for high legibility over neon track lines
      ctx.fillStyle = 'rgba(8, 12, 20, 0.8)';
      ctx.strokeStyle = car.isLocal ? 'rgba(0, 240, 255, 0.4)' : 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(sx - nameW / 2 - 6, tagY - 8, nameW + 12, 16, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = car.isLocal ? '#00f0ff' : '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 4;
      ctx.fillText(displayName, sx, tagY);
      ctx.shadowBlur = 0;

      // 2. Compact Health Bar underneath
      const barW = 46;
      const barH = 5;
      const barX = sx - barW / 2;
      const barY = tagY + 11;
      const hpRatio = Math.max(0, Math.min(1.0, car.health / car.maxHealth));

      // Bar container
      ctx.fillStyle = 'rgba(10, 14, 22, 0.9)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeRect(barX, barY, barW, barH);

      // HP fill color
      let hpColor = '#39ff14';
      if (hpRatio < 0.25) hpColor = '#ff2244';
      else if (hpRatio < 0.55) hpColor = '#ffaa00';

      ctx.fillStyle = hpColor;
      ctx.shadowColor = hpColor;
      ctx.shadowBlur = 4;
      ctx.fillRect(barX, barY, barW * hpRatio, barH);
      ctx.shadowBlur = 0;

      // Active Shield / Ram aura indicator
      if (car.shieldActive) {
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
      } else if (car.ramActive) {
        ctx.strokeStyle = '#ff4b1f';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(barX - 1, barY - 1, barW + 2, barH + 2);
      }
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
        name: 'BLASTER',
        description: config.primaryWeaponName || 'Kinetic Cannon',
        cooldown: car.primaryCooldown,
        maxCooldown: config.primaryCooldown || 0.35,
        color: '#00f0ff',
      },
      {
        key: 'S',
        name: 'SPECIAL',
        description: config.specialAbilityName || 'Special Weapon',
        cooldown: car.specialCooldown,
        maxCooldown: car.specialMaxCooldown || config.specialCooldown || 6.0,
        color: '#ff4b1f',
      },
      {
        key: 'D',
        name: 'BOOST',
        description: config.mobilityAbilityName || 'Mobility Boost',
        cooldown: car.mobilityCooldown,
        maxCooldown: car.mobilityMaxCooldown || config.mobilityCooldown || 4.5,
        color: '#39ff14',
      },
      {
        key: 'F',
        name: 'GADGET',
        description: config.tacticalGadgetName || 'Tactical Gadget',
        cooldown: car.gadgetCooldown,
        maxCooldown: car.gadgetMaxCooldown || config.utilityCooldown || 8.0,
        color: '#bc13fe',
      },
    ];

    const slotW = 88;
    const slotH = 78;
    const gap = 12;
    const totalW = abilities.length * slotW + (abilities.length - 1) * gap;
    const startX = width / 2 - totalW / 2;
    const startY = height - 92;

    ctx.save();

    abilities.forEach((ab, idx) => {
      const x = startX + idx * (slotW + gap);
      const y = startY;
      const isReady = ab.cooldown <= 0;
      const progress = isReady ? 0 : Math.max(0, Math.min(1.0, ab.cooldown / ab.maxCooldown));

      // 1. Slot Backdrop & Outer Glow
      ctx.fillStyle = isReady ? 'rgba(12, 18, 30, 0.94)' : 'rgba(8, 11, 18, 0.88)';
      ctx.beginPath();
      ctx.roundRect(x, y, slotW, slotH, 6);
      ctx.fill();

      if (isReady) {
        // Distinct glowing READY border
        ctx.strokeStyle = ab.color;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = ab.color;
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Top accent line
        ctx.fillStyle = ab.color;
        ctx.fillRect(x + 8, y, slotW - 16, 2.5);
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // 2. Keybind Badge Pill: [A], [S], [D], [F]
      const keyW = 22;
      const keyH = 18;
      const keyX = x + 6;
      const keyY = y + 6;

      ctx.fillStyle = isReady ? ab.color : 'rgba(255, 255, 255, 0.16)';
      ctx.beginPath();
      ctx.roundRect(keyX, keyY, keyW, keyH, 3);
      ctx.fill();

      ctx.font = '900 11px monospace, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isReady ? '#050a12' : '#ffffff';
      ctx.fillText(ab.key, keyX + keyW / 2, keyY + keyH / 2 + 0.5);

      // 3. Top-Right Glowing "READY" Badge
      if (isReady) {
        const readyBadgeW = 42;
        const readyBadgeH = 16;
        const readyBadgeX = x + slotW - readyBadgeW - 6;
        const readyBadgeY = y + 7;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.strokeStyle = ab.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(readyBadgeX, readyBadgeY, readyBadgeW, readyBadgeH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.font = '900 8.5px monospace, system-ui';
        ctx.fillStyle = ab.color;
        ctx.shadowColor = ab.color;
        ctx.shadowBlur = 6;
        ctx.fillText('READY', readyBadgeX + readyBadgeW / 2, readyBadgeY + readyBadgeH / 2 + 0.5);
        ctx.shadowBlur = 0;
      }

      // 4. Primary Slot Action Name ([A] BLASTER / [S] SPECIAL / [D] BOOST / [F] GADGET)
      ctx.font = '900 12.5px monospace, system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isReady ? '#ffffff' : '#8899aa';
      ctx.fillText(ab.name, x + slotW / 2, y + 36);

      // 5. Specific Archetype Ability Description
      ctx.font = 'bold 8.5px system-ui, sans-serif';
      ctx.fillStyle = isReady ? ab.color : '#556677';
      const cleanSub = ab.description.length > 13 ? ab.description.substring(0, 12) + '..' : ab.description;
      ctx.fillText(cleanSub.toUpperCase(), x + slotW / 2, y + 54);

      // 6. Dark translucent wipe overlay showing remaining cooldown countdown (e.g. 2.4s)
      if (!isReady) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, slotW, slotH, 6);
        ctx.clip();

        // Dark translucent overlay wiping over slot
        ctx.fillStyle = 'rgba(6, 9, 16, 0.76)';
        const wipeH = slotH * progress;
        ctx.fillRect(x, y + slotH - wipeH, slotW, wipeH);

        // Bright wipe progress line
        ctx.strokeStyle = ab.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y + slotH - wipeH);
        ctx.lineTo(x + slotW, y + slotH - wipeH);
        ctx.stroke();

        // Dark high-contrast backing pill for countdown text
        const cdText = `${ab.cooldown.toFixed(1)}s`;
        ctx.font = '900 16px monospace, system-ui';
        const tw = ctx.measureText(cdText).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + slotW / 2 - tw / 2 - 7, y + 27, tw + 14, 22, 4);
        ctx.fill();
        ctx.stroke();

        // High contrast countdown number
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cdText, x + slotW / 2, y + 38);

        ctx.restore();
      }
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
