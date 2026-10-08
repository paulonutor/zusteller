import { describe, expect, it } from 'vitest';
import { actionForKey } from './shortcuts';

const k = (key: string, mods: object = {}) => ({
  key,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('actionForKey', () => {
  it('maps plain keys', () => {
    expect(actionForKey(k('e'))).toBe('archive');
    expect(actionForKey(k('#', { shiftKey: true }))).toBe('trash');
    expect(actionForKey(k('Backspace'))).toBe('trash');
    expect(actionForKey(k('I', { shiftKey: true }))).toBe('markRead');
    expect(actionForKey(k('U', { shiftKey: true }))).toBe('markUnread');
    expect(actionForKey(k('s'))).toBe('toggleStar');
  });
  it('is safe with CapsLock (uppercase key without shift)', () => {
    expect(actionForKey(k('I'))).toBeNull();
    expect(actionForKey(k('U'))).toBeNull();
    expect(actionForKey(k('Z'))).toBeNull();
    expect(actionForKey(k('E'))).toBe('archive');
    expect(actionForKey(k('S'))).toBe('toggleStar');
    // Shift+I with CapsLock on reports a lowercase key.
    expect(actionForKey(k('i', { shiftKey: true }))).toBe('markRead');
    expect(actionForKey(k('z', { shiftKey: true }))).toBe('restore');
    expect(actionForKey(k('u', { shiftKey: true }))).toBe('markUnread');
  });
  it('never claims ⌘/Ctrl/Alt combos (macOS owns them)', () => {
    expect(actionForKey(k('e', { metaKey: true }))).toBeNull();
    expect(actionForKey(k('s', { ctrlKey: true }))).toBeNull();
    expect(actionForKey(k('Backspace', { altKey: true }))).toBeNull();
  });
});
