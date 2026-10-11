import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MailConnectionGate } from './MailConnectionGate';
import { MailActivityButton } from './MailActivityButton';
import type { MailActivityAction } from '@/domain/mail/connection';
import { ServicesProvider } from './services';
import { GmailMailService, type Invoke } from '@/infrastructure/mail/gmail/GmailMailService';
import { createBrowserPlatformService } from '@/platform/browser';

it('opens a separate activity window without adding a status bar or reading logs in the main view', async () => {
  const invoke = vi.fn(async (_command, args) =>
    args?.operation === 'accounts'
      ? [{ id: 'a', email: 'a@example.com', displayName: 'A' }]
      : undefined,
  );
  const open = vi.fn().mockResolvedValue(undefined);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ServicesProvider
      services={{
        mail: new GmailMailService(invoke as Invoke),
        platform: { ...createBrowserPlatformService(), openMailActivityWindow: open },
      }}
    >
      <QueryClientProvider client={qc}>
        <MailConnectionGate>
          <p>Real mail</p>
          <MailActivityButton />
        </MailConnectionGate>
      </QueryClientProvider>
    </ServicesProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText('Real mail');
  await user.click(await screen.findByRole('button', { name: 'Gmail activity' }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByText('Real mail')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Gmail connection' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Gmail diagnostics' })).not.toBeInTheDocument();
  expect(invoke).toHaveBeenCalledTimes(1);
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
  let handle: ((action: MailActivityAction) => Promise<void>) | undefined;
  const publish = vi.fn().mockResolvedValue(undefined);
  const activity = {
    getSnapshot: vi.fn(),
    publish,
    perform: vi.fn(),
    subscribeActions: (handler: typeof handle) => {
      handle = handler;
      return () => {};
    },
  };
  render(
    <ServicesProvider
      services={{
        mail: new GmailMailService(invoke as Invoke, activity),
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
  await waitFor(() =>
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ account, busy: false })),
  );
  expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
  await act(() => handle!('disconnect'));
  expect(
    await screen.findByRole('heading', { name: 'Connect your Gmail account' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('Real mail')).not.toBeInTheDocument();
});
