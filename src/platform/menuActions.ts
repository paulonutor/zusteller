/**
 * Host-neutral native-menu actions. The Tauri adapter delivers menu item ids ('mail.archive');
 * the table below translates them into the vocabulary the UI understands.
 * 'star' and 'junk' are toggles (the UI picks star/unstar and markJunk/notJunk like the `S` and `!` shortcuts do).
 */
export type MenuAction = 'archive' | 'trash' | 'markRead' | 'markUnread' | 'star' | 'junk' | 'find';

const TAURI_ITEMS: Readonly<Record<string, MenuAction>> = {
  'mail.archive': 'archive',
  'mail.trash': 'trash',
  'mail.markRead': 'markRead',
  'mail.markUnread': 'markUnread',
  'mail.star': 'star',
  'mail.junk': 'junk',
  'mail.find': 'find',
};

/** Tauri menu item ids ("mail.archive"); unknown ids are dropped. */
export function fromTauriItemId(id: string): MenuAction | undefined {
  return Object.hasOwn(TAURI_ITEMS, id) ? TAURI_ITEMS[id] : undefined;
}
