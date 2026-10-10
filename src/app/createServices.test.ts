import { describe, expect, it, vi } from 'vitest';
import { createServices } from './createServices';

// Exercise actual mail calls: normal sessions must not schedule simulated service delays.
describe('mock app latency', () => {
  it.each(['', '?latency=invalid', '?latency=-100'])(
    'does not delay actions for %s',
    async (search) => {
      const timer = vi.spyOn(globalThis, 'setTimeout');
      try {
        const { mail } = createServices(search);
        const [account] = await mail.getAccounts();
        const page = await mail.getThreads({ accountId: account!.id, mailbox: 'inbox' });
        await mail.archive(account!.id, [page.items[0]!.id]);
        await mail.trash(account!.id, [page.items[1]!.id]);
        await mail.getThreads({ accountId: account!.id, mailbox: 'inbox' });
        expect(timer).not.toHaveBeenCalled();
      } finally {
        timer.mockRestore();
      }
    },
  );

  it('keeps explicit latency available for slow-provider testing', async () => {
    vi.useFakeTimers();
    try {
      const { mail } = createServices('?latency=150');
      let finished = false;
      const pending = mail.getAccounts().then(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(149);
      expect(finished).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(finished).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
