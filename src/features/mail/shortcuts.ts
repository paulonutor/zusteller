import { useEffect } from 'react';
import type { MailActionId } from './actions';

/** Map a keydown to an action, or null. Kept pure for testing. Plain keys only: no ⌘ combos that macOS owns. */
export function actionForKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>,
): MailActionId | 'toggleStar' | 'toggleJunk' | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  // Compare lowercase plus an explicit shiftKey: CapsLock changes `key` but not `shiftKey`.
  const key = e.key.toLowerCase();
  switch (key) {
    case 'e':
      return e.shiftKey ? null : 'archive';
    case '#':
    case 'backspace':
    case 'delete':
      return 'trash';
    case 'z':
      return e.shiftKey ? 'restore' : null;
    case 'i':
      return e.shiftKey ? 'markRead' : null;
    case 'u':
      return e.shiftKey ? 'markUnread' : null;
    case '!':
      // Gmail's key: Mark as Junk, or Not Junk while looking at Junk. Resolved in MailApp like `s`.
      return 'toggleJunk';
    case 's':
      return e.shiftKey ? null : 'toggleStar';
    default:
      return null;
  }
}

export const isEditableTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** Global (window-level) handler for shortcuts that are not list-navigation. */
export function useGlobalShortcuts(handlers: {
  onAction: (k: NonNullable<ReturnType<typeof actionForKey>>) => void;
  onSearch: () => void;
}) {
  const { onAction, onSearch } = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        onSearch();
        return;
      }
      if (isEditableTarget(e.target)) return;
      // Don't fire while a menu/dialog owns the keyboard.
      if (
        document.querySelector('[role="menu"]') ||
        document.documentElement.hasAttribute('data-native-menu-open')
      )
        return;
      if (e.key === '/') {
        e.preventDefault();
        onSearch();
        return;
      }
      const a = actionForKey(e);
      if (a) {
        e.preventDefault();
        // A held key must not repeat a (destructive or toggling) action.
        if (!e.repeat) onAction(a);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction, onSearch]);
}
