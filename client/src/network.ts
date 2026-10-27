// Client WebSocket Network Client for Shooter

export interface ServerLobbyPlayer {
  id: string;
  name: string;
  car_type: string;
  carType?: string;
  is_host: boolean;
  isHost?: boolean;
  ready: boolean;
}

export interface ServerLobbyUpdate {
  type: 'LobbyUpdate';
  room_code: string;
  roomCode?: string;
  is_host: boolean;
  isHost?: boolean;
  your_id: string;
  yourId?: string;
  players: ServerLobbyPlayer[];
  status: string;
  map: string;
  countdown?: number | null;
  round?: number;
  total_rounds?: number;
  totalRounds?: number;
}

export interface ServerGameStart {
  type: 'GameStart';
  map: string;
  tick_rate: number;
  tickRate?: number;
  countdown: number;
  round?: number;
  total_rounds?: number;
  totalRounds?: number;
  match_time_remaining?: number;
  matchTimeRemaining?: number;
}

export interface ServerPlayerState {
  id: string;
  name: string;
  car_type: string;
  carType?: string;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  angular_velocity: number;
  angularVelocity?: number;
  steer: number;
  health: number;
  max_health: number;
  maxHealth?: number;
  shield: number;
  is_alive: boolean;
  isAlive?: boolean;
  respawn_timer: number;
  respawnTimer?: number;
  boost: number;
  score: number;
  kills: number;
  deaths: number;
  drift: boolean;
  last_processed_input: number;
  lastProcessedInput?: number;
}

export interface ServerProjectileState {
  id: number;
  owner_id: string;
  ownerId?: string;
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  lifetime: number;
}

export interface ServerHazardState {
  id: number;
  owner_id: string;
  ownerId?: string;
  kind: string;
  x: number;
  y: number;
  radius: number;
  active: boolean;
  duration: number;
}

export interface ServerKillFeedItem {
  killer_id: string;
  killerId?: string;
  killer_name: string;
  killerName?: string;
  victim_id: string;
  victimId?: string;
  victim_name: string;
  victimName?: string;
  weapon: string;
  timestamp: number;
}

export interface ServerWorldState {
  type: 'WorldState';
  tick: number;
  timestamp: number;
  players: ServerPlayerState[];
  projectiles: ServerProjectileState[];
  hazards: ServerHazardState[];
  killfeed: ServerKillFeedItem[];
  round?: number;
  total_rounds?: number;
  totalRounds?: number;
  match_time_remaining?: number;
  matchTimeRemaining?: number;
}

export interface ServerScoreEntry {
  player_id: string;
  playerId?: string;
  name: string;
  car_type: string;
  carType?: string;
  kills: number;
  deaths: number;
  score: number;
}

export interface ServerGameOver {
  type: 'GameOver';
  winner_id: string;
  winnerId?: string;
  scoreboard: ServerScoreEntry[];
  is_tournament_complete?: boolean;
  isTournamentComplete?: boolean;
}

export type ServerMessage =
  | ServerLobbyUpdate
  | ServerGameStart
  | ServerWorldState
  | ServerGameOver
  | { type: 'Pong'; client_time: number; server_time: number }
  | { type: 'Error'; message: string }
  | {
      type: 'VoiceSignal';
      from_player_id: string;
      fromPlayerId?: string;
      signal_data: string;
      signalData?: string;
    };

export class NetworkClient {
  private ws: WebSocket | null = null;
  private url: string;
  private isConnected = false;
  private localPlayerId: string | null = null;
  private pingInterval: number | null = null;
  public latency = 0;

  public onLobbyUpdate?: (msg: ServerLobbyUpdate) => void;
  public onGameStart?: (msg: ServerGameStart) => void;
  public onWorldState?: (msg: ServerWorldState) => void;
  public onGameOver?: (msg: ServerGameOver) => void;
  public onVoiceSignal?: (fromPlayerId: string, signalData: string) => void;
  public onError?: (msg: string) => void;
  public onDisconnect?: () => void;
  public onConnect?: () => void;

  constructor(customUrl?: string) {
    if (customUrl) {
      this.url = this.formatWsUrl(customUrl);
    } else {
      this.url = this.resolveServerUrl();
    }
  }

  public getUrl(): string {
    return this.url;
  }

  /**
   * Resolves backend WebSocket server URL with precedence:
   * 1. URL search params: ?server=...
   * 2. localStorage: 'shooter_server_url'
   * 3. (window as any).SHOOTER_SERVER_URL
   * 4. import.meta.env?.VITE_WS_URL
   * 5. Default:
   *    If localhost or 127.0.0.1 or port 3000 -> ${proto}//${loc.hostname}:8080/ws
   *    Otherwise remote domain (e.g. Cloudflare Pages *.pages.dev) -> ${proto}//${loc.host}/ws
   */
  private resolveServerUrl(): string {
    if (typeof window === 'undefined') {
      return 'ws://localhost:8080/ws';
    }

    // 1. URL search params: ?server=...
    try {
      const urlParam = new URLSearchParams(window.location.search).get('server');
      if (urlParam) {
        return this.formatWsUrl(urlParam);
      }
    } catch {}

    // 2. localStorage: shooter_server_url
    try {
      const stored = localStorage.getItem('shooter_server_url');
      if (stored) {
        return this.formatWsUrl(stored);
      }
    } catch {}

    // 3. window.SHOOTER_SERVER_URL
    const win = window as unknown as { SHOOTER_SERVER_URL?: string };
    if (win && win.SHOOTER_SERVER_URL) {
      return this.formatWsUrl(win.SHOOTER_SERVER_URL);
    }

    // 4. import.meta.env?.VITE_WS_URL
    try {
      const envUrl = (import.meta as unknown as { env?: { VITE_WS_URL?: string } }).env?.VITE_WS_URL;
      if (envUrl) {
        return this.formatWsUrl(envUrl);
      }
    } catch {}

    // 5. Default host resolution
    const loc = window.location;
    const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    if (loc.hostname === 'localhost' || loc.hostname === '127.0.0.1' || loc.port === '3000') {
      return `${proto}//${loc.hostname}:8080/ws`;
    }
    // Static hosts such as Cloudflare Pages have no WebSocket endpoint. Players
    // must configure the Oracle/backend URL (lobby field, ?server=, or VITE_WS_URL).
    if (loc.hostname.endsWith('.pages.dev') || loc.hostname.endsWith('.workers.dev')) {
      console.warn(
        'No backend URL configured for this static host. Set ?server=wss://your-server/ws or save the endpoint in the lobby.'
      );
    }
    return `${proto}//${loc.host}/ws`;
  }

  private formatWsUrl(raw: string): string {
    let u = raw.trim();
    if (u.startsWith('http://')) {
      u = 'ws://' + u.slice(7);
    } else if (u.startsWith('https://')) {
      u = 'wss://' + u.slice(8);
    } else if (!u.startsWith('ws://') && !u.startsWith('wss://')) {
      const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      u = `${proto}//${u}`;
    }
    if (!u.endsWith('/ws')) {
      u = u.replace(/\/+$/, '') + '/ws';
    }
    return u;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.startPing();
          if (this.onConnect) this.onConnect();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data: ServerMessage = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.warn('WebSocket connection error:', err);
          if (!this.isConnected) {
            reject(err);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.stopPing();
          if (this.onDisconnect) this.onDisconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  public getConnected(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }

  public getLocalPlayerId(): string | null {
    return this.localPlayerId;
  }

  public setLocalPlayerId(id: string): void {
    this.localPlayerId = id;
  }

  public joinLobby(name: string, roomCode?: string, carType: string = 'stadium'): void {
    this.send({
      type: 'JoinLobby',
      name,
      room_code: roomCode || null,
      car_type: carType,
    });
  }

  public setReady(ready: boolean): void {
    this.send({
      type: 'SetReady',
      ready,
    });
  }

  public selectCar(carType: string): void {
    this.send({
      type: 'SelectCar',
      car_type: carType,
    });
  }

  public startGame(): void {
    this.send({
      type: 'StartGame',
    });
  }

  public sendInput(
    sequence: number,
    throttle: number,
    steer: number,
    brake: boolean,
    firePrimary: boolean,
    fireSpecial: boolean,
    abilityMobility: boolean,
    abilityUtility: boolean,
    turnaround: boolean = false
  ): void {
    this.send({
      type: 'PlayerInput',
      sequence,
      throttle,
      steer,
      brake,
      fire_primary: firePrimary,
      fire_special: fireSpecial,
      ability_mobility: abilityMobility,
      ability_utility: abilityUtility,
      turnaround,
    });
  }

  public sendNeutralInput(sequence: number): void {
    this.sendInput(sequence, 0, 0, false, false, false, false, false, false);
  }

  public sendVoiceSignal(targetPlayerId: string, signalData: string): void {
    this.send({
      type: 'VoiceSignal',
      target_player_id: targetPlayerId,
      signal_data: signalData,
    });
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
          type: 'Ping',
          client_time: Date.now(),
        });
      }
    }, 2000);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'LobbyUpdate':
        if (this.onLobbyUpdate) this.onLobbyUpdate(msg);
        break;
      case 'GameStart':
        if (this.onGameStart) this.onGameStart(msg);
        break;
      case 'WorldState':
        if (this.onWorldState) this.onWorldState(msg);
        break;
      case 'GameOver':
        if (this.onGameOver) this.onGameOver(msg);
        break;
      case 'Pong': {
        const now = Date.now();
        this.latency = Math.max(1, Math.round((now - msg.client_time) / 2));
        break;
      }
      case 'VoiceSignal': {
        const fromId = msg.from_player_id || msg.fromPlayerId || '';
        const data = msg.signal_data || msg.signalData || '';
        if (this.onVoiceSignal && fromId) {
          this.onVoiceSignal(fromId, data);
        }
        break;
      }
      case 'Error':
        console.warn('Server error:', msg.message);
        if (this.onError) this.onError(msg.message);
        break;
    }
  }

  public disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
