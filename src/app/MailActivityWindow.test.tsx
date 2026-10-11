import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { App } from './App';
import type { MailActivitySnapshot } from '@/domain/mail/connection';
import { GmailMailService, type Invoke } from '@/infrastructure/mail/gmail/GmailMailService';
import { createBrowserPlatformService } from '@/platform/browser';

function setup() {
  let snapshot: MailActivitySnapshot = {
    account: { id: 'a', email: 'a@example.com', displayName: 'A' },
    status: {
      state: 'error',
      message: 'Gmail rate limit reached',
      lastSyncedAt: 1000,
      retryAt: 60000,
    },
    busy: false,
  };
  const invoke = vi.fn(async (_command: string) => ({
    requests: 12,
    quotaUnits: 442,
    rateLimits: 1,
    cacheHits: 25,
    entries: [
      {
        timestamp: 0,
        operation: 'threads.get',
        outcome: 'rate_limit',
        status: 429,
        durationMs: 120,
        waitMs: 50,
        quotaUnits: 40,
        reason: 'userRateLimitExceeded',
        retryAfter: 60,
        count: null,
      },
    ],
  }));
  const perform = vi.fn(async (action: string) => {
    if (action === 'disconnect') snapshot = { status: { state: 'idle' }, busy: false };
  });
  const activity = {
    getSnapshot: vi.fn(async () => snapshot),
    publish: vi.fn(),
    subscribeActions: vi.fn(),
    perform,
  };
  const mail = new GmailMailService(invoke as Invoke, activity);
  const subscribe = vi.spyOn(mail, 'subscribe');
  const accounts = vi.spyOn(mail, 'getAccounts');
  const close = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <App
      services={{
        mail,
        platform: { ...createBrowserPlatformService(), closeMailActivityWindow: close },
      }}
      view="activity"
    />,
  );
  return { user, invoke, activity, subscribe, accounts, close };
}

it('shows status and full diagnostics, copies logs and closes on Escape without starting mail polling', async () => {
  const { user, invoke, subscribe, accounts, close } = setup();
  expect(await screen.findByText('a@example.com')).toBeInTheDocument();
  expect(screen.getByText('Sync paused')).toBeInTheDocument();
  expect(screen.getByText(/Next sync retry at/)).toBeInTheDocument();
  expect(await screen.findByText(/HTTP 429/)).toHaveTextContent('userRateLimitExceeded');
  await user.click(screen.getByRole('button', { name: 'Copy log' }));
  expect(await navigator.clipboard.readText()).toContain('retry in 60 s');
  screen.getByLabelText('Gmail diagnostic events').focus();
  await user.keyboard('s{Escape}');
  expect(close).toHaveBeenCalledOnce();
  expect(subscribe).not.toHaveBeenCalled();
  expect(accounts).not.toHaveBeenCalled();
  expect(invoke.mock.calls.every(([command]) => command === 'gmail_diagnostics')).toBe(true);
});

it('routes controls through the owning window and updates after disconnect', async () => {
  const { user, activity } = setup();
  await screen.findByText('a@example.com');
  await user.click(screen.getByRole('button', { name: 'Refresh Gmail' }));
  expect(activity.perform).toHaveBeenLastCalledWith('refresh');
  await user.click(screen.getByRole('button', { name: 'Reset local changes' }));
  expect(activity.perform).toHaveBeenLastCalledWith('reset');
  activity.perform.mockRejectedValueOnce(new Error('Connection failed'));
  await user.click(screen.getByRole('button', { name: 'Reconnect' }));
  expect(await screen.findByText('Connection failed')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(await screen.findByText('Not connected')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled();
});
