import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatformService } from '.';
import { fromTauriItemId, fromWailsPayload } from './menuActions';

type G = { __TAURI__?: unknown };
const w = window as unknown as { wails?: unknown };
const g = globalThis as G;

afterEach(() => {
  delete g.__TAURI__;
  delete w.wails;
});

describe('menu action tables', () => {
  it('maps wails payloads and drops unknown ones', () => {
    expect(fromWailsPayload('markUnread')).toBe('markUnread');
    expect(fromWailsPayload('find')).toBe('find');
    expect(fromWailsPayload('bogus')).toBeUndefined();
    expect(fromWailsPayload('toString')).toBeUndefined();
  });

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

  it('wails host: translates payloads, ignores unknown, unsubscribes', async () => {
    let cb: ((e: { name: string; data: unknown }) => void) | undefined;
    const off = vi.fn();
    w.wails = {
      Call: { ByName: vi.fn().mockResolvedValue(undefined) },
      Events: {
        On: (_n: string, c: typeof cb) => {
          cb = c;
          return off;
        },
      },
    };
    const h = vi.fn();
    const unsub = createPlatformService().subscribeMenuActions(h);
    await vi.waitFor(() => expect(cb).toBeDefined());
    cb!({ name: 'x', data: 'trash' });
    cb!({ name: 'x', data: 'nope' });
    expect(h.mock.calls).toEqual([['trash']]);
    unsub();
    expect(off).toHaveBeenCalled();
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
