import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MailConnectionGate } from './MailConnectionGate';
import { ServicesProvider } from './services';
import { GmailMailService, type Invoke } from '@/infrastructure/mail/gmail/GmailMailService';
import { createBrowserPlatformService } from '@/platform/browser';

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
