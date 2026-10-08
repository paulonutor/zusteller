import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import type { PlatformService } from '@/platform';

const platform: PlatformService = {
  showNotification: vi.fn().mockResolvedValue(undefined),
  setBadge: vi.fn().mockResolvedValue(undefined),
  openExternal: vi.fn().mockResolvedValue(undefined),
  setWindowTheme: vi.fn().mockResolvedValue(undefined),
  subscribeMenuActions: () => () => {},
};

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
    const { mail, user } = setup(80);
    await waitFor(() => expect(rows().length).toBeGreaterThan(3));
    const archive = vi.spyOn(mail, 'archive');
    const a = rows()[0]!.textContent!.slice(0, 12);
    await user.click(rows()[0]!);
    key('e');
    const d = rows()[3]!;
    await user.click(d);
    const subject = d.id;
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 300));
    expect(a).toBeTruthy();
    const after = document.getElementById(subject);
    expect(after).not.toBeNull();
    expect(after!.getAttribute('aria-selected')).toBe('true');
  });
});
