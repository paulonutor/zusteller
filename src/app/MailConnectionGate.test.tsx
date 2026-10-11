import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MailConnectionGate } from './MailConnectionGate';
import { ServicesProvider } from './services';
import { GmailMailService, type Invoke } from '@/infrastructure/mail/gmail/GmailMailService';
import { createBrowserPlatformService } from '@/platform/browser';

it('opens and copies diagnostics without refreshing Gmail, then returns focus on Escape', async () => {
  const snapshot = {
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
  };
  const invoke = vi.fn(async (command, args) => {
    if (command === 'gmail_diagnostics') return snapshot;
    if (args?.operation === 'accounts')
      return [{ id: 'a', email: 'a@example.com', displayName: 'A' }];
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <ServicesProvider
      services={{
        mail: new GmailMailService(invoke as Invoke),
        platform: createBrowserPlatformService(),
      }}
    >
      <QueryClientProvider client={qc}>
        <MailConnectionGate>
          <p>Real mail</p>
        </MailConnectionGate>
      </QueryClientProvider>
    </ServicesProvider>,
  );
  const toggle = await screen.findByRole('button', { name: 'Diagnostics' });
  expect(invoke.mock.calls.some((call) => call[0] === 'gmail_diagnostics')).toBe(false);
  await user.click(toggle);
  expect(await screen.findByText(/HTTP 429/)).toHaveTextContent('userRateLimitExceeded');
  expect(screen.getByText(/12 requests/)).toHaveTextContent('25 cached summaries reused');
  await user.click(screen.getByRole('button', { name: 'Copy log' }));
  expect(await navigator.clipboard.readText()).toContain('retry in 60 s');
  expect(screen.getByText('Log copied')).toBeInTheDocument();
  const events = screen.getByLabelText('Gmail diagnostic events');
  events.focus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('region', { name: 'Gmail diagnostics' })).not.toBeInTheDocument();
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(invoke.mock.calls.filter((call) => call[0] === 'gmail_read')).toHaveLength(1);
});

it('connects through the provider and clears account mail on disconnect', async () => {
  let connected = false;
  const account = { id: 'a', email: 'a@example.com', displayName: 'A' };
  const invoke = vi.fn(async (command, args) => {
    if (command === 'gmail_connect') {
      connected = true;
      return account;
    }
    if (args?.operation === 'accounts') return connected ? [account] : [];
    if (args?.operation === 'disconnect') connected = false;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ServicesProvider
      services={{
        mail: new GmailMailService(invoke as Invoke),
        platform: createBrowserPlatformService(),
      }}
    >
      <QueryClientProvider client={qc}>
        <MailConnectionGate>
          <p>Real mail</p>
        </MailConnectionGate>
      </QueryClientProvider>
    </ServicesProvider>,
  );
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
  expect(await screen.findByText('Real mail')).toBeInTheDocument();
  expect(screen.getByText('Read-only Gmail · actions are local')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Disconnect' }));
  expect(
    await screen.findByRole('heading', { name: 'Connect your Gmail account' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Real mail')).not.toBeInTheDocument();
});
