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
  players: ServerLobbyPlayer[];
  status: string;
  map: string;
  countdown?: number | null;
}

export interface ServerGameStart {
  type: 'GameStart';
  map: string;
  tick_rate: number;
  tickRate?: number;
  countdown: number;
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
}

export type ServerMessage =
  | ServerLobbyUpdate
  | ServerGameStart
  | ServerWorldState
  | ServerGameOver
  | { type: 'Pong'; client_time: number; server_time: number }
  | { type: 'Error'; message: string };

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
  public onError?: (msg: string) => void;
  public onDisconnect?: () => void;
  public onConnect?: () => void;

  constructor(customUrl?: string) {
    if (customUrl) {
      this.url = customUrl;
    } else {
      const loc = window.location;
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      // If served from Vite dev on 3000, target server on 8080
      const host = loc.port === '3000' ? `${loc.hostname}:8080` : loc.host;
      this.url = `${proto}//${host}/ws`;
    }
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
    abilityUtility: boolean
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
