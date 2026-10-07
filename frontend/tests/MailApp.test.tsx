import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import type { Services } from '@/app/services';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { MenuAction, PlatformService } from '@/platform';

let mail: MockMailService;
let platform: PlatformService;
let menu: ((a: MenuAction) => void) | undefined;

function setup() {
  mail = new MockMailService(createSeedData(), { latency: 0 });
  platform = {
    showNotification: vi.fn().mockResolvedValue(undefined),
    setBadge: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    subscribeMenuActions: (h) => {
      menu = h;
      return () => {
        menu = undefined;
      };
    },
  };
  const services: Services = { mail, platform };
  const user = userEvent.setup();
  render(<App services={services} />);
  return user;
}

const rows = () => screen.queryAllByRole('option');
const rowFor = (subject: RegExp | string) =>
  rows().find((r) =>
    typeof subject === 'string'
      ? r.textContent?.includes(subject)
      : subject.test(r.textContent ?? ''),
  )!;
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(0));
const inboxUnread = () =>
  within(screen.getByRole('navigation', { name: 'Mailboxes' })).getByRole('button', {
    name: /^Inbox/,
  });

beforeEach(() => {
  localStorage.clear();
});

describe('browsing', () => {
  it('shows the inbox with an unread count and switches mailboxes and labels', async () => {
    const user = setup();
    await waitForRows();
    expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(inboxUnread()).toHaveAccessibleName(/\d+ unread/);

    await user.click(screen.getByRole('button', { name: /^Trash/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Trash' })).toBeInTheDocument());
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));

    await user.click(screen.getByRole('button', { name: /^Finance/ }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Finance' })).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(rows().every((r) => /Finance/.test(r.textContent ?? ''))).toBe(true),
    );
  });

  it('opens a conversation, marks it read and updates the unread count', async () => {
    const user = setup();
    await waitForRows();
    const unreadCount = () =>
      Number(
        inboxUnread().getAttribute('aria-label')?.match(/\d+/)?.[0] ??
          inboxUnread().textContent?.match(/\d+/)?.[0],
      );
    const before = unreadCount();
    const unreadRow = rows().find((r) => r.getAttribute('data-unread') === 'true')!;
    await user.click(unreadRow);
    await within(screen.getByRole('region', { name: 'Conversation' })).findByRole('heading', {
      level: 2,
    });
    await waitFor(() =>
      expect(document.getElementById(unreadRow.id)).toHaveAttribute('data-unread', 'false'),
    );
    await waitFor(() => expect(unreadCount()).toBe(before - 1));
  });

  it('expands older messages in a multi-message thread', async () => {
    const user = setup();
    await waitForRows();
    await user.click(rowFor('Lunch Thursday'));
    const articles = await screen.findAllByRole('article');
    expect(articles.length).toBeGreaterThan(1);
    const collapsed = articles.find((a) => within(a).getByRole('button', { expanded: false }))!;
    await user.click(within(collapsed).getAllByRole('button')[0]!);
    await waitFor(() =>
      expect(within(collapsed).getAllByRole('button')[0]).toHaveAttribute('aria-expanded', 'true'),
    );
  });
});

describe('actions', () => {
  it('stars from the row and shows it in Starred', async () => {
    const user = setup();
    await waitForRows();
    const row = rowFor('Lunch Thursday');
    await user.click(within(row).getByRole('button', { name: 'Add star' }));
    await waitFor(() =>
      expect(
        within(rowFor('Lunch Thursday')).getByRole('button', { name: 'Remove star' }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /^Starred/ }));
    await waitFor(() => expect(rowFor('Lunch Thursday')).toBeTruthy());
  });

  it('archives via the toolbar: leaves Inbox, stays in All Mail', async () => {
    const user = setup();
    await waitForRows();
    const subject = 'Lunch Thursday';
    await user.click(rowFor(subject));
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(subject))).toBe(false));
    await user.click(screen.getByRole('button', { name: /^All Mail/ }));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(subject))).toBe(true));
  });

  it('trashes then restores', async () => {
    const user = setup();
    await waitForRows();
    const subject = 'Lunch Thursday';
    await user.click(rowFor(subject));
    await user.click(await screen.findByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(subject))).toBe(false));

    await user.click(screen.getByRole('button', { name: /^Trash/ }));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(subject))).toBe(true));
    await user.click(rowFor(subject));
    await user.click(await screen.findByRole('button', { name: 'Move to Inbox' }));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(subject))).toBe(false));

    await user.click(screen.getByRole('button', { name: /^Inbox/ }));
    await waitFor(() => expect(rows().some((r) => r.textContent?.includes(subject))).toBe(true));
  });

  it('rolls back an optimistic update and tells the user when the service fails', async () => {
    const user = setup();
    await waitForRows();
    mail.failNext('setStarred');
    const row = rowFor('Lunch Thursday');
    await user.click(within(row).getByRole('button', { name: 'Add star' }));
    expect(await screen.findByText(/Couldn.t update star/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(rowFor('Lunch Thursday')).getByRole('button', { name: 'Add star' }),
      ).toBeInTheDocument(),
    );
  });

  it('keeps the thread in place when archive fails', async () => {
    const user = setup();
    await waitForRows();
    await user.click(rowFor('Lunch Thursday'));
    mail.failNext('archive');
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/Couldn.t archive/)).toBeInTheDocument();
    expect(rowFor('Lunch Thursday')).toBeTruthy();
  });

  it('applies a label from the Labels menu', async () => {
    const user = setup();
    await waitForRows();
    await user.click(rowFor('Lunch Thursday'));
    await user.click(await screen.findByRole('button', { name: 'Labels' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Home' }));
    await waitFor(() =>
      expect(within(rowFor('Lunch Thursday')).getByText('Home')).toBeInTheDocument(),
    );
  });

  it('offers the same actions in the context menu', async () => {
    const user = setup();
    await waitForRows();
    await user.pointer({ keys: '[MouseRight]', target: rowFor('Lunch Thursday') });
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Archive/ })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: /Move to Trash/ }));
    await waitFor(() =>
      expect(rows().some((r) => r.textContent?.includes('Lunch Thursday'))).toBe(false),
    );
  });
});

describe('search', () => {
  it('debounces and filters, shows an empty state, and clears', async () => {
    const user = setup();
    await waitForRows();
    const total = rows().length;
    await user.type(screen.getByRole('searchbox'), 'zahnreinigung');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent(/Zahnreinigung/i);

    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'qqqqnotfound');
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(rows().length).toBe(total));
  });
});

describe('selection and keyboard', () => {
  it('navigates with arrows, opens with Enter, archives with "e"', async () => {
    const user = setup();
    await waitForRows();
    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    const target = rows()[1]!;
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', target.id);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(target).toHaveAttribute('aria-selected', 'true'));
    await within(screen.getByRole('region', { name: 'Conversation' })).findByRole('heading', {
      level: 2,
    });
    await user.keyboard('e');
    await waitFor(() => expect(document.getElementById(target.id)).toBeNull());
  });

  it('native menu actions run through the same handler as shortcuts', async () => {
    const user = setup();
    await waitForRows();
    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}{Enter}');
    const target = rows()[0]!;
    await waitFor(() => expect(target).toHaveAttribute('aria-selected', 'true'));
    act(() => menu?.('archive'));
    await waitFor(() => expect(document.getElementById(target.id)).toBeNull());
    act(() => menu?.('find'));
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('Cmd+A selects all and bulk actions apply to every conversation', async () => {
    const user = setup();
    await waitForRows();
    const n = rows().length;
    screen.getByRole('listbox').focus();
    await user.keyboard('{Meta>}a{/Meta}');
    await waitFor(() =>
      expect(screen.getByText(`${n} conversations selected`)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }));
    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(await screen.findByText('Your inbox is empty.')).toBeInTheDocument();
  });

  it('supports checkbox and shift-range selection', async () => {
    const user = setup();
    await waitForRows();
    await user.click(within(rows()[0]!).getByRole('checkbox'));
    await user.keyboard('{Shift>}');
    await user.click(rows()[2]!);
    await user.keyboard('{/Shift}');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('plain-key shortcuts are ignored while typing in search', async () => {
    const user = setup();
    await waitForRows();
    const total = rows().length;
    await user.click(rows()[0]!);
    await user.click(screen.getByRole('searchbox'));
    await user.keyboard('e');
    expect(rows().length).toBe(total);
    expect(screen.getByRole('searchbox')).toHaveValue('e');
  });
});

describe('errors', () => {
  it('shows an error state and recovers on retry', async () => {
    mail = new MockMailService(createSeedData(), { latency: 0 });
    mail.failNext('getThreads');
    platform = {
      showNotification: vi.fn(),
      setBadge: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn(),
      subscribeMenuActions: () => () => {},
    };
    const user = userEvent.setup();
    render(<App services={{ mail, platform }} />);
    expect(await screen.findByText(/Couldn.t load conversations/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitForRows();
  });
});

describe('appearance', () => {
  it('persists the theme choice', async () => {
    const user = setup();
    await waitForRows();
    await user.click(screen.getByRole('radio', { name: 'Dark appearance' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('zusteller.theme')).toBe('dark');
    await user.click(screen.getByRole('radio', { name: 'Light appearance' }));
    expect(document.documentElement).not.toHaveClass('dark');
  });
});
