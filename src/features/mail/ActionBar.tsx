import {
  Archive,
  Mail,
  MailOpen,
  RotateCcw,
  Star,
  Tag,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DropdownMenu, type MenuItemSpec } from '@/components/ui/Menu';
import type { ActionDescriptor, MailActionId } from './actions';
import type { Perform } from './useThreadActions';
import type { ID } from '@/domain/mail';

const ICONS: Record<MailActionId, LucideIcon> = {
  archive: Archive,
  trash: Trash2,
  restore: RotateCcw,
  markRead: MailOpen,
  markUnread: Mail,
  star: Star,
  unstar: Star,
};

type Props = {
  actions: ActionDescriptor[];
  labelItems: MenuItemSpec[];
  labelsDisabled: boolean;
  ids: ID[];
  perform: Perform;
};

/** Toolbar rendering of the shared actions. */
export function ActionBar({ actions, labelItems, labelsDisabled, ids, perform }: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Conversation actions"
      className="no-drag flex items-center gap-0.5"
    >
      {actions.map((a) => {
        const Icon = ICONS[a.id];
        return (
          <Button
            key={a.id}
            aria-label={a.label}
            title={a.shortcut ? `${a.label} (${a.shortcut})` : a.label}
            disabled={!a.enabled}
            onClick={() => perform(a.id, ids)}
          >
            <Icon size={15} className={a.id === 'unstar' ? 'fill-star text-star' : undefined} />
          </Button>
        );
      })}
      <DropdownMenu
        items={labelItems}
        trigger={
          <Button aria-label="Labels" title="Labels (apply or remove)" disabled={labelsDisabled}>
            <Tag size={15} />
          </Button>
        }
      />
    </div>
  );
}
