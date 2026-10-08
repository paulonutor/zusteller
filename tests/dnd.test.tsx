import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/app/App';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';

// jsdom has no DataTransfer; the handlers only need these members.
const dataTransfer = () => ({
  data: {} as Record<string, string>,
  effectAllowed: '',
  dropEffect: '',
  setData(k: string, v: string) {
    this.data[k] = v;
  },
  setDragImage: vi.fn(),
});

const rows = () => screen.queryAllByRole('option');
const nav = () => screen.getByRole('navigation', { name: 'Mailboxes' });
const side = (name: RegExp) => within(nav()).getByRole('button', { name }).closest('li')!;
const waitForRows = () => waitFor(() => expect(rows().length).toBeGreaterThan(0));

// jsdom has no DragEvent, so modifier keys aren't copied from the init; set them by hand.
function fire(
  type: 'dragEnter' | 'dragOver' | 'drop',
  el: HTMLElement,
  dt: object,
  altKey: boolean,
) {
  const e = createEvent[type](el, { dataTransfer: dt });
  Object.defineProperty(e, 'altKey', { value: altKey });
  fireEvent(el, e);
}

/** Fires the full native sequence so React sees dragstart → enter → over → drop → end. */
function drag(source: HTMLElement, target: HTMLElement, mods: { altKey?: boolean } = {}) {
  const dt = dataTransfer();
  fireEvent.dragStart(source, { dataTransfer: dt });
  fire('dragEnter', target, dt, !!mods.altKey);
  fire('dragOver', target, dt, !!mods.altKey);
  fire('drop', target, dt, !!mods.altKey);
  fireEvent.dragEnd(source, { dataTransfer: dt });
  return dt;
}

let mail: MockMailService;
const labelsOf = async (rowId: string) =>
  (await mail.getThread((await mail.getAccounts())[0]!.id, rowId.replace('row-', ''))).labelIds;

beforeEach(() => {
  localStorage.clear();
  mail = new MockMailService(createSeedData(), { latency: 0 });
  render(
    <App
      services={{
        mail,
        platform: {
          showNotification: vi.fn().mockResolvedValue(undefined),
          setBadge: vi.fn().mockResolvedValue(undefined),
          openExternal: vi.fn().mockResolvedValue(undefined),
          subscribeMenuActions: () => () => undefined,
        },
      }}
    />,
  );
});

describe('dragging conversations', () => {
  it('moves a conversation to a label (leaves the Inbox) by default', async () => {
    await waitForRows();
    const row = rows()[0]!;
    drag(row, side(/^Finance/));
    await waitFor(async () => {
      const ids = await labelsOf(row.id);
      expect(ids).toContain('label-finance');
      expect(ids).not.toContain('INBOX');
    });
    await waitFor(() => expect(document.getElementById(row.id)).toBeNull());
  });

  it('only adds the label while Option is held', async () => {
    await waitForRows();
    const row = rows()[0]!;
    drag(row, side(/^Finance/), { altKey: true });
    await waitFor(async () => expect(await labelsOf(row.id)).toContain('label-finance'));
    expect(await labelsOf(row.id)).toContain('INBOX');
    expect(document.getElementById(row.id)).not.toBeNull();
  });

  it('archives and trashes by dropping on the mailboxes', async () => {
    await waitForRows();
    const [a, b] = rows();
    drag(a!, side(/^All Mail/));
    await waitFor(() => expect(document.getElementById(a!.id)).toBeNull());
    drag(document.getElementById(b!.id)!, side(/^Trash/));
    await waitFor(() => expect(document.getElementById(b!.id)).toBeNull());
  });

  it('refuses drops that would change nothing', async () => {
    await waitForRows();
    const row = rows()[0]!;
    const sent = side(/^Sent/);
    fireEvent.dragStart(row, { dataTransfer: dataTransfer() });
    await waitFor(() => expect(sent).toHaveAttribute('data-drop', 'invalid'));
    expect(side(/^Trash/)).toHaveAttribute('data-drop', 'valid');
    fireEvent.dragEnd(row);
    await waitFor(() => expect(sent).not.toHaveAttribute('data-drop'));
  });

  it('refuses the view that is already open', async () => {
    await waitForRows();
    fireEvent.dragStart(rows()[0]!, { dataTransfer: dataTransfer() });
    await waitFor(() => expect(side(/^Inbox/)).toHaveAttribute('data-drop', 'invalid'));
  });

  it('drags the whole selection when the grabbed row is selected', async () => {
    await waitForRows();
    const [a, b, c] = rows();
    fireEvent.click(a!);
    fireEvent.click(b!, { metaKey: true });
    drag(document.getElementById(b!.id)!, side(/^Trash/));
    await waitFor(() => {
      expect(document.getElementById(a!.id)).toBeNull();
      expect(document.getElementById(b!.id)).toBeNull();
    });
    expect(document.getElementById(c!.id)).not.toBeNull();
  });
});

describe('dragging a label onto conversations', () => {
  it('adds the label to the row it is dropped on', async () => {
    await waitForRows();
    const row = rows()[0]!;
    drag(side(/^Finance/), row);
    await waitFor(async () => expect(await labelsOf(row.id)).toContain('label-finance'));
    expect(await labelsOf(row.id)).toContain('INBOX');
  });

  it('refuses a row that already has the label', async () => {
    await waitForRows();
    const row = rows()[0]!;
    drag(side(/^Finance/), row);
    await waitFor(async () => expect(await labelsOf(row.id)).toContain('label-finance'));
    fireEvent.dragStart(side(/^Finance/), { dataTransfer: dataTransfer() });
    await waitFor(() => expect(row).toHaveAttribute('data-drop', 'invalid'));
  });
});
