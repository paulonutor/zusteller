/**
 * Host-neutral native-menu actions. The Wails and Tauri adapters deliver
 * host-specific payloads (Wails: 'archive'; Tauri: 'mail.archive'); the tables
 * below translate both into one vocabulary the UI understands.
 * 'star' is a toggle (the UI picks star/unstar like the `S` shortcut does).
 */
export type MenuAction = 'archive' | 'trash' | 'markRead' | 'markUnread' | 'star' | 'find';

const ACTIONS: ReadonlySet<string> = new Set<MenuAction>([
  'archive',
  'trash',
  'markRead',
  'markUnread',
  'star',
  'find',
]);

/** Wails event payloads are already MenuAction ids; unknown values are dropped. */
export function fromWailsPayload(payload: string): MenuAction | undefined {
  return ACTIONS.has(payload) ? (payload as MenuAction) : undefined;
}

const TAURI_ITEMS: Readonly<Record<string, MenuAction>> = {
  'mail.archive': 'archive',
  'mail.trash': 'trash',
  'mail.markRead': 'markRead',
  'mail.markUnread': 'markUnread',
  'mail.star': 'star',
  'mail.find': 'find',
};

/** Tauri menu item ids ("mail.archive"); unknown ids are dropped. */
export function fromTauriItemId(id: string): MenuAction | undefined {
  return Object.hasOwn(TAURI_ITEMS, id) ? TAURI_ITEMS[id] : undefined;
}
