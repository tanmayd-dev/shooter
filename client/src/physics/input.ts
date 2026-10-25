/**
 * Dual-hand keyboard controller for `shooter`.
 *
 * Controls layout:
 * - Right hand (Driving):
 *     - Vim keys: 'k' (Throttle forward), 'j' (Brake / Reverse / Drift), 'h' (Steer Left), 'l' (Steer Right)
 *     - Arrow keys: Up (Throttle forward), Down (Brake / Reverse / Drift), Left (Steer Left), Right (Steer Right)
 *     - Both input sets work simultaneously with smooth ramp-up filtering.
 * - Left hand (Combat & Abilities):
 *     - Default Home-row asdf:
 *         - KeyA: firePrimary (Fixed forward chassis recoil)
 *         - KeyS: fireSpecial (Archetype special weapon)
 *         - KeyD: abilityMobility (Drift snap / Turbo / Pivot)
 *         - KeyF: abilityUtility (Shield / Mines / EMP smoke)
 * - Optional WASD mode support:
 *     - WASD drives, right-hand (JKL;) triggers combat actions.
 */

import type { InputState } from "../types.ts";

export type ControlMode = "vim-arrows" | "wasd";

export interface InputFilterConfig {
  /** Throttle rise rate per second (higher = more instant, default 8.0) */
  throttleAttack: number;
  /** Throttle fall rate per second when released (default 12.0) */
  throttleDecay: number;
  /** Steering attack rate per second (default 10.0) */
  steerAttack: number;
  /** Steering centering rate per second when released (default 16.0) */
  steerReturn: number;
  /** Whether smooth analog filtering is enabled (default true) */
  enableSmoothing: boolean;
  /** Whether to call preventDefault() on driving/combat keys */
  preventDefault: boolean;
}

export const DEFAULT_FILTER_CONFIG: InputFilterConfig = {
  throttleAttack: 8.0,
  throttleDecay: 12.0,
  steerAttack: 10.0,
  steerReturn: 16.0,
  enableSmoothing: true,
  preventDefault: true,
};

export class InputController {
  private mode: ControlMode;
  private filterConfig: InputFilterConfig;
  private pressedKeys = new Set<string>();

  private sequence = 0;
  private currentThrottle = 0;
  private currentSteer = 0;
  private currentBrake = false;
  private firePrimary = false;
  private fireSpecial = false;
  private abilityMobility = false;
  private abilityUtility = false;

  public cameraTogglePressed = false;
  public onCameraToggle?: () => void;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundBlur: () => void;
  private attached = false;

  constructor(mode: ControlMode = "vim-arrows", filterConfig: Partial<InputFilterConfig> = {}) {
    this.mode = mode;
    this.filterConfig = { ...DEFAULT_FILTER_CONFIG, ...filterConfig };

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundBlur = this.handleBlur.bind(this);

    this.attach();
  }

  /**
   * Attaches window event listeners.
   */
  public attach(): void {
    if (this.attached || typeof window === "undefined") return;

    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    window.addEventListener("blur", this.boundBlur);
    this.attached = true;
  }

  /**
   * Cleans up window event listeners.
   */
  public destroy(): void {
    if (!this.attached || typeof window === "undefined") return;

    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    window.removeEventListener("blur", this.boundBlur);
    this.pressedKeys.clear();
    this.attached = false;
  }

  /**
   * Resets all pressed keys and current analog states.
   */
  public reset(): void {
    this.pressedKeys.clear();
    this.currentThrottle = 0;
    this.currentSteer = 0;
    this.currentBrake = false;
    this.firePrimary = false;
    this.fireSpecial = false;
    this.abilityMobility = false;
    this.abilityUtility = false;
    this.cameraTogglePressed = false;
  }

  /**
   * Sets callback fired when camera toggle key (KeyC) is pressed.
   */
  public setCameraToggleCallback(callback: () => void): void {
    this.onCameraToggle = callback;
  }

  /**
   * Consumes and returns camera toggle state (resets flag to false).
   */
  public consumeCameraToggle(): boolean {
    const pressed = this.cameraTogglePressed;
    this.cameraTogglePressed = false;
    return pressed;
  }

  /**
   * Checks whether a specific key is currently tracked as pressed.
   */
  public isKeyPressed(keyOrCode: string): boolean {
    return this.pressedKeys.has(keyOrCode) || this.pressedKeys.has(keyOrCode.toLowerCase());
  }

  /**
   * Returns a readonly view of currently pressed keys.
   */
  public getPressedKeys(): ReadonlySet<string> {
    return this.pressedKeys;
  }

  /**
   * Checks whether an event target is an interactive user input field.
   */
  public isInputField(target: EventTarget | null): boolean {
    if (!target) return false;
    const el = target as HTMLElement & { isContentEditable?: boolean };
    const tagName = el.tagName ? el.tagName.toUpperCase() : "";
    if (tagName === "INPUT" || tagName === "TEXTAREA") return true;
    if (Boolean(el.isContentEditable)) return true;
    return false;
  }

  /**
   * Sets the control mode ("vim-arrows" or "wasd").
   */
  public setMode(mode: ControlMode): void {
    this.mode = mode;
    this.pressedKeys.clear();
  }

  public getMode(): ControlMode {
    return this.mode;
  }

  /**
   * Determines if a key event matches game controls and should prevent default browser action.
   */
  private isGameKey(code: string, key: string): boolean {
    const k = key.toLowerCase();
    const gameCodes = new Set([
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      "KeyK", "KeyJ", "KeyH", "KeyL",
      "KeyW", "KeyA", "KeyS", "KeyD", "KeyF", "KeyC",
      "Semicolon", "Space",
    ]);

    if (gameCodes.has(code)) return true;
    if (["k", "j", "h", "l", "w", "a", "s", "d", "f", "c", ";"].includes(k)) return true;
    return false;
  }

  public handleKeyDown(e: KeyboardEvent): void {
    // If target is an input field, do not preventDefault and do not capture keys!
    if (this.isInputField(e.target)) {
      return;
    }

    if (this.filterConfig.preventDefault && this.isGameKey(e.code, e.key)) {
      e.preventDefault();
    }

    if (e.code === "KeyC" || e.key.toLowerCase() === "c") {
      this.cameraTogglePressed = true;
      if (!e.repeat) {
        this.onCameraToggle?.();
      }
    }

    this.pressedKeys.add(e.code);
    this.pressedKeys.add(e.key.toLowerCase());
  }

  public handleKeyUp(e: KeyboardEvent): void {
    // If target is an input field, do not capture or modify keys
    if (this.isInputField(e.target)) {
      return;
    }

    if (e.code === "KeyC" || e.key.toLowerCase() === "c") {
      this.cameraTogglePressed = false;
    }

    this.pressedKeys.delete(e.code);
    this.pressedKeys.delete(e.key.toLowerCase());
  }

  private handleBlur(): void {
    this.pressedKeys.clear();
    this.cameraTogglePressed = false;
  }

  /**
   * For tests and headless environments: programmatically simulate key press.
   */
  public simulateKeyDown(keyOrCode: string): void {
    if (keyOrCode === "KeyC" || keyOrCode.toLowerCase() === "c") {
      this.cameraTogglePressed = true;
      this.onCameraToggle?.();
    }
    this.pressedKeys.add(keyOrCode);
    this.pressedKeys.add(keyOrCode.toLowerCase());
  }

  /**
   * For tests and headless environments: programmatically simulate key release.
   */
  public simulateKeyUp(keyOrCode: string): void {
    if (keyOrCode === "KeyC" || keyOrCode.toLowerCase() === "c") {
      this.cameraTogglePressed = false;
    }
    this.pressedKeys.delete(keyOrCode);
    this.pressedKeys.delete(keyOrCode.toLowerCase());
  }

  private hasKey(...keys: string[]): boolean {
    for (const k of keys) {
      if (this.pressedKeys.has(k) || this.pressedKeys.has(k.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Samples current raw inputs and applies smooth ramp-up filter.
   * Increments the packet sequence counter and returns an `InputState`.
   */
  public sample(dt: number = 1 / 60): InputState {
    let rawThrottle = 0;
    let rawSteer = 0;
    let rawBrake = false;
    let rawFirePrimary = false;
    let rawFireSpecial = false;
    let rawMobility = false;
    let rawUtility = false;

    if (this.mode === "vim-arrows") {
      // Right hand driving: Vim (k, j, h, l) + Arrows (Up, Down, Left, Right)
      const forward = this.hasKey("KeyK", "k", "ArrowUp");
      const backward = this.hasKey("KeyJ", "j", "ArrowDown");
      const left = this.hasKey("KeyH", "h", "ArrowLeft");
      const right = this.hasKey("KeyL", "l", "ArrowRight");

      if (forward) rawThrottle = 1.0;
      if (backward) rawBrake = true;

      if (left && !right) rawSteer = -1.0;
      else if (right && !left) rawSteer = 1.0;

      // Left hand actions: Home-row asdf
      rawFirePrimary = this.hasKey("KeyA", "a");
      rawFireSpecial = this.hasKey("KeyS", "s");
      rawMobility = this.hasKey("KeyD", "d");
      rawUtility = this.hasKey("KeyF", "f");
    } else {
      // WASD mode: Left hand driving, right hand actions (JKL;)
      const forward = this.hasKey("KeyW", "w", "ArrowUp");
      const backward = this.hasKey("KeyS", "s", "ArrowDown");
      const left = this.hasKey("KeyA", "a", "ArrowLeft");
      const right = this.hasKey("KeyD", "d", "ArrowRight");

      if (forward) rawThrottle = 1.0;
      if (backward) rawBrake = true;

      if (left && !right) rawSteer = -1.0;
      else if (right && !left) rawSteer = 1.0;

      // Right hand combat keys in WASD mode
      rawFirePrimary = this.hasKey("KeyJ", "j");
      rawFireSpecial = this.hasKey("KeyK", "k");
      rawMobility = this.hasKey("KeyL", "l");
      rawUtility = this.hasKey("Semicolon", ";", "KeyH", "h");
    }

    // Apply smooth analog ramp-up filter
    if (this.filterConfig.enableSmoothing && dt > 0) {
      // Throttle smoothing: fast attack, crisp decay
      if (rawThrottle > this.currentThrottle) {
        this.currentThrottle = Math.min(rawThrottle, this.currentThrottle + this.filterConfig.throttleAttack * dt);
      } else {
        this.currentThrottle = Math.max(rawThrottle, this.currentThrottle - this.filterConfig.throttleDecay * dt);
      }

      // Steer smoothing: smooth attack, snappy return to center
      if (rawSteer !== 0) {
        if (rawSteer > this.currentSteer) {
          this.currentSteer = Math.min(rawSteer, this.currentSteer + this.filterConfig.steerAttack * dt);
        } else {
          this.currentSteer = Math.max(rawSteer, this.currentSteer - this.filterConfig.steerAttack * dt);
        }
      } else {
        // Returning to center
        if (this.currentSteer > 0) {
          this.currentSteer = Math.max(0, this.currentSteer - this.filterConfig.steerReturn * dt);
        } else if (this.currentSteer < 0) {
          this.currentSteer = Math.min(0, this.currentSteer + this.filterConfig.steerReturn * dt);
        }
      }
    } else {
      this.currentThrottle = rawThrottle;
      this.currentSteer = rawSteer;
    }

    this.currentBrake = rawBrake;
    this.firePrimary = rawFirePrimary;
    this.fireSpecial = rawFireSpecial;
    this.abilityMobility = rawMobility;
    this.abilityUtility = rawUtility;

    this.sequence++;

    return {
      sequence: this.sequence,
      throttle: this.currentThrottle,
      steer: this.currentSteer,
      brake: this.currentBrake,
      firePrimary: this.firePrimary,
      fireSpecial: this.fireSpecial,
      abilityMobility: this.abilityMobility,
      abilityUtility: this.abilityUtility,
    };
  }

  /**
   * Returns current sequence number without advancing.
   */
  public getSequence(): number {
    return this.sequence;
  }
}
