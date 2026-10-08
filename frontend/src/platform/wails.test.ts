import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWailsPlatformService,
  isWailsHost,
  onWailsMailAction,
  WAILS_ACCENT_EVENT,
  WAILS_MAIL_ACTION_EVENT,
} from './wails';

const SVC = 'zusteller/hosts/wails/internal/platform.Service';

function stubRuntime() {
  const ByName = vi.fn().mockResolvedValue(undefined);
  let listener: ((e: { name: string; data: unknown }) => void) | undefined;
  const On = vi.fn((_n: string, cb: typeof listener) => {
    listener = cb;
    return () => {
      listener = undefined;
    };
  });
  window.wails = { Call: { ByName }, Events: { On } };
  return {
    ByName,
    On,
    emit: (data: unknown) => listener?.({ name: WAILS_MAIL_ACTION_EVENT, data }),
  };
}

afterEach(() => {
  delete window.wails;
});

describe('wails platform adapter', () => {
  it('is not a Wails host in a plain browser', () => {
    expect(isWailsHost()).toBe(false);
  });

  it('detects the runtime global', () => {
    stubRuntime();
    expect(isWailsHost()).toBe(true);
  });

  it('forwards the capabilities to the Go service', async () => {
    const { ByName } = stubRuntime();
    const p = createWailsPlatformService();
    await p.showNotification({ title: 'Hi' });
    await p.setBadge(4);
    await p.setBadge();
    await p.setWindowTheme?.('dark');
    await p.openExternal('https://example.com/x');
    expect(ByName.mock.calls).toEqual([
      [`${SVC}.ShowNotification`, 'Hi', ''],
      [`${SVC}.SetBadge`, 4],
      [`${SVC}.SetBadge`, 0],
      [`${SVC}.SetWindowTheme`, 'dark'],
      [`${SVC}.OpenExternal`, 'https://example.com/x'],
    ]);
  });

  it('refuses non-http(s)/mailto URLs before calling the host', async () => {
    const { ByName } = stubRuntime();
    await expect(
      createWailsPlatformService().openExternal('javascript:alert(1)'),
    ).rejects.toThrow();
    expect(ByName).not.toHaveBeenCalled();
  });

  it('delivers native menu actions', async () => {
    const { emit } = stubRuntime();
    const seen: string[] = [];
    const off = await onWailsMailAction((a) => seen.push(a));
    emit('archive');
    emit(['markRead']);
    emit(42);
    off();
    emit('trash');
    expect(seen).toEqual(['archive', 'markRead']);
  });
});

describe('wails accent colour', () => {
  it('reads the accent from the host and ignores junk', async () => {
    const { ByName } = stubRuntime();
    ByName.mockResolvedValueOnce('#a550a7').mockResolvedValueOnce('javascript:x');
    const p = createWailsPlatformService();
    expect(await p.getAccentColor?.()).toBe('#a550a7');
    expect(await p.getAccentColor?.()).toBeNull();
    expect(ByName).toHaveBeenCalledWith(`${SVC}.AccentColor`);
  });

  it('forwards accent change events until unsubscribed', async () => {
    const { On } = stubRuntime();
    const seen: string[] = [];
    const off = createWailsPlatformService().subscribeAccentColor?.((c) => seen.push(c));
    await vi.waitFor(() =>
      expect(On).toHaveBeenCalledWith(WAILS_ACCENT_EVENT, expect.any(Function)),
    );
    const cb = On.mock.calls[0]?.[1] as (e: { name: string; data: unknown }) => void;
    cb({ name: WAILS_ACCENT_EVENT, data: '#f74f9e' });
    cb({ name: WAILS_ACCENT_EVENT, data: 'red' });
    expect(seen).toEqual(['#f74f9e']);
    off?.();
  });
});
