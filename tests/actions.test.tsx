import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { createTestPlatform, deferred } from './helpers/mail';

const platform = createTestPlatform();

const rows = () => screen.queryAllByRole('option');
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(3));
const rowFor = (subject: string) => rows().find((r) => r.textContent?.includes(subject))!;

function setup(latency = 0) {
  const mail = new MockMailService(createSeedData(), { latency });
  const user = userEvent.setup();
  render(<App services={{ mail, platform }} />);
  return { mail, user };
}

const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.body, { key: k, ...init });

beforeEach(() => localStorage.clear());

describe('action layer keyboard safety', () => {
  it('ignores auto-repeat keydowns', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const archive = vi.spyOn(mail, 'archive');
    await user.click(rowFor('Lunch Thursday'));
    for (let i = 0; i < 5; i++) key('e', { repeat: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(archive).not.toHaveBeenCalled();
    key('e');
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
  });

  it('does not treat CapsLock letters as Shift shortcuts', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const markUnread = vi.spyOn(mail, 'markRead');
    const unreadCalls = () => markUnread.mock.calls.filter((c) => c[2] === false).length;
    await user.click(rowFor('Lunch Thursday'));
    key('U'); // CapsLock on, plain u
    await new Promise((r) => setTimeout(r, 50));
    expect(unreadCalls()).toBe(0);
    key('U', { shiftKey: true });
    await waitFor(() => expect(unreadCalls()).toBe(1));
  });

  it('does not wipe a newer selection when an earlier archive resolves', async () => {
    const { mail, user } = setup();
    await waitForRows();
    const gate = deferred<void>();
    const realArchive = mail.archive.bind(mail);
    const archive = vi.spyOn(mail, 'archive').mockImplementationOnce(async (...args) => {
      await gate.promise;
      await realArchive(...args);
    });
    const a = rows()[0]!.textContent!.slice(0, 12);
    await user.click(rows()[0]!);
    key('e');
    const d = rows()[3]!;
    await user.click(d);
    const subject = d.id;
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    gate.resolve();
    await waitFor(() => expect(rows().some((r) => r.textContent?.startsWith(a))).toBe(false));
    expect(a).toBeTruthy();
    const after = document.getElementById(subject);
    expect(after).not.toBeNull();
    expect(after!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('startup failure', () => {
  it('shows an error with Try again instead of loading forever, and recovers', async () => {
    const mail = new MockMailService(createSeedData(), { latency: 0 });
    mail.setOffline(true);
    const platform = {
      showNotification: vi.fn(),
      setBadge: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn(),
      confirm: () => Promise.resolve(true),
      subscribeMenuActions: () => () => undefined,
    };
    const user = userEvent.setup();
    render(<App services={{ mail, platform }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Can’t load your mail');
    mail.setOffline(false);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
  });
});

describe('list header selection state', () => {
  it('opening one thread is not "1 selected"; explicit multi-select is', async () => {
    const mail = new MockMailService(createSeedData(), { latency: 0 });
    const platform = {
      showNotification: vi.fn(),
      setBadge: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn(),
      confirm: () => Promise.resolve(true),
      subscribeMenuActions: () => () => undefined,
    };
    const user = userEvent.setup();
    render(<App services={{ mail, platform }} />);
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1));

    await user.click(screen.getAllByRole('option')[1]!);
    expect(screen.queryByText(/\d+ selected/)).not.toBeInTheDocument();

    screen.getByRole('listbox').focus();
    await user.keyboard('{Control>}a{/Control}');
    expect(await screen.findByText(/\d+ selected/)).toBeInTheDocument();
  });
});

describe('optimistic mailbox actions', () => {
  for (const [action, shortcut] of [
    ['archive', 'e'],
    ['trash', '#'],
  ] as const) {
    it(`${action} removes the row before the service finishes and restores it on failure`, async () => {
      const { mail, user } = setup();
      await waitForRows();
      const gate = deferred<void>();
      vi.spyOn(mail, action).mockImplementationOnce(() => gate.promise);
      const row = rowFor('Lunch Thursday');
      const id = row.id;
      await user.click(row);
      key(shortcut);
      await waitFor(() => expect(rows().some((r) => r.id === id)).toBe(false));
      // The provider has not changed yet. The row left through the optimistic cache update.
      expect(
        (await mail.getThreads({ accountId: 'acct-1', mailbox: 'inbox' })).items.some((t) =>
          t.subject.includes('Lunch Thursday'),
        ),
      ).toBe(true);
      const newer = rows()[2]!;
      await user.click(newer);
      gate.reject(new Error('Write failed'));
      expect(await screen.findByText(/Couldn't .*Write failed/)).toBeInTheDocument();
      await waitFor(() => expect(rows().some((r) => r.id === id)).toBe(true));
      expect(document.getElementById(newer.id)).toHaveAttribute('aria-selected', 'true');
    });
  }

  it('archive keeps the open row in All Mail while the write is pending', async () => {
    const { mail, user } = setup();
    await waitForRows();
    await user.click(screen.getByRole('button', { name: 'All Mail' }));
    await waitForRows();
    const row = rowFor('Lunch Thursday');
    await user.click(row);
    const gate = deferred<void>();
    const real = mail.archive.bind(mail);
    vi.spyOn(mail, 'archive').mockImplementationOnce(async (...args) => {
      await gate.promise;
      await real(...args);
    });
    key('e');
    await waitFor(() => expect(mail.archive).toHaveBeenCalled());
    expect(row).toHaveAttribute('aria-selected', 'true');
    gate.resolve();
    await waitFor(() => expect(rowFor('Lunch Thursday')).toHaveAttribute('aria-selected', 'true'));
  });
});
