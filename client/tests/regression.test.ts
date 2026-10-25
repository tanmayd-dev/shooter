import test from 'node:test';
import assert from 'node:assert/strict';
import { InputController } from '../src/physics/input.ts';

test('Regression Test 1: InputController exempts HTML input fields from key interception', () => {
  const controller = new InputController('vim-arrows', { preventDefault: true });

  const inputEl = {
    tagName: 'INPUT',
    isContentEditable: false,
  } as unknown as HTMLElement;

  let prevented = false;
  const mockEvent = {
    code: 'KeyA',
    key: 'a',
    target: inputEl,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent;

  // Simulate typing 'a' into room code input
  // @ts-expect-error accessing private method for testing
  controller.handleKeyDown(mockEvent);

  assert.equal(prevented, false, 'preventDefault must not be called when typing in input');
  assert.equal(controller.isKeyPressed('KeyA'), false, 'Key must not be captured into game input state');

  // Same for other game keys in input field: 's', 'd', 'f', 'h', 'j', 'k', 'l'
  for (const k of ['KeyS', 'KeyD', 'KeyF', 'KeyH', 'KeyJ', 'KeyK', 'KeyL']) {
    let p = false;
    // @ts-expect-error accessing private method for testing
    controller.handleKeyDown({
      code: k,
      key: k.slice(3).toLowerCase(),
      target: inputEl,
      preventDefault: () => { p = true; },
    } as unknown as KeyboardEvent);
    assert.equal(p, false, `preventDefault must not be called for ${k} inside input`);
    assert.equal(controller.isKeyPressed(k), false, `${k} must not be captured when inside input`);
  }
});

test('Regression Test 2: InputController captures keys outside input fields', () => {
  const controller = new InputController('vim-arrows', { preventDefault: true });

  const divEl = {
    tagName: 'DIV',
    isContentEditable: false,
  } as unknown as HTMLElement;

  let prevented = false;
  // @ts-expect-error accessing private method for testing
  controller.handleKeyDown({
    code: 'KeyA',
    key: 'a',
    target: divEl,
    preventDefault: () => { prevented = true; },
  } as unknown as KeyboardEvent);

  assert.equal(prevented, true, 'preventDefault must be called for game keys outside input');
  assert.equal(controller.isKeyPressed('KeyA'), true, 'Key must be captured into game input state');
});
