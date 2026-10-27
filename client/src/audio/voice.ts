/**
 * WebRTC Voice Chat Manager for Shooter Arena
 * Provides low-latency peer-to-peer spatial audio, Push-to-Talk (PTT),
 * mute toggle, and distance-based volume attenuation / stereo panning.
 */

export interface RemoteSpatialAudioNodes {
  source: MediaStreamAudioSourceNode | null;
  gainNode: GainNode;
  pannerNode: StereoPannerNode | null;
  analyserNode: AnalyserNode;
  audioEl?: HTMLAudioElement;
  stream: MediaStream;
}

export const PUBLIC_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * The server's room cap is 8 players (`MAX_PLAYERS_PER_ROOM` in
 * `server/src/room.rs`), so a full room creates a 7-peer mesh per client. The
 * server already refuses the 9th player; this constant only surfaces the
 * practical limit so the client never opens an unbounded number of PCs.
 */
export const MAX_VOICE_PEERS_PER_ROOM = 7;

/** WebSocket message cap configured by the server (`MAX_WS_MESSAGE_BYTES`). */
export const MAX_SIGNAL_BYTES = 64 * 1024;

export type VoiceConnectionState = 'idle' | 'connecting' | 'connected' | 'unavailable';

/** Reads the raw build-time `VITE_ICE_SERVERS` JSON string, if present. */
export function readIceServersConfig(): string | undefined {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return env?.VITE_ICE_SERVERS;
  } catch {
    return undefined;
  }
}

/**
 * Parses a `VITE_ICE_SERVERS` JSON array of `RTCIceServer` objects.
 *
 * TURN credentials (`username`, `credential`) are passed through untouched;
 * invalid/missing config falls back to the public STUN defaults so a typo
 * degrades to "no TURN" instead of breaking the whole voice client.
 */
export function parseIceServers(raw: string | undefined): RTCIceServer[] {
  if (!raw || !raw.trim()) return PUBLIC_STUN_SERVERS;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('expected a non-empty JSON array');
    }

    const servers: RTCIceServer[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('each ICE server must be an object');
      }
      const value = entry as Record<string, unknown>;
      const urls = value.urls;
      const validUrls =
        typeof urls === 'string' ||
        (Array.isArray(urls) && urls.length > 0 && urls.every((url) => typeof url === 'string'));
      if (!validUrls) {
        throw new Error('each ICE server needs urls as a string or string array');
      }

      const server: RTCIceServer = { urls: urls as string | string[] };
      if (typeof value.username === 'string') server.username = value.username;
      if (typeof value.credential === 'string') server.credential = value.credential;
      // `credentialType` is not present in all TS DOM lib versions; browsers
      // default TURN credentials to the long-term "password" mechanism.
      servers.push(server);
    }
    return servers;
  } catch (err) {
    console.warn('Invalid VITE_ICE_SERVERS, falling back to public STUN:', err);
    return PUBLIC_STUN_SERVERS;
  }
}

/** Build-time resolved ICE server list. */
export const ICE_SERVERS: RTCIceServer[] = parseIceServers(readIceServersConfig());

/**
 * Builds an `RTCPeerConnection` configuration. `relayOnly` forces TURN relay
 * candidates and is used for the single automatic retry after direct ICE fails.
 */
export function buildIceConfiguration(
  relayOnly: boolean,
  servers: RTCIceServer[] = ICE_SERVERS,
): RTCConfiguration {
  return relayOnly
    ? { iceServers: servers, iceTransportPolicy: 'relay' }
    : { iceServers: servers };
}

/** UTF-8 byte length of a signaling payload (SDP/candidate JSON string). */
export function signalByteLength(signalData: string): number {
  return new TextEncoder().encode(signalData).length;
}

/** Guards against sending a signaling payload the server's WS cap would drop. */
export function isSignalWithinWsLimit(signalData: string): boolean {
  return signalByteLength(signalData) <= MAX_SIGNAL_BYTES;
}

export class VoiceChatManager {
  private peers: Map<string, RTCPeerConnection> = new Map();
  private remoteAudioNodes: Map<string, RemoteSpatialAudioNodes> = new Map();
  private pendingCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private initiatorPeers: Map<string, boolean> = new Map();
  private relayOnlyPeers: Set<string> = new Set();
  private relayRetried: Set<string> = new Set();

  private localStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private localPlayerId: string | null = null;
  private lastVoiceState: VoiceConnectionState = 'idle';

  private transmitting = false;
  private muted = false;
  private isDisposed = false;

  public onSignal?: (targetPlayerId: string, signalData: string) => void;
  public onSpeakingChange?: (playerId: string, speaking: boolean) => void;
  public onVoiceStateChange?: (state: VoiceConnectionState, connectedPeers: number) => void;

  constructor(onSignal?: (targetPlayerId: string, signalData: string) => void) {
    if (onSignal) {
      this.onSignal = onSignal;
    }
    this.bindKeyListeners();
  }

  /** Needed for deterministic offer/relay-retry election once the server assigns an ID. */
  public setLocalPlayerId(playerId: string): void {
    this.localPlayerId = playerId;
  }

  public getMaxPeers(): number {
    return MAX_VOICE_PEERS_PER_ROOM;
  }

  public getConnectedPeerCount(): number {
    let connected = 0;
    for (const pc of this.peers.values()) {
      if (pc.connectionState === 'connected') connected++;
    }
    return connected;
  }

  public getVoiceState(): VoiceConnectionState {
    if (this.peers.size === 0) return 'idle';

    let connected = 0;
    let failed = false;
    for (const pc of this.peers.values()) {
      if (pc.connectionState === 'connected') connected++;
      if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') failed = true;
    }

    if (failed) return 'unavailable';
    if (connected === this.peers.size) return 'connected';
    return 'connecting';
  }

  private emitVoiceState(): void {
    const state = this.getVoiceState();
    const connected = this.getConnectedPeerCount();
    this.lastVoiceState = state;
    if (this.onVoiceStateChange) {
      this.onVoiceStateChange(state, connected);
    }
  }

  /** Returns the currently advertised voice state (also used by the HUD). */
  public getLastVoiceState(): VoiceConnectionState {
    return this.lastVoiceState;
  }

  private shouldInitiate(remotePlayerId: string): boolean {
    if (this.localPlayerId) {
      return this.localPlayerId < remotePlayerId;
    }
    return this.initiatorPeers.get(remotePlayerId) ?? true;
  }

  // ============================================================================
  // Keybinds & Push-To-Talk / Mute Controls
  // ============================================================================

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.isInputField(e.target)) return;

    if (e.code === 'KeyV' || e.key === 'v' || e.key === 'V') {
      if (!e.repeat) {
        this.setTransmitting(true);
      }
    } else if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
      if (!e.repeat) {
        this.toggleMute();
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.isInputField(e.target)) return;

    if (e.code === 'KeyV' || e.key === 'v' || e.key === 'V') {
      this.setTransmitting(false);
    }
  };

  private isInputField(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    return (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );
  }

  private bindKeyListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
    }
  }

  private unbindKeyListeners(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
    }
  }

  public setTransmitting(transmitting: boolean): void {
    this.transmitting = transmitting;
    this.resumeAudioContext();
    if (this.transmitting && !this.localStream) {
      this.initLocalAudio().catch(() => {});
    } else {
      this.applyLocalTrackState();
    }
  }

  public isTransmitting(): boolean {
    return this.transmitting && !this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    this.resumeAudioContext();
    this.applyLocalTrackState();
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyLocalTrackState();
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private applyLocalTrackState(): void {
    const shouldTransmit = this.transmitting && !this.muted;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        track.enabled = shouldTransmit;
      }
    }
  }

  // ============================================================================
  // Audio Context & Media Capture
  // ============================================================================

  public getAudioContext(): AudioContext | null {
    if (this.audioContext) return this.audioContext;
    if (typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.audioContext = new AudioCtx();
      }
    }
    return this.audioContext;
  }

  private resumeAudioContext(): void {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
  }

  public async initLocalAudio(): Promise<MediaStream | null> {
    if (this.localStream) return this.localStream;
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        this.localStream = stream;
        this.applyLocalTrackState();

        // Add local tracks to any existing peer connections
        for (const [_, pc] of this.peers) {
          for (const track of stream.getAudioTracks()) {
            pc.addTrack(track, stream);
          }
        }
        return stream;
      } catch (err) {
        console.warn('getUserMedia audio capture failed:', err);
        return null;
      }
    }
    return null;
  }

  // ============================================================================
  // Spatial Audio & Volume Attenuation
  // ============================================================================

  /**
   * Attenuates remote player audio volume based on Euclidean distance
   * (0px -> 1.0 volume, > 1600px -> 0.0 volume) with stereo panning (-1.0 left to +1.0 right).
   */
  public updateSpatialAudio(
    listenerPos: { x: number; y: number },
    remotePositions: Map<string, { x: number; y: number }>
  ): void {
    const ctx = this.getAudioContext();

    for (const [playerId, nodes] of this.remoteAudioNodes) {
      const remotePos = remotePositions.get(playerId);
      if (!remotePos) continue;

      const dx = remotePos.x - listenerPos.x;
      const dy = remotePos.y - listenerPos.y;
      const distance = Math.hypot(dx, dy);

      // Volume attenuation: 0px -> 1.0, >= 1600px -> 0.0
      let volume = 0.0;
      if (distance <= 0) {
        volume = 1.0;
      } else if (distance >= 1600) {
        volume = 0.0;
      } else {
        volume = 1.0 - distance / 1600.0;
      }

      // Stereo panning based on horizontal offset (-1.0 to 1.0 across 800px spread)
      const pan = Math.max(-1.0, Math.min(1.0, dx / 800.0));

      if (ctx) {
        try {
          nodes.gainNode.gain.setValueAtTime(volume, ctx.currentTime);
          if (nodes.pannerNode) {
            nodes.pannerNode.pan.setValueAtTime(pan, ctx.currentTime);
          }
        } catch {
          // Fallback if audio node properties fail
          nodes.gainNode.gain.value = volume;
          if (nodes.pannerNode) {
            nodes.pannerNode.pan.value = pan;
          }
        }
      }
    }
  }

  /**
   * Checks if remote player is currently speaking via AnalyserNode frequency detection.
   */
  public isRemoteSpeaking(playerId: string): boolean {
    const nodes = this.remoteAudioNodes.get(playerId);
    if (!nodes) return false;

    const dataArray = new Uint8Array(nodes.analyserNode.frequencyBinCount);
    nodes.analyserNode.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    const average = sum / dataArray.length;
    return average > 15;
  }

  private setupRemoteAudio(playerId: string, stream: MediaStream): void {
    const ctx = this.getAudioContext();
    if (!ctx) return;

    this.cleanupAudioNodes(playerId);

    try {
      const source = ctx.createMediaStreamSource(stream);
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(1.0, ctx.currentTime);

      let pannerNode: StereoPannerNode | null = null;
      if (typeof ctx.createStereoPanner === 'function') {
        pannerNode = ctx.createStereoPanner();
        pannerNode.pan.setValueAtTime(0.0, ctx.currentTime);
      }

      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 64;

      // Pipeline: Source -> (StereoPanner) -> Gain -> Analyser -> Destination
      if (pannerNode) {
        source.connect(pannerNode);
        pannerNode.connect(gainNode);
      } else {
        source.connect(gainNode);
      }
      gainNode.connect(analyserNode);
      analyserNode.connect(ctx.destination);

      // Hidden audio element to keep stream decoding active in Chromium
      let audioEl: HTMLAudioElement | undefined;
      if (typeof document !== 'undefined') {
        audioEl = document.createElement('audio');
        audioEl.srcObject = stream;
        audioEl.autoplay = true;
        audioEl.muted = true; // Muted to prevent double output alongside AudioContext
        audioEl.play().catch(() => {});
      }

      this.remoteAudioNodes.set(playerId, {
        source,
        gainNode,
        pannerNode,
        analyserNode,
        audioEl,
        stream,
      });
    } catch (err) {
      console.warn(`Failed to set up remote audio for peer ${playerId}:`, err);
    }
  }

  private cleanupAudioNodes(playerId: string): void {
    const nodes = this.remoteAudioNodes.get(playerId);
    if (nodes) {
      try {
        if (nodes.source) nodes.source.disconnect();
        if (nodes.pannerNode) nodes.pannerNode.disconnect();
        nodes.gainNode.disconnect();
        nodes.analyserNode.disconnect();
        if (nodes.audioEl) {
          nodes.audioEl.srcObject = null;
          nodes.audioEl.remove();
        }
      } catch {}
      this.remoteAudioNodes.delete(playerId);
    }
  }

  // ============================================================================
  // WebRTC Peer Connection & Signaling
  // ============================================================================

  public async addPeer(
    remotePlayerId: string,
    isInitiator: boolean,
    relayOnly = false,
  ): Promise<void> {
    if (this.isDisposed || this.peers.has(remotePlayerId)) return;
    if (typeof RTCPeerConnection === 'undefined') {
      return;
    }
    if (this.peers.size >= MAX_VOICE_PEERS_PER_ROOM) {
      console.warn(
        `Voice mesh peer cap reached (${MAX_VOICE_PEERS_PER_ROOM}); not connecting ${remotePlayerId}`
      );
      return;
    }

    this.initiatorPeers.set(remotePlayerId, isInitiator);
    if (relayOnly) {
      this.relayOnlyPeers.add(remotePlayerId);
    }

    const pc = new RTCPeerConnection(buildIceConfiguration(relayOnly));
    this.peers.set(remotePlayerId, pc);
    this.emitVoiceState();

    // Attach local stream tracks
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    // ICE Candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate && this.onSignal) {
        this.onSignal(
          remotePlayerId,
          JSON.stringify({
            type: 'candidate',
            candidate: event.candidate,
          })
        );
      }
    };

    // Remote audio track handler
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      this.setupRemoteAudio(remotePlayerId, stream);
    };

    pc.oniceconnectionstatechange = () => {
      // Ignore stale PCs that were replaced by a relay retry.
      if (this.peers.get(remotePlayerId) !== pc) return;

      if (pc.iceConnectionState === 'failed') {
        console.warn(`ICE failed for voice peer ${remotePlayerId}; retrying via TURN relay`);
        this.retryWithRelay(remotePlayerId);
      }
      this.emitVoiceState();
    };

    pc.onconnectionstatechange = () => {
      if (this.peers.get(remotePlayerId) !== pc) return;

      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.cleanupAudioNodes(remotePlayerId);
      }
      if (pc.connectionState === 'failed') {
        this.retryWithRelay(remotePlayerId);
      }
      this.emitVoiceState();
    };

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (this.onSignal) {
          // `relayRetry` tells the answerer to rebuild its side with
          // iceTransportPolicy: 'relay' as well.
          this.onSignal(
            remotePlayerId,
            JSON.stringify(relayOnly ? { ...offer, relayRetry: true } : offer)
          );
        }
      } catch (err) {
        console.warn(`Failed to create WebRTC offer for ${remotePlayerId}:`, err);
      }
    }
  }

  /**
   * One automatic repair attempt: rebuild the peer with relay-only ICE. The
   * deterministic lower-ID side sends the new offer so both sides do not glare.
   */
  private retryWithRelay(remotePlayerId: string): void {
    if (this.isDisposed || this.relayRetried.has(remotePlayerId)) return;
    this.relayRetried.add(remotePlayerId);

    const initiate = this.shouldInitiate(remotePlayerId);
    this.removePeer(remotePlayerId);
    void this.addPeer(remotePlayerId, initiate, true);
  }

  public removePeer(remotePlayerId: string): void {
    const pc = this.peers.get(remotePlayerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      this.peers.delete(remotePlayerId);
    }

    this.cleanupAudioNodes(remotePlayerId);
    this.pendingCandidates.delete(remotePlayerId);
    this.initiatorPeers.delete(remotePlayerId);
    this.relayOnlyPeers.delete(remotePlayerId);
    this.emitVoiceState();
  }

  public async handleSignal(fromPlayerId: string, signalData: string): Promise<void> {
    if (this.isDisposed) return;
    if (!isSignalWithinWsLimit(signalData)) {
      console.warn(
        `Dropping oversized WebRTC signal from ${fromPlayerId} (${signalByteLength(signalData)} bytes > ${MAX_SIGNAL_BYTES})`
      );
      return;
    }

    let data: any;
    try {
      data = JSON.parse(signalData);
    } catch (err) {
      console.warn(`Invalid WebRTC signal JSON from ${fromPlayerId}:`, err);
      return;
    }

    if (data.type === 'offer') {
      const relayOnly = data.relayRetry === true;
      if (relayOnly) {
        // The initiator already used its one retry; do not loop on failure.
        this.relayRetried.add(fromPlayerId);
      }
      let pc = this.peers.get(fromPlayerId);

      // The initiator fell back to TURN; rebuild our legacy direct PC so the
      // answer also uses relay candidates.
      if (pc && relayOnly && !this.relayOnlyPeers.has(fromPlayerId)) {
        this.removePeer(fromPlayerId);
        pc = undefined;
      }
      if (!pc) {
        await this.addPeer(fromPlayerId, false, relayOnly);
        pc = this.peers.get(fromPlayerId);
      }
      if (!pc) return;

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        await this.flushPendingCandidates(fromPlayerId, pc);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (this.onSignal) {
          this.onSignal(fromPlayerId, JSON.stringify(answer));
        }
      } catch (err) {
        console.warn(`Error handling offer from ${fromPlayerId}:`, err);
      }
    } else if (data.type === 'answer') {
      const pc = this.peers.get(fromPlayerId);
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data));
          await this.flushPendingCandidates(fromPlayerId, pc);
        } catch (err) {
          console.warn(`Error setting remote answer from ${fromPlayerId}:`, err);
        }
      }
    } else if (data.type === 'candidate' || data.candidate) {
      const candidateInit: RTCIceCandidateInit = data.candidate || data;
      const pc = this.peers.get(fromPlayerId);

      if (pc && pc.remoteDescription && pc.remoteDescription.type) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidateInit));
        } catch (err) {
          console.warn(`Failed to add ICE candidate from ${fromPlayerId}:`, err);
        }
      } else {
        // Queue candidates that arrive prior to setRemoteDescription
        if (!this.pendingCandidates.has(fromPlayerId)) {
          this.pendingCandidates.set(fromPlayerId, []);
        }
        this.pendingCandidates.get(fromPlayerId)!.push(candidateInit);
      }
    }
  }

  private async flushPendingCandidates(playerId: string, pc: RTCPeerConnection): Promise<void> {
    const queue = this.pendingCandidates.get(playerId);
    if (!queue || queue.length === 0) return;

    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn(`Error flushing queued candidate for ${playerId}:`, err);
      }
    }
    this.pendingCandidates.delete(playerId);
  }

  public getPeer(playerId: string): RTCPeerConnection | undefined {
    return this.peers.get(playerId);
  }

  public getPeers(): Map<string, RTCPeerConnection> {
    return this.peers;
  }

  public dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    this.unbindKeyListeners();

    for (const [playerId] of this.peers) {
      this.removePeer(playerId);
    }
    this.peers.clear();
    this.remoteAudioNodes.clear();
    this.pendingCandidates.clear();
    this.initiatorPeers.clear();
    this.relayOnlyPeers.clear();
    this.relayRetried.clear();

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        track.stop();
      }
      this.localStream = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
