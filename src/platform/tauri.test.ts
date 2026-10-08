import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTauriPlatformService, isTauriHost, onTauriMenuAction } from './tauri';

type G = { __TAURI__?: unknown };
const g = globalThis as G;

function stub() {
  const invoke = vi.fn().mockResolvedValue(undefined);
  let cb: ((e: { payload: unknown }) => void) | undefined;
  const unlisten = vi.fn();
  const listen = vi.fn(async (_n: string, h: typeof cb) => {
    cb = h;
    return unlisten;
  });
  g.__TAURI__ = { core: { invoke }, event: { listen } };
  return { invoke, listen, unlisten, emit: (p: unknown) => cb?.({ payload: p }) };
}

afterEach(() => {
  delete g.__TAURI__;
});

describe('tauri platform', () => {
  it('detects host by global', () => {
    expect(isTauriHost()).toBe(false);
    stub();
    expect(isTauriHost()).toBe(true);
  });

  it('confirm asks the native dialog and returns its boolean answer', async () => {
    const { invoke } = stub();
    const p = createTauriPlatformService();
    const opts = {
      title: 'Delete?',
      message: 'No undo.',
      confirmLabel: 'Delete',
      destructive: true,
    };
    invoke
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined);
    expect(await p.confirm(opts)).toBe(true);
    expect(invoke).toHaveBeenCalledWith('confirm', opts);
    expect(await p.confirm({ ...opts, destructive: undefined })).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith('confirm', { ...opts, destructive: false });
    expect(await p.confirm(opts)).toBe(false); // anything but `true` is a cancel
  });

  it('maps calls to Rust commands', async () => {
    const { invoke } = stub();
    const p = createTauriPlatformService();
    await p.showNotification({ title: 'Hi', body: 'There' });
    await p.setBadge(3);
    await p.setBadge();
    await p.openExternal('https://example.com/a');
    await p.setWindowTheme?.('dark');
    await p.setWindowTheme?.('system');
    expect(invoke).toHaveBeenCalledWith('set_window_theme', { theme: 'dark' });
    expect(invoke).toHaveBeenCalledWith('set_window_theme', { theme: null });
    expect(invoke).toHaveBeenCalledWith('notify', { title: 'Hi', body: 'There' });
    expect(invoke).toHaveBeenCalledWith('set_badge', { count: 3 });
    expect(invoke).toHaveBeenCalledWith('set_badge', { count: null });
    expect(invoke).toHaveBeenCalledWith('plugin:opener|open_url', {
      url: 'https://example.com/a',
    });
  });

  it('refuses non http(s)/mailto URLs', async () => {
    const { invoke } = stub();
    await expect(createTauriPlatformService().openExternal('file:///etc/passwd')).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('rejects when runtime missing', async () => {
    await expect(createTauriPlatformService().setBadge(1)).rejects.toThrow(/not available/);
  });

  it('forwards menu events and unsubscribes', async () => {
    const s = stub();
    const h = vi.fn();
    const off = onTauriMenuAction(h);
    await Promise.resolve();
    s.emit('mail.archive');
    s.emit(42);
    expect(h).toHaveBeenCalledTimes(1);
    expect(h).toHaveBeenCalledWith('mail.archive');
    off();
    expect(s.unlisten).toHaveBeenCalled();
  });
});
