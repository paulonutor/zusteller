/**
 * Thread semantics used by the mock provider. These are deliberate, tested
 * choices for V1 — NOT a description of universal Gmail behaviour.
 *
 *  - A thread is "unread" if ANY message is unread; markRead applies to all.
 *  - A thread is "starred" if ANY message is starred; setStarred applies to all.
 *  - A thread's labels are the union of its messages' labels.
 *  - Junk (system label SPAM, like Gmail's Spam): a thread with SPAM and not TRASH.
 *  - Inbox:   has INBOX label, not TRASH and not SPAM.
 *  - Sent:    any message has SENT, not TRASH and not SPAM.
 *  - Starred: starred, not TRASH and not SPAM.
 *  - All:     everything except TRASH and SPAM.
 *  - User label view: has the label, not TRASH and not SPAM.
 *  - Unread counts follow the same membership; a Junk thread counts only towards Junk.
 *  - archive: removes INBOX from every message.
 *  - trash:   adds TRASH, removes INBOX and SPAM on every message (Junk -> Trash leaves Junk).
 *  - restore: "Move to Inbox": removes TRASH and SPAM and (re)adds INBOX. Original placement is not remembered.
 *  - markJunk: adds SPAM, removes INBOX and TRASH. Other labels are kept.
 *  - notJunk:  removes SPAM and adds INBOX (a thread that was never in Junk is left unchanged).
 *  - Remote images are never loaded automatically for a Junk thread (UI rule, see Reader);
 *    the user can load them for one message at a time.
 */
export const THREAD_SEMANTICS_VERSION = 2;
