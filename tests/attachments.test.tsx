import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/services';
import { ThemeProvider } from '@/app/theme';
import { ToastProvider } from '@/app/toast';
import type { MailService, Message } from '@/domain/mail';
import { MessageView } from '@/features/mail/reader/MessageView';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';

const attachment = { id: 'file', filename: 'Report.pdf', mimeType: 'application/pdf', size: 1024 };
const message: Message = {
  id: 'message',
  threadId: 'thread',
  accountId: 'account',
  from: { email: 'sender@example.com' },
  to: [],
  subject: 'Report',
  sentAt: '2026-10-15T09:00:00Z',
  isRead: true,
  isStarred: false,
  labelIds: [],
  plainText: 'See attached.',
  attachments: [attachment],
};

function setup(capabilities: Pick<MailService, 'openAttachment' | 'downloadAttachment'> = {}) {
  const mail = Object.assign(new MockMailService(createSeedData(), { latency: 0 }), capabilities);
  render(
    <ServicesProvider
      services={{
        mail,
        platform: {
          openExternal: vi.fn(),
          showNotification: vi.fn(),
          setBadge: vi.fn(),
          confirm: vi.fn(),
          subscribeMenuActions: () => () => {},
        },
      }}
    >
      <ThemeProvider>
        <ToastProvider>
          <MessageView message={message} expanded onToggle={() => {}} onOpenLink={() => {}} />
        </ToastProvider>
      </ThemeProvider>
    </ServicesProvider>,
  );
  return userEvent.setup();
}

describe('attachment chips', () => {
  it('opens from the filename and saves only through the separate button', async () => {
    const openAttachment = vi.fn().mockResolvedValue(undefined);
    const downloadAttachment = vi.fn().mockResolvedValue(undefined);
    const user = setup({ openAttachment, downloadAttachment });
    await user.click(screen.getByRole('button', { name: 'Open Report.pdf' }));
    expect(openAttachment).toHaveBeenCalledWith('account', 'thread', 'message', attachment);
    expect(downloadAttachment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save Report.pdf' }));
    expect(downloadAttachment).toHaveBeenCalledWith('account', 'thread', 'message', attachment);
    expect(openAttachment).toHaveBeenCalledOnce();
  });

  it('disables both actions during opening, reports errors and allows retry', async () => {
    let reject!: (error: Error) => void;
    const openAttachment = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const user = setup({ openAttachment, downloadAttachment: vi.fn() });
    const open = screen.getByRole('button', { name: 'Open Report.pdf' });
    await user.click(open);
    expect(open).toBeDisabled();
    expect(open).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Opening…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Report.pdf' })).toBeDisabled();
    await act(async () => reject(new Error('No application is available')));
    expect(screen.getByRole('status')).toHaveTextContent('No application is available');
    await waitFor(() => expect(open).toBeEnabled());
    await user.click(open);
    expect(openAttachment).toHaveBeenCalledTimes(2);
  });

  it('keeps metadata readable without exposing unsupported actions', () => {
    setup();
    expect(screen.getByText('Report.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Open|Save) Report/ })).not.toBeInTheDocument();
  });
});
