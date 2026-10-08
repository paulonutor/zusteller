import { describe, expect, it } from 'vitest';
import { avatarHue, initials } from './format';

describe('initials', () => {
  it('uses first and last name words', () => {
    expect(initials({ name: 'Ada Lovelace', email: 'ada@x.io' })).toBe('AL');
    expect(initials({ name: 'jean luc picard', email: 'j@x.io' })).toBe('JP');
  });
  it('uses one letter for single names and falls back to the email', () => {
    expect(initials({ name: 'Grace', email: 'g@x.io' })).toBe('G');
    expect(initials({ email: 'zed@x.io' })).toBe('Z');
    expect(initials({ name: '  ', email: '1@x.io' })).toBe('?');
  });
});

describe('avatarHue', () => {
  it('is deterministic, case-insensitive and within 0-359', () => {
    expect(avatarHue('Ada@x.io')).toBe(avatarHue('ada@x.io'));
    expect(avatarHue('ada@x.io')).not.toBe(avatarHue('bob@x.io'));
    expect(avatarHue('a@b.c')).toBeGreaterThanOrEqual(0);
    expect(avatarHue('a@b.c')).toBeLessThan(360);
  });
});

describe('chipTextColor', () => {
  it('uses white on dark label colours and dark text on light ones', async () => {
    const { chipTextColor } = await import('./format');
    expect(chipTextColor('#0b804b')).toBe('#fff');
    expect(chipTextColor('#16a766')).toBe('#111');
    expect(chipTextColor('#fad165')).toBe('#111');
    expect(chipTextColor('#b9e4d0')).toBe('#111');
    expect(chipTextColor('not-a-colour')).toBe('#fff');
  });
});
