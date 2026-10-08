import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatformService } from '.';
import { fromTauriItemId } from './menuActions';

type G = { __TAURI__?: unknown };
const g = globalThis as G;

afterEach(() => {
  delete g.__TAURI__;
});

describe('menu action tables', () => {
  it('maps tauri item ids and drops unknown ones', () => {
    expect(fromTauriItemId('mail.archive')).toBe('archive');
    expect(fromTauriItemId('mail.star')).toBe('star');
    expect(fromTauriItemId('mail.find')).toBe('find');
    expect(fromTauriItemId('app.quit')).toBeUndefined();
    expect(fromTauriItemId('constructor')).toBeUndefined();
  });
});

describe('createPlatformService', () => {
  it('browser: subscribe is a harmless no-op', () => {
    const h = vi.fn();
    const off = createPlatformService().subscribeMenuActions(h);
    expect(() => off()).not.toThrow();
    expect(h).not.toHaveBeenCalled();
  });

  it('tauri host: translates item ids', async () => {
    let cb: ((e: { payload: unknown }) => void) | undefined;
    g.__TAURI__ = {
      core: { invoke: vi.fn() },
      event: {
        listen: async (_n: string, c: typeof cb) => {
          cb = c;
          return () => {};
        },
      },
    };
    const h = vi.fn();
    createPlatformService().subscribeMenuActions(h);
    await vi.waitFor(() => expect(cb).toBeDefined());
    cb!({ payload: 'mail.markRead' });
    cb!({ payload: 'mail.unknown' });
    expect(h.mock.calls).toEqual([['markRead']]);
  });
});

describe('wantsVibrancy', () => {
  it('only the explicit host flag enables the native-material styling', async () => {
    const { wantsVibrancy } = await import('./hostChrome');
    expect(wantsVibrancy('?vibrancy=1')).toBe(true);
    expect(wantsVibrancy('?latency=0&vibrancy=1')).toBe(true);
    expect(wantsVibrancy('')).toBe(false);
    expect(wantsVibrancy('?vibrancy=0')).toBe(false);
  });
});
