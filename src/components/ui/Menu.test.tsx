import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServicesProvider } from '@/app/services';
import { MockMailService, createSeedData } from '@/infrastructure/mail/mock';
import { ContextMenu, DropdownMenu } from './Menu';
import { createTestPlatform, deferred } from '../../../tests/helpers/mail';

function services(showContextMenu: ReturnType<typeof createTestPlatform>['showContextMenu']) {
  return {
    mail: new MockMailService(createSeedData(), { latency: 0 }),
    platform: createTestPlatform({ showContextMenu }),
  };
}

describe('native menu lifecycle', () => {
  it.each([null, '0'])('closes on result %s and restores list focus', async (id) => {
    const result = deferred<string | null>();
    const native = vi.fn(() => result.promise);
    const select = vi.fn();
    const opened = vi.fn();
    render(
      <ServicesProvider services={services(native)}>
        <div role="listbox" tabIndex={0} aria-label="Mail">
          <ContextMenu
            items={[{ kind: 'item', label: 'Archive', onSelect: select }]}
            onOpenChange={opened}
          >
            <div role="option" aria-selected={false}>
              Message
            </div>
          </ContextMenu>
        </div>
      </ServicesProvider>,
    );
    const list = screen.getByRole('listbox');
    list.focus();
    fireEvent.contextMenu(screen.getByRole('option'));
    expect(document.documentElement).toHaveAttribute('data-native-menu-open');
    expect(opened).toHaveBeenLastCalledWith(true);
    result.resolve(id);
    await waitFor(() => expect(opened).toHaveBeenLastCalledWith(false));
    expect(select).toHaveBeenCalledTimes(id === null ? 0 : 1);
    expect(list).toHaveFocus();
    expect(document.documentElement).not.toHaveAttribute('data-native-menu-open');
  });

  it('restores dropdown trigger focus and ignores disabled native items', async () => {
    const native = vi.fn().mockResolvedValue('0');
    const select = vi.fn();
    render(
      <ServicesProvider services={services(native)}>
        <DropdownMenu
          trigger={<button>Filter</button>}
          items={[{ kind: 'item', label: 'Unread', disabled: true, onSelect: select }]}
        />
      </ServicesProvider>,
    );
    const trigger = screen.getByRole('button');
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() =>
      expect(document.documentElement).not.toHaveAttribute('data-native-menu-open'),
    );
    expect(trigger).toHaveFocus();
    expect(select).not.toHaveBeenCalled();
  });

  it('falls back to a browser menu when the host cannot open it', async () => {
    render(
      <ServicesProvider services={services(vi.fn().mockRejectedValue(new Error('Unsupported')))}>
        <DropdownMenu
          trigger={<button>Filter</button>}
          items={[{ kind: 'item', label: 'Unread', onSelect: vi.fn() }]}
        />
      </ServicesProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('menuitem', { name: 'Unread' })).toBeVisible();
    expect(document.documentElement).not.toHaveAttribute('data-native-menu-open');
  });
  it('opens a browser context menu on the first failed native request', async () => {
    const select = vi.fn();
    render(
      <ServicesProvider services={services(vi.fn().mockRejectedValue(new Error('Unsupported')))}>
        <ContextMenu items={[{ kind: 'item', label: 'Archive', onSelect: select }]}>
          <div>Message</div>
        </ContextMenu>
      </ServicesProvider>,
    );
    fireEvent.contextMenu(screen.getByText('Message'), { clientX: 120, clientY: 200 });
    const item = await screen.findByRole('menuitem', { name: 'Archive' });
    expect(item).toBeVisible();
    fireEvent.click(item);
    expect(select).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  });
});
