import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailMailService, type Invoke } from './GmailMailService';

const account = { id: 'me@example.com', email: 'me@example.com', displayName: 'Me' };
const provider = (fn: ReturnType<typeof vi.fn>) => new GmailMailService(fn as Invoke);
afterEach(() => {
  vi.useRealTimers();
});

describe('Gmail desktop adapter', () => {
  it('pages Gmail search and sends all actions to the local Rust overlay', async () => {
    const invoke = vi.fn(async (_command, args) =>
      args?.operation === 'threads' ? { items: [], nextCursor: null } : undefined,
    );
    const mail = provider(invoke);
    expect(
      await mail.getThreads({ accountId: account.id, search: 'from:alice', cursor: 'p2' }),
    ).toEqual({ items: [], nextCursor: undefined });
    await mail.markRead(account.id, ['thread'], true);
    await mail.archive(account.id, ['thread']);
    await mail.moveToLabel(account.id, ['thread'], 'label');
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(Array(4).fill('gmail_read'));
    expect(invoke.mock.calls[1]![1]).toMatchObject({
      operation: 'action',
      input: { action: 'markRead', value: true },
    });
    expect(invoke.mock.calls[3]![1]).toMatchObject({
      operation: 'action',
      input: { action: 'moveToLabel', labelId: 'label' },
    });
    expect(mail.localPreview).toBe(true);
  });

  it('starts sync after accounts load, coalesces triggers and stops after unsubscribe', async () => {
    vi.useFakeTimers();
    let resolveSync!: (v: boolean) => void;
    const invoke = vi.fn(async (_command, args) =>
      args?.operation === 'accounts'
        ? [account]
        : new Promise<boolean>((resolve) => {
            resolveSync = resolve;
          }),
    );
    const mail = provider(invoke);
    const changed = vi.fn();
    const off = mail.subscribe(changed);
    await mail.getAccounts();
    await vi.advanceTimersByTimeAsync(0);
    const first = mail.refresh();
    const second = mail.refresh();
    expect(first).toBe(second);
    expect(invoke.mock.calls.filter((c) => c[1]?.operation === 'sync')).toHaveLength(1);
    resolveSync(true);
    await first;
    expect(changed).toHaveBeenCalledOnce();
    off();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(invoke.mock.calls.filter((c) => c[1]?.operation === 'sync')).toHaveLength(1);
  });

  it('backs off failed sync, respects Retry-After and offers reauthentication', async () => {
    vi.useFakeTimers();
    let failure: unknown = { code: 'rate_limit', message: 'Slow down', retryAfter: 60 };
    const invoke = vi.fn(async (_command, args) => {
      if (args?.operation === 'accounts') return [account];
      throw failure;
    });
    const mail = provider(invoke);
    await mail.getAccounts();
    const off = mail.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(mail.getStatus()).toMatchObject({ state: 'error', message: 'Slow down' });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(invoke.mock.calls.filter((c) => c[1]?.operation === 'sync')).toHaveLength(1);
    failure = { code: 'auth', message: 'Reconnect Gmail' };
    await vi.advanceTimersByTimeAsync(1);
    expect(mail.getStatus()).toMatchObject({ state: 'reauth', message: 'Reconnect Gmail' });
    off();
  });

  it('keeps the retry deadline through manual refresh, wake events and resubscription', async () => {
    vi.useFakeTimers();
    const invoke = vi.fn(async (_command, args) => {
      if (args?.operation === 'accounts') return [account];
      throw { code: 'rate_limit', message: 'Slow down', retryAfter: 60 };
    });
    const mail = provider(invoke);
    await mail.getAccounts();
    let off = mail.subscribe(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    const syncCount = () => invoke.mock.calls.filter((c) => c[1]?.operation === 'sync').length;
    expect(syncCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(10_000);
    await mail.refresh();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    off();
    off = mail.subscribe(vi.fn());
    await mail.getAccounts();
    await vi.advanceTimersByTimeAsync(49_999);
    expect(syncCount()).toBe(1);
    expect(mail.getStatus()).toMatchObject({ state: 'error', message: 'Slow down' });
    await vi.advanceTimersByTimeAsync(1);
    expect(syncCount()).toBe(2);
    off();
  });

  it('does not immediately repeat a failed in-flight sync after overlapping triggers', async () => {
    vi.useFakeTimers();
    let rejectSync!: (reason: unknown) => void;
    const invoke = vi.fn(async (_command, args) => {
      if (args?.operation === 'accounts') return [account];
      return new Promise<boolean>((_resolve, reject) => {
        rejectSync = reject;
      });
    });
    const mail = provider(invoke);
    await mail.getAccounts();
    const off = mail.subscribe(vi.fn());
    const first = mail.refresh();
    expect(mail.refresh()).toBe(first);
    rejectSync({ code: 'rate_limit', message: 'Slow down', retryAfter: 60 });
    await first;
    await mail.refresh();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(invoke.mock.calls.filter((c) => c[1]?.operation === 'sync')).toHaveLength(1);
    off();
  });

  it('does not publish a sync result after disconnect and clears local connection state', async () => {
    let resolveSync!: (v: boolean) => void;
    const invoke = vi.fn(async (_command, args) => {
      if (args?.operation === 'accounts') return [account];
      if (args?.operation === 'sync')
        return new Promise<boolean>((resolve) => {
          resolveSync = resolve;
        });
      return undefined;
    });
    const mail = provider(invoke);
    await mail.getAccounts();
    const changed = vi.fn();
    const off = mail.subscribe(changed);
    const sync = mail.refresh();
    await mail.disconnect(account.id);
    resolveSync(true);
    await sync;
    expect(changed).not.toHaveBeenCalled();
    expect(mail.getStatus()).toEqual({ state: 'idle' });
    off();
  });

  it('handles sign-in cancellation and reports connection failures', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce({ code: 'cancelled' })
      .mockRejectedValueOnce({ code: 'auth', message: 'Keychain unavailable' });
    const mail = provider(invoke);
    await mail.connect();
    expect(mail.getStatus()).toEqual({ state: 'idle' });
    await expect(mail.connect()).rejects.toThrow('Keychain unavailable');
    expect(mail.getStatus()).toMatchObject({ state: 'error' });
  });
});
