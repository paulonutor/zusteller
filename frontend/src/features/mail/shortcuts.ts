import { useEffect } from 'react';
import type { MailActionId } from './actions';

/** Map a keydown to an action, or null. Kept pure for testing. Plain keys only: no ⌘ combos that macOS owns. */
export function actionForKey(
  e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>,
): MailActionId | 'toggleStar' | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case 'e':
      return 'archive';
    case '#':
    case 'Backspace':
    case 'Delete':
      return 'trash';
    case 'Z':
      return 'restore';
    case 'I':
      return 'markRead';
    case 'U':
      return 'markUnread';
    case 's':
      return 'toggleStar';
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
      if (document.querySelector('[role="menu"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        onSearch();
        return;
      }
      const a = actionForKey(e);
      if (a) {
        e.preventDefault();
        onAction(a);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAction, onSearch]);
}
