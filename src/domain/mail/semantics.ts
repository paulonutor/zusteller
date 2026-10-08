/**
 * Thread semantics used by the mock provider. These are deliberate, tested
 * choices for V1 — NOT a description of universal Gmail behaviour.
 *
 *  - A thread is "unread" if ANY message is unread; markRead applies to all.
 *  - A thread is "starred" if ANY message is starred; setStarred applies to all.
 *  - A thread's labels are the union of its messages' labels.
 *  - Inbox:   has INBOX label and not TRASH.
 *  - Sent:    any message has SENT and not TRASH.
 *  - Starred: starred and not TRASH.
 *  - All:     everything except TRASH.
 *  - User label view: has the label and not TRASH.
 *  - archive: removes INBOX from every message.
 *  - trash:   adds TRASH and removes INBOX on every message.
 *  - restore: removes TRASH and (re)adds INBOX. Original placement is not remembered.
 */
export const THREAD_SEMANTICS_VERSION = 1;
