import type { ComponentType } from 'react';
import { Archive, Mail, MailOpen, RotateCcw, ShieldAlert, Star, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { DropdownMenu, type MenuItemSpec } from '@/components/ui/Menu';
import type { ActionDescriptor, MailActionId } from './actions';
import type { Perform } from './useThreadActions';
import type { ID } from '@/domain/mail';

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** "Mark as Junk" shield with a strike through it: the same glyph, negated. */
function NotJunkIcon({ size = 15, className }: { size?: number; className?: string }) {
  return (
    <span className="relative inline-flex">
      <ShieldAlert size={size} className={className} />
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="absolute inset-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <path d="M3 3 L21 21" />
      </svg>
    </span>
  );
}

const ICONS: Record<MailActionId, IconComponent> = {
  archive: Archive,
  trash: Trash2,
  restore: RotateCcw,
  markRead: MailOpen,
  markUnread: Mail,
  star: Star,
  unstar: Star,
  markJunk: ShieldAlert,
  notJunk: NotJunkIcon,
  deleteForever: Trash2,
};

type Props = {
  actions: ActionDescriptor[];
  labelItems: MenuItemSpec[];
  /** Hidden where labelling makes no sense (Junk). */
  showLabels: boolean;
  labelsDisabled: boolean;
  ids: ID[];
  perform: Perform;
};

/** Toolbar rendering of the shared actions. */
export function ActionBar({
  actions,
  labelItems,
  showLabels,
  labelsDisabled,
  ids,
  perform,
}: Props) {
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
            <Icon
              size={15}
              className={
                a.id === 'unstar'
                  ? 'fill-star text-star'
                  : a.destructive
                    ? 'text-danger'
                    : undefined
              }
            />
          </Button>
        );
      })}
      {showLabels && (
        <DropdownMenu
          items={labelItems}
          trigger={
            <Button aria-label="Labels" title="Labels (apply or remove)" disabled={labelsDisabled}>
              <Tag size={15} />
            </Button>
          }
        />
      )}
    </div>
  );
}
