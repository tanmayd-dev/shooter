/**
 * Unit test suite for InputController.
 * Verifies input field target isolation, game key capturing, dual-hand controls, and camera toggle.
 *
 * Run directly with `node --test src/physics/input.test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { InputController } from "./input.ts";

// ============================================================================
// Mock DOM Event & Elements
// ============================================================================

interface MockTargetOptions {
  tagName?: string;
  isContentEditable?: boolean;
}

class MockElement {
  public tagName: string;
  public isContentEditable: boolean;

  constructor(options: MockTargetOptions = {}) {
    this.tagName = options.tagName ?? "DIV";
    this.isContentEditable = options.isContentEditable ?? false;
  }
}

class MockKeyboardEvent {
  public code: string;
  public key: string;
  public target: MockElement | null;
  public repeat: boolean;
  public defaultPrevented = false;

  constructor(
    code: string,
    key: string,
    target: MockElement | null = null,
    repeat = false
  ) {
    this.code = code;
    this.key = key;
    this.target = target;
    this.repeat = repeat;
  }

  public preventDefault(): void {
    this.defaultPrevented = true;
  }
}

function makeKeyEvent(
  code: string,
  key: string,
  target: MockElement | null = null,
  repeat = false
): KeyboardEvent {
  return new MockKeyboardEvent(code, key, target, repeat) as unknown as KeyboardEvent;
}

// ============================================================================
// Test Suites
// ============================================================================

describe("InputController - Dual-Hand Controls & Input Field Isolation", () => {
  describe("1. Input Field Isolation (No Interception)", () => {
    it("never calls preventDefault() and never captures keys when target is HTMLInputElement", () => {
      const controller = new InputController("vim-arrows", {
        enableSmoothing: false,
        preventDefault: true,
      });

      let cameraToggled = false;
      controller.setCameraToggleCallback(() => {
        cameraToggled = true;
      });

      const inputElement = new MockElement({ tagName: "INPUT" });

      // Driving, combat, camera, and alphanumeric room code keys
      const testKeys = [
        { code: "KeyA", key: "a" },
        { code: "KeyS", key: "s" },
        { code: "KeyD", key: "d" },
        { code: "KeyF", key: "f" },
        { code: "KeyH", key: "h" },
        { code: "KeyJ", key: "j" },
        { code: "KeyK", key: "k" },
        { code: "KeyL", key: "l" },
        { code: "KeyC", key: "c" },
        { code: "ArrowUp", key: "ArrowUp" },
        { code: "ArrowDown", key: "ArrowDown" },
        { code: "KeyR", key: "r" },
        { code: "Digit1", key: "1" },
      ];

      for (const { code, key } of testKeys) {
        const ev = makeKeyEvent(code, key, inputElement);
        controller.handleKeyDown(ev);

        // 1. preventDefault() must NEVER be called
        assert.strictEqual(
          (ev as unknown as MockKeyboardEvent).defaultPrevented,
          false,
          `preventDefault() was unexpectedly called for ${code} on INPUT element`
        );

        // 2. Key must NOT be captured into pressedKeys
        assert.strictEqual(
          controller.isKeyPressed(code),
          false,
          `Key ${code} was unexpectedly captured into pressedKeys`
        );
        assert.strictEqual(
          controller.isKeyPressed(key),
          false,
          `Key character ${key} was unexpectedly captured into pressedKeys`
        );
      }

      assert.strictEqual(
        controller.getPressedKeys().size,
        0,
        "pressedKeys must be completely empty"
      );
      assert.strictEqual(
        controller.cameraTogglePressed,
        false,
        "cameraTogglePressed must not be triggered from inside input"
      );
      assert.strictEqual(
        cameraToggled,
        false,
        "camera toggle callback must not be fired from inside input"
      );

      // Verify sample returns clean neutral state
      const sample = controller.sample(1 / 60);
      assert.strictEqual(sample.throttle, 0);
      assert.strictEqual(sample.steer, 0);
      assert.strictEqual(sample.brake, false);
      assert.strictEqual(sample.firePrimary, false);
      assert.strictEqual(sample.fireSpecial, false);
      assert.strictEqual(sample.abilityMobility, false);
      assert.strictEqual(sample.abilityUtility, false);

      // Verify handleKeyUp on input element returns cleanly without side effects
      for (const { code, key } of testKeys) {
        const upEv = makeKeyEvent(code, key, inputElement);
        controller.handleKeyUp(upEv);
        assert.strictEqual(
          (upEv as unknown as MockKeyboardEvent).defaultPrevented,
          false
        );
      }

      controller.destroy();
    });

    it("never intercepts keys when target is HTMLTextAreaElement", () => {
      const controller = new InputController("vim-arrows", {
        enableSmoothing: false,
        preventDefault: true,
      });

      const textareaElement = new MockElement({ tagName: "TEXTAREA" });
      const ev = makeKeyEvent("KeyA", "a", textareaElement);
      controller.handleKeyDown(ev);

      assert.strictEqual((ev as unknown as MockKeyboardEvent).defaultPrevented, false);
      assert.strictEqual(controller.isKeyPressed("KeyA"), false);
      assert.strictEqual(controller.getPressedKeys().size, 0);

      controller.destroy();
    });

    it("never intercepts keys when target has isContentEditable === true", () => {
      const controller = new InputController("vim-arrows", {
        enableSmoothing: false,
        preventDefault: true,
      });

      const editableElement = new MockElement({
        tagName: "DIV",
        isContentEditable: true,
      });
      const ev = makeKeyEvent("KeyK", "k", editableElement);
      controller.handleKeyDown(ev);

      assert.strictEqual((ev as unknown as MockKeyboardEvent).defaultPrevented, false);
      assert.strictEqual(controller.isKeyPressed("KeyK"), false);
      assert.strictEqual(controller.getPressedKeys().size, 0);

      controller.destroy();
    });
  });

  describe("2. Game Controls Outside Input Fields", () => {
    it("captures driving and combat keys and calls preventDefault() when outside input fields", () => {
      const controller = new InputController("vim-arrows", {
        enableSmoothing: false,
        preventDefault: true,
      });

      const canvasTarget = new MockElement({ tagName: "CANVAS" });

      // Driving throttle: KeyK
      const evK = makeKeyEvent("KeyK", "k", canvasTarget);
      controller.handleKeyDown(evK);
      assert.strictEqual((evK as unknown as MockKeyboardEvent).defaultPrevented, true);
      assert.strictEqual(controller.isKeyPressed("KeyK"), true);

      // Driving steer left: KeyH
      const evH = makeKeyEvent("KeyH", "h", canvasTarget);
      controller.handleKeyDown(evH);
      assert.strictEqual((evH as unknown as MockKeyboardEvent).defaultPrevented, true);
      assert.strictEqual(controller.isKeyPressed("KeyH"), true);

      // Combat primary: KeyA
      const evA = makeKeyEvent("KeyA", "a", canvasTarget);
      controller.handleKeyDown(evA);
      assert.strictEqual((evA as unknown as MockKeyboardEvent).defaultPrevented, true);
      assert.strictEqual(controller.isKeyPressed("KeyA"), true);

      // Sample verify
      const input = controller.sample(1 / 60);
      assert.strictEqual(input.throttle, 1.0);
      assert.strictEqual(input.steer, -1.0);
      assert.strictEqual(input.firePrimary, true);
      assert.strictEqual(input.fireSpecial, false);

      // Release KeyK and KeyH
      controller.handleKeyUp(makeKeyEvent("KeyK", "k", canvasTarget));
      controller.handleKeyUp(makeKeyEvent("KeyH", "h", canvasTarget));

      const input2 = controller.sample(1 / 60);
      assert.strictEqual(input2.throttle, 0);
      assert.strictEqual(input2.steer, 0);
      assert.strictEqual(input2.firePrimary, true);

      controller.destroy();
    });

    it("captures combat abilities S, D, F correctly", () => {
      const controller = new InputController("vim-arrows", { enableSmoothing: false });

      // Special weapon: KeyS
      controller.handleKeyDown(makeKeyEvent("KeyS", "s"));
      // Mobility: KeyD
      controller.handleKeyDown(makeKeyEvent("KeyD", "d"));
      // Tactical gadget: KeyF
      controller.handleKeyDown(makeKeyEvent("KeyF", "f"));

      const input = controller.sample(1 / 60);
      assert.strictEqual(input.fireSpecial, true);
      assert.strictEqual(input.abilityMobility, true);
      assert.strictEqual(input.abilityUtility, true);

      // Release all
      controller.handleKeyUp(makeKeyEvent("KeyS", "s"));
      controller.handleKeyUp(makeKeyEvent("KeyD", "d"));
      controller.handleKeyUp(makeKeyEvent("KeyF", "f"));

      const inputAfter = controller.sample(1 / 60);
      assert.strictEqual(inputAfter.fireSpecial, false);
      assert.strictEqual(inputAfter.abilityMobility, false);
      assert.strictEqual(inputAfter.abilityUtility, false);

      controller.destroy();
    });

    it("supports KeyC for camera toggle with callback and state consumption", () => {
      const controller = new InputController("vim-arrows", { preventDefault: true });

      let toggleCount = 0;
      controller.setCameraToggleCallback(() => {
        toggleCount++;
      });

      assert.strictEqual(controller.cameraTogglePressed, false);

      // KeyDown outside input
      const evC = makeKeyEvent("KeyC", "c");
      controller.handleKeyDown(evC);

      assert.strictEqual((evC as unknown as MockKeyboardEvent).defaultPrevented, true);
      assert.strictEqual(controller.cameraTogglePressed, true);
      assert.strictEqual(toggleCount, 1);

      // Repeat keydown while holding KeyC should not re-trigger callback
      const repeatC = makeKeyEvent("KeyC", "c", null, true);
      controller.handleKeyDown(repeatC);
      assert.strictEqual(toggleCount, 1, "Repeat event must not increment toggleCount");

      // consumeCameraToggle resets flag
      assert.strictEqual(controller.consumeCameraToggle(), true);
      assert.strictEqual(controller.cameraTogglePressed, false);
      assert.strictEqual(controller.consumeCameraToggle(), false);

      // KeyUp resets flag
      controller.handleKeyDown(makeKeyEvent("KeyC", "c"));
      assert.strictEqual(controller.cameraTogglePressed, true);
      controller.handleKeyUp(makeKeyEvent("KeyC", "c"));
      assert.strictEqual(controller.cameraTogglePressed, false);

      controller.destroy();
    });

    it("does not call preventDefault() on non-game keys outside input fields", () => {
      const controller = new InputController("vim-arrows", { preventDefault: true });

      const evM = makeKeyEvent("KeyM", "m");
      controller.handleKeyDown(evM);
      assert.strictEqual((evM as unknown as MockKeyboardEvent).defaultPrevented, false);

      controller.destroy();
    });
  });
});
