import type { ID, Label, SystemMailbox } from './types';

/**
 * System labels are modelled as label ids on messages (as Gmail does) but are
 * always distinguished from user labels by `Label.type` and by these helpers.
 */
export const SYSTEM_LABEL = { inbox: 'INBOX', sent: 'SENT', trash: 'TRASH', junk: 'SPAM' } as const;
const SYSTEM_IDS = new Set<string>(Object.values(SYSTEM_LABEL));

export const isSystemLabelId = (id: ID): boolean => SYSTEM_IDS.has(id);

export const MAILBOXES: { id: SystemMailbox; name: string }[] = [
  { id: 'inbox', name: 'Inbox' },
  { id: 'starred', name: 'Starred' },
  { id: 'sent', name: 'Sent' },
  { id: 'junk', name: 'Junk' },
  { id: 'trash', name: 'Trash' },
  { id: 'all', name: 'All Mail' },
];

export const userLabels = (labels: Label[]): Label[] => labels.filter((l) => l.type === 'user');
