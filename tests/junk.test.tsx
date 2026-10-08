import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { planThreadDrop } from '@/features/mail/dnd';
import type { MenuAction, PlatformService } from '@/platform';
import type { ThreadSummary } from '@/domain/mail';

let mail: MockMailService;
let menu: ((a: MenuAction) => void) | undefined;

function setup() {
  mail = new MockMailService(createSeedData(), { latency: 0 });
  const platform: PlatformService = {
    showNotification: vi.fn().mockResolvedValue(undefined),
    setBadge: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    setWindowTheme: vi.fn().mockResolvedValue(undefined),
    confirm: vi.fn().mockResolvedValue(true),
    subscribeMenuActions: (h) => {
      menu = h;
      return () => {
        menu = undefined;
      };
    },
  };
  const user = userEvent.setup();
  render(<App services={{ mail, platform }} />);
  return { user, platform };
}

const rows = () => screen.queryAllByRole('option');
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(0));
const rowFor = (s: string) => rows().find((r) => r.textContent?.includes(s))!;
const sidebar = () => screen.getByRole('navigation', { name: 'Mailboxes' });
const junkButton = () => within(sidebar()).getByRole('button', { name: /^Junk/ });
const reader = () => screen.getByRole('region', { name: 'Conversation' });
const PHARMA = 'Exclusive offer: save 80%';

async function openJunk(user: ReturnType<typeof userEvent.setup>) {
  await waitForRows();
  await user.click(junkButton());
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Junk' })).toBeInTheDocument());
  await waitFor(() => expect(rowFor(PHARMA)).toBeTruthy());
}

const srcdoc = () => reader().querySelector('iframe')!.getAttribute('srcdoc') ?? '';

beforeEach(() => localStorage.clear());

describe('Junk mailbox', () => {
  it('shows Junk in the sidebar with its unread count, between Sent and Trash', async () => {
    setup();
    await waitForRows();
    const names = within(sidebar())
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    const at = (n: string) => names.findIndex((t) => t.startsWith(n));
    expect(at('Sent')).toBeLessThan(at('Junk'));
    expect(at('Junk')).toBeLessThan(at('Trash'));
    // Two unread seeded junk threads.
    await waitFor(() => expect(junkButton()).toHaveAccessibleName(/2 unread/));
  });

  it('lists seeded junk threads and keeps them out of Inbox, All Mail and Starred', async () => {
    const { user } = setup();
    await openJunk(user);
    expect(rowFor('Your parcel could not be delivered')).toBeTruthy();
    for (const name of [/^Inbox/, /^All Mail/, /^Starred/]) {
      await user.click(within(sidebar()).getByRole('button', { name }));
      await waitFor(() => expect(rows().length).toBeGreaterThan(0));
      expect(rows().some((r) => r.textContent?.includes(PHARMA))).toBe(false);
      expect(rows().some((r) => r.textContent?.includes('Your parcel could not'))).toBe(false);
    }
  });

  it('Mark as Junk from the toolbar moves the thread to Junk', async () => {
    const { user } = setup();
    await waitForRows();
    await user.click(rowFor('Lunch Thursday'));
    await user.click(await screen.findByRole('button', { name: 'Mark as Junk' }));
    await waitFor(() =>
      expect(rows().some((r) => r.textContent?.includes('Lunch Thursday'))).toBe(false),
    );
    await user.click(junkButton());
    await waitFor(() => expect(rowFor('Lunch Thursday')).toBeTruthy());
  });

  it('the ! shortcut marks as Junk, and in Junk the same key is Not Junk (back to Inbox)', async () => {
    const { user } = setup();
    await waitForRows();
    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}');
    const first = rows()[0]!.id;
    await user.keyboard('!');
    await waitFor(() => expect(document.getElementById(first)).toBeNull());
    await user.click(junkButton());
    await waitFor(() => expect(document.getElementById(first)).not.toBeNull());

    await user.click(document.getElementById(first)!);
    screen.getByRole('listbox').focus();
    await user.keyboard('!');
    await waitFor(() => expect(document.getElementById(first)).toBeNull());
    await user.click(within(sidebar()).getByRole('button', { name: /^Inbox/ }));
    await waitFor(() => expect(document.getElementById(first)).not.toBeNull());
  });

  it('Not Junk (toolbar) returns the thread to the Inbox', async () => {
    const { user } = setup();
    await openJunk(user);
    await user.click(rowFor('Your parcel could not'));
    await user.click(await screen.findByRole('button', { name: 'Not Junk' }));
    await waitFor(() =>
      expect(rows().some((r) => r.textContent?.includes('Your parcel'))).toBe(false),
    );
    await user.click(within(sidebar()).getByRole('button', { name: /^Inbox/ }));
    await waitFor(() => expect(rowFor('Your parcel could not be delivered')).toBeTruthy());
  });

  it('the toolbar in Junk offers Not Junk and Delete Permanently, but not Trash, Archive, Star, Labels or Mark as Junk', async () => {
    const { user } = setup();
    await openJunk(user);
    await user.click(rowFor(PHARMA));
    const bar = await screen.findByRole('toolbar', { name: 'Conversation actions' });
    expect(within(bar).getByRole('button', { name: 'Not Junk' })).toBeEnabled();
    expect(within(bar).getByRole('button', { name: 'Delete Permanently' })).toBeEnabled();
    for (const name of ['Move to Trash', 'Add Star', 'Labels', 'Archive'])
      expect(within(bar).queryByRole('button', { name })).toBeNull();
    expect(within(bar).queryByRole('button', { name: 'Mark as Junk' })).toBeNull();
  });

  it('Delete Permanently asks for confirmation, then removes the junk thread for good', async () => {
    const { user, platform } = setup();
    await openJunk(user);
    await user.click(rowFor(PHARMA));
    await user.click(await screen.findByRole('button', { name: 'Delete Permanently' }));
    expect(platform.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Delete', destructive: true }),
    );
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(PHARMA))).toBe(false));
    expect((await mail.getThreads({ accountId: 'acct-1', mailbox: 'junk' })).items).toHaveLength(2);
  });

  it('cancelling the confirmation keeps the thread', async () => {
    const { user, platform } = setup();
    vi.mocked(platform.confirm).mockResolvedValue(false);
    await openJunk(user);
    await user.click(rowFor(PHARMA));
    await user.click(await screen.findByRole('button', { name: 'Delete Permanently' }));
    await waitFor(() => expect(platform.confirm).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(rowFor(PHARMA)).toBeTruthy();
    expect((await mail.getThreads({ accountId: 'acct-1', mailbox: 'junk' })).items).toHaveLength(3);
  });

  it('context menu offers Mark as Junk in the Inbox and Not Junk in Junk', async () => {
    const { user } = setup();
    await waitForRows();
    await user.pointer({ keys: '[MouseRight]', target: rowFor('Lunch Thursday') });
    let menuEl = await screen.findByRole('menu');
    expect(within(menuEl).getByRole('menuitem', { name: /Mark as Junk/ })).toBeInTheDocument();
    await user.click(within(menuEl).getByRole('menuitem', { name: /Mark as Junk/ }));
    await waitFor(() =>
      expect(rows().some((r) => r.textContent?.includes('Lunch Thursday'))).toBe(false),
    );

    await user.click(junkButton());
    await waitFor(() => expect(rowFor('Lunch Thursday')).toBeTruthy());
    await user.pointer({ keys: '[MouseRight]', target: rowFor('Lunch Thursday') });
    menuEl = await screen.findByRole('menu');
    expect(within(menuEl).getByRole('menuitem', { name: /Not Junk/ })).toBeInTheDocument();
    expect(within(menuEl).queryByRole('menuitem', { name: /Mark as Junk/ })).toBeNull();
    await user.click(within(menuEl).getByRole('menuitem', { name: /Not Junk/ }));
    await waitFor(() =>
      expect(rows().some((r) => r.textContent?.includes('Lunch Thursday'))).toBe(false),
    );
  });

  it('the native menu "junk" action toggles like the shortcut', async () => {
    const { user } = setup();
    await waitForRows();
    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}{Enter}');
    const target = rows()[0]!;
    await waitFor(() => expect(target).toHaveAttribute('aria-selected', 'true'));
    act(() => menu?.('junk'));
    await waitFor(() => expect(document.getElementById(target.id)).toBeNull());
    expect((await mail.getThreads({ accountId: 'acct-1', mailbox: 'junk' })).items).toHaveLength(4);
  });

  it('dragging to the Junk sidebar item marks as Junk; dragging Junk to Inbox moves it back', () => {
    const t = (labelIds: string[]) => ({ id: 'x', labelIds, isStarred: false }) as ThreadSummary;
    expect(planThreadDrop({ kind: 'mailbox', mailbox: 'junk' }, [t(['INBOX'])], false)).toEqual({
      action: 'markJunk',
    });
    expect(planThreadDrop({ kind: 'mailbox', mailbox: 'junk' }, [t(['SPAM'])], false)).toBeNull();
    expect(planThreadDrop({ kind: 'mailbox', mailbox: 'inbox' }, [t(['SPAM'])], false)).toEqual({
      action: 'restore',
    });
  });

  it('shows an error toast and keeps the row when marking as Junk fails', async () => {
    const { user } = setup();
    await waitForRows();
    await user.click(rowFor('Lunch Thursday'));
    mail.failNext('markJunk');
    await user.click(await screen.findByRole('button', { name: 'Mark as Junk' }));
    expect(await screen.findByText(/Couldn.t mark as junk/)).toBeInTheDocument();
    expect(rowFor('Lunch Thursday')).toBeTruthy();
  });
});

describe('Junk reader: images never auto-load', () => {
  it('blocks remote images with a Junk banner; "Load images" loads them for that message only', async () => {
    const { user } = setup();
    await openJunk(user);
    await user.click(rowFor(PHARMA));
    const r = reader();
    expect(await within(r).findByText('In Junk')).toBeInTheDocument();
    const banner = await within(r).findByText(/Images are not loaded automatically/);
    expect(banner).toBeInTheDocument();
    await waitFor(() => expect(srcdoc()).toContain('Content-Security-Policy'));
    expect(srcdoc()).toContain('img-src data: cid:;');
    expect(srcdoc()).not.toContain('images.cheap-meds-outlet.example.biz');
    expect(srcdoc()).not.toContain('track.cheap-meds-outlet.example.biz');

    await user.click(within(r).getByRole('button', { name: 'Load images' }));
    await waitFor(() => expect(srcdoc()).toContain('img-src data: cid: https:'));
    expect(srcdoc()).toContain('images.cheap-meds-outlet.example.biz/hero.jpg');
    expect(within(r).queryByRole('button', { name: 'Load images' })).toBeNull();
    // The sandbox stays locked down.
    expect(r.querySelector('iframe')!.getAttribute('sandbox')).toBe('allow-same-origin');
  });

  it('does not remember the choice: reopening the message blocks images again', async () => {
    const { user } = setup();
    await openJunk(user);
    await user.click(rowFor(PHARMA));
    await user.click(await within(reader()).findByRole('button', { name: 'Load images' }));
    await waitFor(() => expect(srcdoc()).toContain('https:'));
    await user.click(rowFor('Your parcel could not'));
    await within(reader()).findByText(/Pay the 1,99 EUR fee/);
    await user.click(rowFor(PHARMA));
    await within(reader()).findByRole('button', { name: 'Load images' });
    expect(srcdoc()).toContain('img-src data: cid:;');
  });

  it('plain-text junk shows the In Junk marker and no image banner', async () => {
    const { user } = setup();
    await openJunk(user);
    await user.click(rowFor('Your parcel could not'));
    expect(await within(reader()).findByText('In Junk')).toBeInTheDocument();
    expect(within(reader()).queryByRole('button', { name: /Load (remote )?images/ })).toBeNull();
  });

  it('outside Junk the existing remote-content banner is unchanged', async () => {
    const { user } = setup();
    await waitForRows();
    await user.click(rowFor('Hacker Newsletter #712'));
    expect(await within(reader()).findByText(/Remote content is blocked/)).toBeInTheDocument();
    expect(within(reader()).queryByText('In Junk')).toBeNull();
  });

  it('after Not Junk the message is a normal inbox message again', async () => {
    const { user } = setup();
    await openJunk(user);
    await user.click(rowFor(PHARMA));
    await user.click(await screen.findByRole('button', { name: 'Not Junk' }));
    await user.click(within(sidebar()).getByRole('button', { name: /^Inbox/ }));
    await waitFor(() => expect(rowFor(PHARMA)).toBeTruthy());
    await user.click(rowFor(PHARMA));
    expect(await within(reader()).findByText(/Remote content is blocked/)).toBeInTheDocument();
    expect(within(reader()).queryByText('In Junk')).toBeNull();
  });
});

describe('Junk accessibility', () => {
  it('has no axe violations in the Junk list or with a junk thread and banner open', async () => {
    const { user } = setup();
    await openJunk(user);
    const run = async () => {
      const res = await axe.run(
        { include: [document.body], exclude: [['iframe']] },
        {
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
          rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
        },
      );
      return res.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
      );
    };
    expect(await run()).toEqual([]);
    await user.click(rowFor(PHARMA));
    await within(reader()).findByRole('button', { name: 'Load images' });
    expect(await run()).toEqual([]);
  });

  it('announces the Junk unread count to assistive tech and marks the current mailbox', async () => {
    const { user } = setup();
    await waitForRows();
    expect(junkButton()).toHaveAccessibleName('Junk, 2 unread');
    expect(junkButton()).not.toHaveAttribute('aria-current');
    await user.click(junkButton());
    expect(junkButton()).toHaveAttribute('aria-current', 'page');
  });

  it('shows the empty state when Junk has no conversations', async () => {
    const { user } = setup();
    await openJunk(user);
    screen.getByRole('listbox').focus();
    await user.keyboard('{Meta>}a{/Meta}');
    await user.click(await screen.findByRole('button', { name: 'Not Junk' }));
    expect(await screen.findByText('No junk mail.')).toBeInTheDocument();
  });
});
