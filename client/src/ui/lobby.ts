import {
  CarArchetype,
  LobbyPlayer,
  RoomState,
} from '../types';
import { ARCHETYPE_CONFIGS } from '../physics/configs.ts';

export interface LobbyCallbacks {
  onCreateRoom: (nickname: string, archetype: CarArchetype) => void;
  onJoinRoom: (code: string, nickname: string, archetype: CarArchetype) => void;
  onSelectCar: (archetype: CarArchetype) => void;
  onToggleReady: (isReady: boolean) => void;
  onStartMatch: () => void;
}

export class LobbyUI {
  private container: HTMLDivElement;
  private selectedArchetype: CarArchetype = 'stadium';
  private isReady: boolean = false;
  private isHost: boolean = false;
  private currentRoomCode: string = '';
  private callbacks: Partial<LobbyCallbacks> = {};

  constructor(parentElement: HTMLElement = document.body) {
    this.container = document.createElement('div');
    this.container.id = 'shooter-lobby-container';
    this.injectStyles();
    parentElement.appendChild(this.container);
    this.render();
  }

  public setCallbacks(callbacks: LobbyCallbacks): void {
    this.callbacks = callbacks;
  }

  public show(): void {
    this.container.style.display = 'flex';
  }

  public hide(): void {
    this.container.style.display = 'none';
  }

  public getSelectedArchetype(): CarArchetype {
    return this.selectedArchetype;
  }

  public getNickname(): string {
    const input = this.container.querySelector<HTMLInputElement>('#nickname-input');
    return input?.value.trim() || 'PILOT-01';
  }

  public getRoomCode(): string {
    return this.currentRoomCode;
  }

  public updateRoom(room: RoomState, localPlayerId: string): void {
    this.currentRoomCode = room.code;
    const localPlayer = room.players.find((p: LobbyPlayer) => p.id === localPlayerId);

    if (localPlayer) {
      this.isHost = localPlayer.isHost;
      this.isReady = localPlayer.isReady;
      this.selectedArchetype = localPlayer.archetype;
    }

    const roomCodeDisplay = this.container.querySelector<HTMLElement>('#room-code-display');
    if (roomCodeDisplay) {
      roomCodeDisplay.textContent = room.code ? `ROOM: ${room.code}` : 'LOBBY';
    }

    // Update Player List
    const playerListEl = this.container.querySelector<HTMLElement>('#lobby-players-list');
    if (playerListEl) {
      playerListEl.innerHTML = room.players
        .map(
          (p: LobbyPlayer) => `
        <div class="player-row ${p.id === localPlayerId ? 'local-player' : ''}">
          <div class="player-info">
            <span class="player-name">${this.escapeHTML(p.name)}</span>
            ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
            <span class="player-archetype ${p.archetype}">
              ${ARCHETYPE_CONFIGS[p.archetype].name}
            </span>
          </div>
          <div class="player-status">
            <span class="player-ping">${p.ping || 15}ms</span>
            <span class="status-badge ${p.isReady ? 'ready' : 'not-ready'}">
              ${p.isReady ? '✓ READY' : 'PREPARING'}
            </span>
          </div>
        </div>
      `
        )
        .join('');
    }

    // Update Ready Button
    const readyBtn = this.container.querySelector<HTMLButtonElement>('#ready-btn');
    if (readyBtn) {
      readyBtn.className = `action-button ready-button ${this.isReady ? 'is-ready' : ''}`;
      readyBtn.textContent = this.isReady ? 'CANCEL READY' : 'READY UP';
    }

    // Update Host Start Button
    const startBtn = this.container.querySelector<HTMLButtonElement>('#start-btn');
    if (startBtn) {
      startBtn.style.display = this.isHost ? 'inline-block' : 'none';
      const allReady = room.players.length > 0 && room.players.every((p: LobbyPlayer) => p.isReady);
      startBtn.disabled = !allReady;
      startBtn.title = allReady ? 'Start the match' : 'All players must be ready';
    }

    // Highlight selected card
    this.updateCardSelection();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="lobby-backdrop">
        <header class="lobby-header">
          <div class="logo-box">
            <h1 class="game-title">SHOOTER</h1>
            <p class="game-subtitle">HIGH-SPEED MULTIPLAYER ARENA</p>
          </div>
          <div id="room-code-display" class="room-code-badge">ROOM: NONE</div>
        </header>

        <div class="lobby-main-grid">
          <!-- Left Column: Pilot Config & Room Controls -->
          <div class="lobby-sidebar">
            <div class="cyber-panel">
              <h2 class="panel-title">PILOT SETUP</h2>
              <div class="form-group">
                <label for="nickname-input">PILOT CALLSIGN</label>
                <input id="nickname-input" type="text" maxlength="14" value="PILOT-01" class="cyber-input" placeholder="Callsign" />
              </div>

              <div class="form-group">
                <label for="room-code-input">JOIN BY ROOM CODE</label>
                <div class="input-action-row">
                  <input id="room-code-input" type="text" maxlength="8" class="cyber-input uppercase" placeholder="CODE" />
                  <button id="join-btn" class="cyber-button secondary">JOIN</button>
                </div>
              </div>

              <div class="divider">OR</div>

              <button id="create-btn" class="cyber-button primary full-width">CREATE NEW ROOM</button>
            </div>

            <!-- Connected Players Roster -->
            <div class="cyber-panel">
              <h2 class="panel-title">CONNECTED PILOTS</h2>
              <div id="lobby-players-list" class="players-list">
                <div class="empty-state">No pilots connected. Create or join a room.</div>
              </div>
            </div>
          </div>

          <!-- Center/Right Column: Vehicle Archetype Selector Carousel -->
          <div class="lobby-content">
            <div class="cyber-panel full-height">
              <h2 class="panel-title">SELECT CAR ARCHETYPE</h2>
              <p class="panel-desc">Choose your combat vehicle spec. Dual-hand controls: Vim [HJKL]/Arrows + Fixed Combat [ASDF].</p>

              <div class="archetype-carousel">
                ${this.renderArchetypeCard('stadium')}
                ${this.renderArchetypeCard('desert')}
                ${this.renderArchetypeCard('rally')}
              </div>

              <!-- Action Bar Footer -->
              <div class="lobby-footer">
                <div class="controls-hint">
                  <span class="key-pill">H J K L</span> Steering & Drift
                  <span class="key-pill">A</span> Fire
                  <span class="key-pill">S</span> Special
                  <span class="key-pill">D</span> Mobility
                  <span class="key-pill">F</span> Gadget
                </div>

                <div class="button-group">
                  <button id="ready-btn" class="action-button ready-button">READY UP</button>
                  <button id="start-btn" class="action-button start-button" style="display: none;">START MATCH</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderCarPreviews();
    this.updateCardSelection();
  }

  private renderArchetypeCard(archetype: CarArchetype): string {
    const config = ARCHETYPE_CONFIGS[archetype];

    return `
      <div class="archetype-card ${archetype}" data-archetype="${archetype}">
        <div class="card-header">
          <div class="archetype-badge ${archetype}">${config.specName.toUpperCase()}</div>
          <h3 class="archetype-name">${config.name}</h3>
        </div>

        <!-- 2D Canvas Silhouette Preview -->
        <div class="preview-canvas-container">
          <canvas id="preview-${archetype}" width="220" height="110" class="preview-canvas"></canvas>
        </div>

        <p class="archetype-desc">${config.description}</p>

        <!-- Stat Bars -->
        <div class="stat-bars">
          ${this.renderStatBar('TOP SPEED', config.stats.topSpeed, config.color)}
          ${this.renderStatBar('GRIP', config.stats.grip, config.color)}
          ${this.renderStatBar('DRIFT SLIP', config.stats.driftSlip, config.color)}
          ${this.renderStatBar('ARMOR', config.stats.armor, config.color)}
          ${this.renderStatBar('TURN RATE', config.stats.turnRate, config.color)}
        </div>

        <!-- Loadout Summary -->
        <div class="loadout-summary">
          <div class="loadout-item"><span class="key">[A]</span> ${config.primaryWeaponName}</div>
          <div class="loadout-item"><span class="key">[S]</span> ${config.specialAbilityName}</div>
          <div class="loadout-item"><span class="key">[D]</span> ${config.mobilityAbilityName}</div>
          <div class="loadout-item"><span class="key">[F]</span> ${config.tacticalGadgetName}</div>
        </div>

        <button class="select-card-btn" data-archetype="${archetype}">SELECT SPEC</button>
      </div>
    `;
  }

  private renderStatBar(label: string, value: number, color: string): string {
    return `
      <div class="stat-row">
        <span class="stat-label">${label}</span>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width: ${value}%; background-color: ${color}; box-shadow: 0 0 8px ${color}"></div>
        </div>
        <span class="stat-value">${value}%</span>
      </div>
    `;
  }

  private bindEvents(): void {
    // Room create
    const createBtn = this.container.querySelector<HTMLButtonElement>('#create-btn');
    if (createBtn) {
      createBtn.addEventListener('click', () => {
        const nick = this.getNickname();
        if (this.callbacks.onCreateRoom) {
          this.callbacks.onCreateRoom(nick, this.selectedArchetype);
        }
      });
    }

    // Room join
    const joinBtn = this.container.querySelector<HTMLButtonElement>('#join-btn');
    const roomInput = this.container.querySelector<HTMLInputElement>('#room-code-input');
    if (joinBtn && roomInput) {
      joinBtn.addEventListener('click', () => {
        const code = roomInput.value.trim().toUpperCase();
        if (!code) return;
        const nick = this.getNickname();
        if (this.callbacks.onJoinRoom) {
          this.callbacks.onJoinRoom(code, nick, this.selectedArchetype);
        }
      });
    }

    // Car card selection
    const cards = this.container.querySelectorAll<HTMLElement>('.archetype-card');
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        const arch = card.getAttribute('data-archetype') as CarArchetype;
        if (arch) {
          this.selectedArchetype = arch;
          this.updateCardSelection();
          if (this.callbacks.onSelectCar) {
            this.callbacks.onSelectCar(arch);
          }
        }
      });
    });

    // Ready toggle
    const readyBtn = this.container.querySelector<HTMLButtonElement>('#ready-btn');
    if (readyBtn) {
      readyBtn.addEventListener('click', () => {
        this.isReady = !this.isReady;
        readyBtn.className = `action-button ready-button ${this.isReady ? 'is-ready' : ''}`;
        readyBtn.textContent = this.isReady ? 'CANCEL READY' : 'READY UP';
        if (this.callbacks.onToggleReady) {
          this.callbacks.onToggleReady(this.isReady);
        }
      });
    }

    // Start match (host)
    const startBtn = this.container.querySelector<HTMLButtonElement>('#start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (this.callbacks.onStartMatch) {
          this.callbacks.onStartMatch();
        }
      });
    }
  }

  private updateCardSelection(): void {
    const cards = this.container.querySelectorAll<HTMLElement>('.archetype-card');
    cards.forEach((card) => {
      const arch = card.getAttribute('data-archetype');
      if (arch === this.selectedArchetype) {
        card.classList.add('selected');
        const btn = card.querySelector<HTMLButtonElement>('.select-card-btn');
        if (btn) btn.textContent = 'SELECTED';
      } else {
        card.classList.remove('selected');
        const btn = card.querySelector<HTMLButtonElement>('.select-card-btn');
        if (btn) btn.textContent = 'SELECT SPEC';
      }
    });
  }

  /**
   * Renders the 2D silhouettes and lighting preview onto each card's mini-canvas.
   */
  private renderCarPreviews(): void {
    const archetypes: CarArchetype[] = ['stadium', 'desert', 'rally'];

    for (const arch of archetypes) {
      const canvas = this.container.querySelector<HTMLCanvasElement>(`#preview-${arch}`);
      if (!canvas) continue;

      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      ctx.save();
      ctx.translate(cx, cy);

      // Subtle track grid backing
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let x = -100; x <= 100; x += 25) {
        ctx.beginPath();
        ctx.moveTo(x, -50);
        ctx.lineTo(x, 50);
        ctx.stroke();
      }

      // Draw archetype preview silhouette
      if (arch === 'stadium') {
        // Front wing
        ctx.fillStyle = '#0a101a';
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8;
        ctx.fillRect(24, -18, 5, 36);
        ctx.strokeRect(24, -18, 5, 36);

        // Body
        ctx.fillStyle = '#0b1626';
        ctx.beginPath();
        ctx.moveTo(27, 0);
        ctx.lineTo(12, -7);
        ctx.lineTo(-6, -11);
        ctx.lineTo(-24, -9);
        ctx.lineTo(-28, 0);
        ctx.lineTo(-24, 9);
        ctx.lineTo(-6, 11);
        ctx.lineTo(12, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cockpit
        ctx.fillStyle = '#00f0ff';
        ctx.beginPath();
        ctx.ellipse(3, 0, 9, 5, 0, 0, Math.PI * 2);
        ctx.fill();

        // Rear Wing
        ctx.fillStyle = '#07101c';
        ctx.fillRect(-30, -16, 6, 32);
        ctx.strokeRect(-30, -16, 6, 32);
      } else if (arch === 'desert') {
        // Muscle Body
        ctx.fillStyle = '#ff4b1f';
        ctx.strokeStyle = '#ffa200';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ff4b1f';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.roundRect(-28, -14, 56, 28, 4);
        ctx.fill();
        ctx.stroke();

        // Stripes
        ctx.fillStyle = '#11131a';
        ctx.fillRect(-28, -4, 56, 3);
        ctx.fillRect(-28, 1.5, 56, 3);

        // Blower
        ctx.fillStyle = '#222833';
        ctx.fillRect(8, -6, 12, 12);
        ctx.fillStyle = '#ff0033';
        ctx.beginPath();
        ctx.arc(18, -3, 2, 0, Math.PI * 2);
        ctx.arc(18, 3, 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Rally
        ctx.fillStyle = '#39ff14';
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.roundRect(-22, -12, 44, 24, 4);
        ctx.fill();
        ctx.stroke();

        // Roof window
        ctx.fillStyle = '#0d1a16';
        ctx.fillRect(-12, -8, 24, 16);

        // Roof scoop
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-3, -3, 8, 6);

        // Mudflaps
        ctx.fillStyle = '#ff0033';
        ctx.fillRect(-24, -14, 4, 3);
        ctx.fillRect(-24, 11, 4, 3);
      }

      ctx.restore();
    }
  }

  private escapeHTML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private injectStyles(): void {
    if (document.getElementById('shooter-lobby-styles')) return;

    const style = document.createElement('style');
    style.id = 'shooter-lobby-styles';
    style.textContent = `
      #shooter-lobby-container {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        justify-content: center;
        align-items: center;
        background: radial-gradient(circle at center, #111422 0%, #080a11 100%);
        color: #ffffff;
        font-family: system-ui, -apple-system, sans-serif;
        user-select: none;
      }

      .lobby-backdrop {
        width: 95%;
        max-width: 1240px;
        height: 90vh;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .lobby-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 2px solid rgba(0, 240, 255, 0.3);
        padding-bottom: 12px;
      }

      .game-title {
        margin: 0;
        font-size: 32px;
        font-weight: 900;
        letter-spacing: 4px;
        background: linear-gradient(90deg, #00f0ff, #39ff14, #ff4b1f);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
      }

      .game-subtitle {
        margin: 2px 0 0;
        font-size: 11px;
        letter-spacing: 2px;
        color: #8899aa;
      }

      .room-code-badge {
        font-family: monospace;
        font-size: 16px;
        font-weight: bold;
        padding: 6px 16px;
        border: 1px solid #00f0ff;
        border-radius: 4px;
        background: rgba(0, 240, 255, 0.1);
        color: #00f0ff;
        box-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
      }

      .lobby-main-grid {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 20px;
        flex: 1;
        min-height: 0;
      }

      .lobby-sidebar {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .cyber-panel {
        background: rgba(14, 18, 28, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }

      .cyber-panel.full-height {
        display: flex;
        flex-direction: column;
        height: calc(100% - 32px);
      }

      .panel-title {
        margin: 0 0 12px;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 1.5px;
        color: #00f0ff;
      }

      .panel-desc {
        margin: 0 0 16px;
        font-size: 12px;
        color: #99aabf;
      }

      .form-group {
        margin-bottom: 12px;
      }

      .form-group label {
        display: block;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 1px;
        color: #8899aa;
        margin-bottom: 6px;
      }

      .cyber-input {
        width: calc(100% - 20px);
        background: #090c14;
        border: 1px solid #28334a;
        color: #ffffff;
        padding: 8px 10px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 14px;
        outline: none;
        transition: border 0.2s;
      }

      .cyber-input:focus {
        border-color: #00f0ff;
        box-shadow: 0 0 8px rgba(0, 240, 255, 0.3);
      }

      .cyber-input.uppercase {
        text-transform: uppercase;
      }

      .input-action-row {
        display: flex;
        gap: 8px;
      }

      .cyber-button {
        background: #1a2336;
        border: 1px solid #3d4f73;
        color: #ffffff;
        padding: 8px 16px;
        border-radius: 4px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.2s;
      }

      .cyber-button:hover {
        background: #253350;
        border-color: #00f0ff;
      }

      .cyber-button.primary {
        background: linear-gradient(135deg, #0077ff, #00f0ff);
        border: none;
        color: #000000;
        font-weight: 900;
        letter-spacing: 1px;
      }

      .cyber-button.primary:hover {
        box-shadow: 0 0 16px rgba(0, 240, 255, 0.6);
      }

      .cyber-button.full-width {
        width: 100%;
        padding: 10px;
      }

      .divider {
        text-align: center;
        font-size: 11px;
        color: #556677;
        margin: 12px 0;
        letter-spacing: 2px;
      }

      .players-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 180px;
        overflow-y: auto;
      }

      .player-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 10px;
        background: rgba(10, 14, 22, 0.7);
        border-radius: 4px;
        border-left: 3px solid #556677;
      }

      .player-row.local-player {
        border-left-color: #00f0ff;
        background: rgba(0, 240, 255, 0.08);
      }

      .player-name {
        font-weight: 700;
        font-size: 13px;
      }

      .host-badge {
        font-size: 9px;
        background: #ffaa00;
        color: #000;
        padding: 2px 4px;
        border-radius: 3px;
        font-weight: 800;
        margin-left: 6px;
      }

      .player-archetype {
        display: block;
        font-size: 10px;
        color: #8899aa;
      }

      .status-badge {
        font-size: 11px;
        font-weight: 800;
        padding: 3px 6px;
        border-radius: 3px;
      }

      .status-badge.ready {
        background: rgba(57, 255, 20, 0.2);
        color: #39ff14;
        border: 1px solid #39ff14;
      }

      .status-badge.not-ready {
        background: rgba(255, 255, 255, 0.05);
        color: #8899aa;
      }

      .archetype-carousel {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
        flex: 1;
        min-height: 0;
      }

      .archetype-card {
        background: rgba(10, 14, 22, 0.8);
        border: 2px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        cursor: pointer;
        transition: all 0.25s ease;
      }

      .archetype-card:hover {
        transform: translateY(-2px);
        border-color: rgba(255, 255, 255, 0.4);
      }

      .archetype-card.selected.stadium {
        border-color: #00f0ff;
        box-shadow: 0 0 20px rgba(0, 240, 255, 0.4);
      }

      .archetype-card.selected.desert {
        border-color: #ff4b1f;
        box-shadow: 0 0 20px rgba(255, 75, 31, 0.4);
      }

      .archetype-card.selected.rally {
        border-color: #39ff14;
        box-shadow: 0 0 20px rgba(57, 255, 20, 0.4);
      }

      .archetype-badge {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 1px;
        margin-bottom: 4px;
      }

      .archetype-badge.stadium { color: #00f0ff; }
      .archetype-badge.desert { color: #ff4b1f; }
      .archetype-badge.rally { color: #39ff14; }

      .archetype-name {
        margin: 0;
        font-size: 18px;
        font-weight: 800;
      }

      .preview-canvas-container {
        display: flex;
        justify-content: center;
        align-items: center;
        margin: 10px 0;
        background: #080a11;
        border-radius: 6px;
        padding: 6px;
      }

      .archetype-desc {
        font-size: 11px;
        color: #99aabf;
        margin: 0 0 10px;
        line-height: 1.4;
      }

      .stat-bars {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 12px;
      }

      .stat-row {
        display: grid;
        grid-template-columns: 75px 1fr 35px;
        align-items: center;
        gap: 8px;
        font-size: 10px;
      }

      .stat-label {
        color: #8899aa;
        font-weight: 700;
      }

      .stat-bar-track {
        height: 6px;
        background: #182030;
        border-radius: 3px;
        overflow: hidden;
      }

      .stat-bar-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.3s;
      }

      .stat-value {
        color: #ffffff;
        font-family: monospace;
        text-align: right;
      }

      .loadout-summary {
        background: rgba(18, 24, 38, 0.6);
        padding: 8px;
        border-radius: 4px;
        font-size: 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
      }

      .loadout-item .key {
        font-weight: bold;
        color: #00f0ff;
        font-family: monospace;
      }

      .select-card-btn {
        margin-top: auto;
        padding: 8px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: #151b2a;
        color: #fff;
        font-weight: 800;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .select-card-btn:hover {
        background: #202b44;
      }

      .lobby-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 14px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .controls-hint {
        font-size: 11px;
        color: #8899aa;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .key-pill {
        background: #1f2a3f;
        padding: 2px 6px;
        border-radius: 3px;
        font-family: monospace;
        color: #00f0ff;
        font-weight: bold;
      }

      .button-group {
        display: flex;
        gap: 12px;
      }

      .action-button {
        padding: 10px 24px;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 1.5px;
        border-radius: 4px;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }

      .ready-button {
        background: #25334d;
        color: #ffffff;
      }

      .ready-button.is-ready {
        background: #39ff14;
        color: #000000;
        box-shadow: 0 0 16px rgba(57, 255, 20, 0.6);
      }

      .start-button {
        background: #ff4b1f;
        color: #ffffff;
        box-shadow: 0 0 16px rgba(255, 75, 31, 0.6);
      }

      .start-button:disabled {
        background: #444;
        color: #888;
        box-shadow: none;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }
}
