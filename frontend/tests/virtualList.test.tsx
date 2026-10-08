import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import type { Services } from '@/app/services';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { Message } from '@/domain/mail';

vi.setConfig({ testTimeout: 60_000 });

const ROW_H = 60;
const VIEWPORT_H = 600;
const N = 3000;
// While true the list looks unfilled, so it keeps fetching pages (jsdom has no scroll geometry).
let fill = true;

// jsdom has no layout: give the virtualizer a viewport and fixed row heights.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.getAttribute('role') === 'listbox' ? VIEWPORT_H : ROW_H;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => VIEWPORT_H,
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => (fill ? VIEWPORT_H : 1e9),
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 400,
  });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const h = this.getAttribute('role') === 'listbox' ? VIEWPORT_H : ROW_H;
    return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: h, width: 400, height: h } as DOMRect;
  };
  Element.prototype.scrollIntoView = vi.fn();
});

function bigSeed(n: number) {
  const seed = createSeedData();
  const base = seed.messages.filter((m) => m.id.endsWith('-m1'));
  const t0 = Date.parse('2026-10-07T12:00:00Z');
  const extra: Message[] = Array.from({ length: n }, (_, i) => {
    const m = base[i % base.length]!;
    return {
      ...m,
      id: `big${i}-m1`,
      threadId: `big${i}`,
      subject: `${m.subject} #${i}`,
      sentAt: new Date(t0 - i * 60_000).toISOString(),
      labelIds: ['INBOX'],
    };
  });
  return { ...seed, messages: [...seed.messages, ...extra] };
}

async function setup(n = N) {
  const mail = new MockMailService(bigSeed(n), { latency: 0 });
  let pages = 0;
  const getThreads = mail.getThreads.bind(mail);
  mail.getThreads = (q) => {
    pages++;
    return getThreads(q);
  };
  const services: Services = {
    mail,
    platform: {
      showNotification: vi.fn().mockResolvedValue(undefined),
      setBadge: vi.fn().mockResolvedValue(undefined),
      openExternal: vi.fn().mockResolvedValue(undefined),
      setWindowTheme: vi.fn().mockResolvedValue(undefined),
      subscribeMenuActions: () => () => {},
    },
  };
  const user = userEvent.setup();
  const t0 = performance.now();
  render(<App services={services} />);
  const list = await screen.findByRole('listbox', { name: /conversations/i });
  fill = true;
  // Automatic fill is capped, so scroll (user intent) until enough pages have loaded to cross
  // the virtualization threshold and the 150-row keyboard test.
  await waitFor(() => {
    fireEvent.scroll(list);
    expect(pages).toBeGreaterThanOrEqual(8); // 30 rows per page
  });
  fill = false;
  return { user, list, mount: performance.now() - t0 };
}

const rows = () => screen.queryAllByRole('option');
const active = (list: HTMLElement) => {
  const id = list.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};

describe('virtualized thread list', () => {
  it('mounts only a window of rows', async () => {
    const { mount } = await setup();
    expect(rows().length).toBeLessThan(80);
    expect(rows()[0]!.getAttribute('aria-posinset')).toBe('1');
    console.log(`virtual list first render: ${mount.toFixed(0)}ms, ${rows().length} rows in DOM`);
  });

  it('keyboard nav mounts the cursor row and keeps aria-activedescendant resolvable', async () => {
    const { user, list } = await setup();
    list.focus();
    // 60 rows is well past the ~20-row window (so the cursor row must be mounted on demand) while
    // keeping the test fast on loaded CI machines.
    for (let i = 0; i < 60; i++) await user.keyboard('{ArrowDown}');
    const el = active(list);
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-posinset')).toBe('60');
    expect(rows().length).toBeLessThan(80);
    for (let i = 0; i < 40; i++) await user.keyboard('{ArrowUp}');
    expect(active(list)).not.toBeNull();
  }, 60_000);

  it('⌘A selects every loaded id without mounting them all', async () => {
    const { user, list } = await setup();
    list.focus();
    await user.keyboard('{Control>}a{/Control}');
    await waitFor(() => expect(screen.getByText(/\d+ selected/)).toBeInTheDocument());
    const n = Number(/(\d+) selected/.exec(screen.getByText(/\d+ selected/).textContent!)![1]);
    expect(n).toBeGreaterThan(100);
    expect(rows().length).toBeLessThan(80);
    expect(active(list)).not.toBeNull();
    expect(rows().every((r) => r.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('shift-click selects a range', async () => {
    const { user } = await setup();
    await user.click(rows()[0]!);
    const target = rows()[10]!;
    await user.keyboard('{Shift>}');
    await user.click(target);
    await user.keyboard('{/Shift}');
    expect(screen.getByText('11 selected')).toBeInTheDocument();
  });

  it('perf sanity: 5000 threads keep the DOM small', async () => {
    const { mount, list } = await setup(5000);
    const t = performance.now();
    list.focus();
    const user = userEvent.setup();
    for (let i = 0; i < 30; i++) await user.keyboard('{ArrowDown}');
    const nav = (performance.now() - t) / 30;
    expect(rows().length).toBeLessThan(80);
    console.log(
      `perf: mount ${mount.toFixed(0)}ms, ${rows().length} rows in DOM, ${nav.toFixed(1)}ms/keypress`,
    );
  }, 60_000);
});
