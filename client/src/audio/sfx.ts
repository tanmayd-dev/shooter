import type { CarArchetype } from '../types.ts';

/**
 * Procedural Web Audio API Synthesizer
 * Zero external audio files required, zero latency, 100% offline.
 */
class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private isMuted: boolean = false;

  // Engine sound state
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineWhineOsc: OscillatorNode | null = null;
  private engineWaveshaper: WaveShaperNode | null = null;
  private currentArchetype: CarArchetype = 'stadium';
  private engineStarted: boolean = false;

  // Tire screech state
  private screechGain: GainNode | null = null;
  private screechFilter: BiquadFilterNode | null = null;
  private screechSource: AudioBufferSourceNode | null = null;
  private screechStarted: boolean = false;

  private distortionCurveCache: Float32Array<ArrayBuffer> | null = null;

  constructor() {
    // AudioContext will be initialized on first user interaction
  }

  /**
   * Initializes or resumes the AudioContext on user gesture.
   */
  public ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return null;

      this.ctx = new AudioCtxClass();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.initTireScreech();
      this.initEngine();
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  // ==========================================
  // DISTORTION CURVE HELPER
  // ==========================================
  private makeDistortionCurve(amount: number = 20): Float32Array<ArrayBuffer> {
    if (this.distortionCurveCache && amount === 20) {
      return this.distortionCurveCache;
    }
    const n = 256;
    const buffer = new ArrayBuffer(n * 4);
    const curve = new Float32Array(buffer);
    const deg = Math.PI / 180;
    for (let i = 0; i < n; ++i) {
      const x = (i * 2) / n - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    if (amount === 20) this.distortionCurveCache = curve;
    return curve;
  }

  // ==========================================
  // ENGINE SOUND SYNTHESIS
  // ==========================================
  private initEngine(): void {
    if (!this.ctx || !this.masterGain || this.engineStarted) return;

    try {
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(0.001, this.ctx.currentTime);

      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.setValueAtTime(600, this.ctx.currentTime);
      this.engineFilter.Q.setValueAtTime(3.0, this.ctx.currentTime);

      this.engineWaveshaper = this.ctx.createWaveShaper();
      this.engineWaveshaper.curve = this.makeDistortionCurve(25);
      this.engineWaveshaper.oversample = '2x';

      this.engineOsc1 = this.ctx.createOscillator();
      this.engineOsc1.type = 'sawtooth';
      this.engineOsc1.frequency.setValueAtTime(65, this.ctx.currentTime);

      this.engineOsc2 = this.ctx.createOscillator();
      this.engineOsc2.type = 'sawtooth';
      this.engineOsc2.frequency.setValueAtTime(65.4, this.ctx.currentTime);

      this.engineWhineOsc = this.ctx.createOscillator();
      this.engineWhineOsc.type = 'sine';
      this.engineWhineOsc.frequency.setValueAtTime(260, this.ctx.currentTime);

      const whineGain = this.ctx.createGain();
      whineGain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      this.engineWhineOsc.connect(whineGain);
      whineGain.connect(this.engineFilter);

      this.engineOsc1.connect(this.engineWaveshaper);
      this.engineOsc2.connect(this.engineWaveshaper);
      this.engineWaveshaper.connect(this.engineFilter);

      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();
      this.engineWhineOsc.start();
      this.engineStarted = true;
    } catch {
      // Audio node start error handling
    }
  }

  /**
   * Dynamically modulates engine RPM, pitch, harmonic richness, and volume.
   * @param speedRatio Normalized speed (0.0 to 1.2+)
   * @param throttle True if accelerating
   * @param archetype Car spec
   */
  public updateEngine(speedRatio: number, throttle: boolean, archetype: CarArchetype): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain || !this.engineWhineOsc) {
      return;
    }

    if (this.currentArchetype !== archetype) {
      this.currentArchetype = archetype;
      if (archetype === 'desert') {
        this.engineOsc1.type = 'sawtooth';
        this.engineOsc2.type = 'triangle';
        this.engineFilter.Q.setTargetAtTime(1.5, ctx.currentTime, 0.1);
      } else if (archetype === 'rally') {
        this.engineOsc1.type = 'square';
        this.engineOsc2.type = 'sawtooth';
        this.engineFilter.Q.setTargetAtTime(4.0, ctx.currentTime, 0.1);
      } else {
        // stadium
        this.engineOsc1.type = 'sawtooth';
        this.engineOsc2.type = 'sawtooth';
        this.engineFilter.Q.setTargetAtTime(3.0, ctx.currentTime, 0.1);
      }
    }

    const t = ctx.currentTime;
    const clampedSpeed = Math.max(0, Math.min(speedRatio, 1.5));

    let baseFreq: number;
    let maxFreq: number;
    let filterMin: number;
    let filterMax: number;

    switch (archetype) {
      case 'desert': // Low roaring supercharged V8
        baseFreq = 38;
        maxFreq = 260;
        filterMin = 350;
        filterMax = 2200;
        break;
      case 'rally': // High-revving turbo inline-4
        baseFreq = 52;
        maxFreq = 480;
        filterMin = 450;
        filterMax = 3800;
        break;
      case 'stadium': // Screaming Formula V10 / electric KERS
      default:
        baseFreq = 68;
        maxFreq = 720;
        filterMin = 500;
        filterMax = 5200;
        break;
    }

    // RPM curve simulates gear changes and high revs
    const gearSteps = 5;
    const gearProgress = (clampedSpeed * gearSteps) % 1.0;
    const gearBase = Math.floor(clampedSpeed * gearSteps) / gearSteps;
    const effectiveRPM = gearBase * 0.45 + gearProgress * 0.55;

    const targetFreq = baseFreq + effectiveRPM * (maxFreq - baseFreq) + (throttle ? 18 : 0);
    const targetFilterFreq = filterMin + clampedSpeed * (filterMax - filterMin) + (throttle ? 300 : 0);
    const targetWhineFreq = targetFreq * (archetype === 'stadium' ? 5.5 : 3.0);

    const targetGain = (0.08 + clampedSpeed * 0.14 + (throttle ? 0.05 : 0)) * (this.isMuted ? 0 : 1);

    this.engineOsc1.frequency.setTargetAtTime(targetFreq, t, 0.04);
    this.engineOsc2.frequency.setTargetAtTime(targetFreq * 1.008, t, 0.04);
    this.engineWhineOsc.frequency.setTargetAtTime(targetWhineFreq, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(targetFilterFreq, t, 0.06);
    this.engineGain.gain.setTargetAtTime(targetGain, t, 0.05);
  }

  // ==========================================
  // TIRE SCREECH SYNTHESIS
  // ==========================================
  private initTireScreech(): void {
    if (!this.ctx || !this.masterGain || this.screechStarted) return;

    try {
      // 2 seconds looping white noise buffer
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.screechSource = this.ctx.createBufferSource();
      this.screechSource.buffer = noiseBuffer;
      this.screechSource.loop = true;

      // Bandpass filter to isolate rubber screech frequencies (1000 - 1800 Hz)
      this.screechFilter = this.ctx.createBiquadFilter();
      this.screechFilter.type = 'bandpass';
      this.screechFilter.frequency.setValueAtTime(1250, this.ctx.currentTime);
      this.screechFilter.Q.setValueAtTime(3.5, this.ctx.currentTime);

      const highpass = this.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.setValueAtTime(600, this.ctx.currentTime);

      this.screechGain = this.ctx.createGain();
      this.screechGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      this.screechSource.connect(this.screechFilter);
      this.screechFilter.connect(highpass);
      highpass.connect(this.screechGain);
      this.screechGain.connect(this.masterGain);

      this.screechSource.start();
      this.screechStarted = true;
    } catch {
      // Failed to init noise source
    }
  }

  /**
   * Modulates tire screech noise based on vehicle skid intensity.
   * @param skidIntensity 0.0 (no slip) to 1.0 (extreme drift)
   */
  public updateSkid(skidIntensity: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.screechGain || !this.screechFilter) return;

    const t = ctx.currentTime;
    const intensity = Math.max(0, Math.min(skidIntensity, 1.0));

    // Threshold: below 0.15, silence tire screech
    const targetGain = intensity > 0.15 ? (intensity - 0.15) * 0.35 : 0.0001;
    // Pitch shift screech upwards slightly as slip speed increases
    const targetFreq = 1100 + intensity * 600;

    this.screechGain.gain.setTargetAtTime(this.isMuted ? 0 : targetGain, t, 0.04);
    this.screechFilter.frequency.setTargetAtTime(targetFreq, t, 0.06);
  }

  // ==========================================
  // COUNTDOWN BEEP (3 - 2 - 1 - GO)
  // ==========================================
  /**
   * Authentic Trackmania-style countdown tones:
   * 440 Hz short beeps for 3, 2, 1; 880 Hz bright chime for GO!
   */
  public countdownBeep(frequency: number = 440, isFinal: boolean = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    if (isFinal) {
      // Bright 880 Hz GO! chime with harmonic overtone
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency || 880, t);

      const overtone = ctx.createOscillator();
      overtone.type = 'sine';
      overtone.frequency.setValueAtTime((frequency || 880) * 2, t);

      const overtoneGain = ctx.createGain();
      overtoneGain.gain.setValueAtTime(0.3, t);
      overtoneGain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      overtone.connect(overtoneGain);
      overtoneGain.connect(this.masterGain);
      overtone.start(t);
      overtone.stop(t + 0.38);

      gain.gain.setValueAtTime(0.45, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.48);
    } else {
      // 440 Hz low beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency || 440, t);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.18);
    }
  }

  // ==========================================
  // BOOST PAD WHOOSH
  // ==========================================
  /**
   * Resonant frequency sweep when running over boost chevrons.
   */
  public boostPadWhoosh(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    const t = ctx.currentTime;
    const duration = 0.38;

    // Resonant sweep oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(240, t);
    osc.frequency.exponentialRampToValueAtTime(1100, t + duration * 0.7);

    // Resonant Bandpass filter sweeping upward
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(7.0, t);
    filter.frequency.setValueAtTime(320, t);
    filter.frequency.exponentialRampToValueAtTime(2800, t + duration);

    // Ascending sub layer for tactile punch
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(160, t);
    subOsc.frequency.exponentialRampToValueAtTime(440, t + duration * 0.5);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.38, t + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(filter);
    filter.connect(gain);
    subOsc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    subOsc.start(t);
    osc.stop(t + duration);
    subOsc.stop(t + duration);
  }

  // ==========================================
  // GUN SHOT SOUNDS
  // ==========================================
  /**
   * Crisp acoustic kinetic pulse sound with quick pitch drop per archetype.
   */
  public gunShot(carType: CarArchetype): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    const t = ctx.currentTime;

    if (carType === 'stadium') {
      // Rapid pulse blaster: fast high-tech laser/plasma pulse
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(950, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.08);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, t);
      filter.Q.setValueAtTime(3.0, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.09);
    } else if (carType === 'desert') {
      // Heavy autocannon: heavy mechanical punch, low pitch drop + noise crack
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(42, t + 0.16);

      const shaper = ctx.createWaveShaper();
      shaper.curve = this.makeDistortionCurve(35);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.42, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

      osc.connect(shaper);
      shaper.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.18);
    } else {
      // Rally: Precision rail slug: snappy metallic whip/crack
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1500, t);
      osc.frequency.exponentialRampToValueAtTime(190, t + 0.11);

      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.setValueAtTime(1200, t);
      filter.Q.setValueAtTime(8.0, t);
      filter.gain.setValueAtTime(12, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.32, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  // ==========================================
  // SPECIAL WEAPON SOUNDS
  // ==========================================
  /**
   * Salvo rocket launch, heavy ram shockwave, or rail beam zap.
   */
  public specialWeaponSound(carType: CarArchetype): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    const t = ctx.currentTime;

    if (carType === 'stadium') {
      // Micro-rocket salvo launch: whoosh + rocket hiss
      const duration = 0.28;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, t);
      osc.frequency.exponentialRampToValueAtTime(1100, t + duration * 0.4);
      osc.frequency.exponentialRampToValueAtTime(250, t + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, t);
      filter.Q.setValueAtTime(4.0, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + duration);
    } else if (carType === 'desert') {
      // Ram Overdrive: heavy ram shockwave, deep sub boom + metallic clank
      const duration = 0.55;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(180, t);
      sub.frequency.exponentialRampToValueAtTime(32, t + duration);

      const shaper = ctx.createWaveShaper();
      shaper.curve = this.makeDistortionCurve(40);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.5, t);
      subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      sub.connect(shaper);
      shaper.connect(subGain);
      subGain.connect(this.masterGain);

      sub.start(t);
      sub.stop(t + duration);
    } else {
      // Rally: Overcharge Rail Beam zap: instant piercing electric discharge
      const duration = 0.32;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(3200, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + duration);

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(800, t);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + duration);
    }
  }

  // ==========================================
  // HIT & EXPLOSION SOUNDS
  // ==========================================
  /**
   * Impact thump when taking kinetic damage or hitting an obstacle.
   */
  public hitSound(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.38, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(t);
    osc.stop(t + 0.11);
  }

  /**
   * Metallic wreckage burst when a car is wrecked.
   */
  public explosionSound(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.isMuted) return;

    const t = ctx.currentTime;
    const duration = 0.65;

    // Sub rumble
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(110, t);
    subOsc.frequency.exponentialRampToValueAtTime(25, t + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.exponentialRampToValueAtTime(120, t + duration);

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.makeDistortionCurve(50);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    subOsc.connect(filter);
    filter.connect(shaper);
    shaper.connect(gain);
    gain.connect(this.masterGain);

    subOsc.start(t);
    subOsc.stop(t + duration);
  }
}

// Singleton export
export const sfx = new SoundEngine();

// Direct function exports for convenience
export const CountdownBeep = (frequency: number = 440, isFinal: boolean = false) => sfx.countdownBeep(frequency, isFinal);
export const BoostPadWhoosh = () => sfx.boostPadWhoosh();
export const GunShot = (carType: CarArchetype) => sfx.gunShot(carType);
export const SpecialWeaponSound = (carType: CarArchetype) => sfx.specialWeaponSound(carType);
export const HitSound = () => sfx.hitSound();
export const ExplosionSound = () => sfx.explosionSound();
