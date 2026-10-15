# Test Gmail on your Mac

Zusteller's desktop app connects to one Gmail account using `gmail.readonly`.
Browser development uses the mock. All organization actions in the Gmail
preview are local simulations, including marking a conversation read when you
open it. Reset local changes restores Gmail's current state. Nothing is uploaded.

## Set up Google

1. Create a Google Cloud project and enable the **Gmail API** in APIs & Services.
2. In **Google Auth Platform**, configure Branding with an app name and your
   support/developer email addresses.
3. Set Audience to **External**, publishing status **Testing**, and add your
   Gmail address under Test users.
4. In Data Access, add only
   `https://www.googleapis.com/auth/gmail.readonly`.
5. In Clients, create an OAuth client of type **Desktop app**. Download its JSON
   file to a private folder outside the repository. A web client or service
   account JSON will not work.

External / Testing Gmail refresh tokens expire after seven days. Reconnect when
that happens. Google may show an unverified-app warning during personal testing;
verify the app name and project before granting access. Public distribution
requires separate scope-verification work.

Google's references: [Desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app),
[consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent),
[token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Run and connect

From the repository root:

```sh
npm ci
npm run tauri dev
```

The desktop app shows **Connect Gmail**. Click it, choose the downloaded client
JSON, and complete sign-in in your system browser. Return to Zusteller after the
browser confirms that sign-in was received. The callback times out after three
minutes; Cancel sign-in stops it sooner.

For a standalone app:

```sh
npm run tauri build -- --debug --bundles app
```

Open the `zusteller.app` path printed by the build. Cargo's configured target
directory can differ from `src-tauri/target`. Browser-only `npm run dev` keeps
using deterministic mock mail. `?provider=mock` explicitly selects mock mail in
the desktop host for visual tests. `npm run tauri:mock` starts the desktop app
with mock mail (it overrides the window URL via `src-tauri/tauri.mock.conf.json`).

## What to try

- Browse Inbox, Sent, Starred, All, Junk and Trash; open a user label.
- Search using Gmail syntax such as `from:someone@example.com` or `has:attachment`.
- Scroll to fetch older pages. Open plain and HTML messages and multi-message
  conversations. Click an attachment filename to open it in the system default
  app without a Save dialog. The separate download icon offers native Save As.
  Both actions fetch on demand and are limited to 15 MiB. Opened files use private
  temporary directories retained for the app session and removed on normal exit.
  macOS quarantine checks apply to opened files.
- Star, mark unread, archive and move a message locally. Compare with Gmail in
  your browser: Gmail should be unchanged. Restart Zusteller and verify your
  local actions remain. **Reset local changes** removes those simulations.
- Make a read/star/label change in Gmail and use **Refresh Gmail**, or wait for
  polling. Metadata changes invalidate previously cached bodies so the next open
  fetches the updated conversation.
- Disconnect networking. Previously loaded pages and opened bodies remain
  readable; uncached data reports an error. Reconnect and refresh.
- **Disconnect** removes the local account, cache, simulations and Keychain
  credential. It does not revoke Google's project-wide grant. To revoke that
  grant yourself, use your Google Account's third-party connections page; that
  can affect other clients using the same Google Cloud project.

## Inspect Gmail activity

Click **Gmail activity** in the sidebar, or choose **Window → Gmail Activity**,
to open a separate, resizable window. Opening it again brings the same window
forward. Connection status, last sync/retry times, Refresh Gmail, Reset local
changes, Reconnect and Disconnect live here alongside the request log.
The mail reader has no bottom connection bar or embedded log.
The log refreshes every two seconds while open, including while sync is running.
Use **Copy log** to copy the session totals and retained events for troubleshooting.
Close the window with **Close**, Escape, the native close button or Command-W.
Closing/reopening the window keeps the current session log. The main app owns
the connection and its sync loop; this window only observes status and routes
actions back to it. Opening the window starts no extra Gmail polling.

The panel shows request counts, estimated quota units, cache reuse, sync events,
HTTP status, timing and quota pacing, Google's recognized rate-limit reason,
and retry delays. Requests suppressed during cooldown use zero quota units.
It retains the last 200 events in memory; totals cover the current app session.
Restarting the app clears both. Inspecting diagnostics makes no Gmail API calls.
No account addresses, message/thread IDs, search queries, message content,
attachment filenames, request/response bodies or credentials are recorded.

## Data and limits

OAuth uses the system browser, PKCE S256, a random checked state and a temporary
`127.0.0.1` listener. Client configuration and refresh tokens live together in an
account-specific macOS Keychain entry. Access tokens live only in Rust memory.
Neither token kind is returned to React or stored in SQLite or logs.

SQLite lives under Tauri's app data directory at `gmail/cache.sqlite`. The
parent directory is mode 0700 and the file is 0600. Cache content relies on OS
permissions and FileVault, rather than application encryption. Requested ID lists
and opened conversations are limited to 32 MiB or 2,000 entries per account, and
evicted after 30 days during reads/sync. Unopened row metadata stays only in memory,
bounded to 2,000 conversations. Local simulations are separate and survive cache
eviction; they retain a small metadata snapshot to preserve local moves after
restart. Older versions' cached metadata remains reusable until history marks it
changed. This is not a full offline mirror.

Opening a mailbox, label or search drains every `threads.list` page at 500 IDs per
request, deduplicates IDs and preserves Google's order. It fetches no thread
metadata during this pass. Rows load metadata only when they are within 200 px of the
list viewport, including in short lists. Virtualizer overscan and offscreen selected
rows do not trigger reads. Queued reads are cancelled when rows leave the viewport.
Sender, subject, date and flags require this separate read because Google's
[list endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/list)
omits messages. Bodies and inline images load only when a conversation is opened.
Unchanged opened conversations reuse SQLite; unchanged row metadata reuses memory.
Only one row-metadata batch runs at a time, including while scrolling. Batches are
background work: they wait for quota without holding the Gmail worker, so opening a
conversation is not queued behind them. A rate-limit
response leaves visible rows and the selected reader waiting until Retry-After,
then retries automatically. Leaving the viewport cancels a row's retry. Opening
a conversation resolves its pending row and cancels redundant metadata work.
During an offline or rate-limit failure, a previously completed ID list and opened
conversations remain available. A partially fetched list never replaces a complete
cached list. Client-side Unread/Starred filters resolve pending rows as they enter
the viewport, so their counts cover metadata loaded so far.

The initial sync captures only a profile history ID. Later sync reads all history
pages and atomically marks changed metadata stale and removes changed bodies.
It never downloads replacement messages, including for previously unknown IDs.
An expired history cursor captures a fresh baseline and invalidates cached mail;
its replacement loads on demand. Partial failures never advance the cursor.
Deleting a message does not erase local overrides for its whole conversation.
Disconnecting or replacing the connection cancels any uncommitted sync pass.

Polling targets three seconds while active and fifteen seconds when inactive,
with immediate checks on focus, reconnect and manual refresh outside a retry
cooldown. Failures back off up to five minutes and honor Retry-After, including
HTTP dates. Focus and manual refresh preserve the retry deadline. Native requests
share an 80-quota-unit/second budget with a 400-unit burst, below the current
6,000-unit/user/minute default for new Google projects. Rate-limit responses pause
all Gmail reads for at least sixty seconds, or longer when Retry-After requires
it; cached mail and known local actions remain available. See Google's
[quota reference](https://developers.google.com/workspace/gmail/api/reference/quota).
Opening mail, loading mailbox/search lists, attachments and local actions take
priority over background sync. Sync releases the native worker between history
requests and during quota waits, and leaves 80 quota units available for interactive
reads. A request already in flight must finish before the worker can switch to a
user action. Sustained interaction can delay background sync.
Diagnostics records `sync waiting_for_quota` when background pacing begins.
The Gmail Activity window reports sync errors and the last successful sync.

Visible row metadata uses Gmail multipart batches of up to four calls. Label-count
reads use batches of up to fifty. One remaining read is sent normally. The endpoint
is `/batch` on Gmail's API host, as specified by its
[discovery document](https://gmail.googleapis.com/$discovery/rest?version=v1).

| Read work                               | HTTP requests | Quota units |
| --------------------------------------- | ------------: | ----------: |
| Initial sync baseline                   |             1 |           1 |
| Sync with one history page              |             1 |           2 |
| Complete list of 1,000 thread IDs       |             2 |          20 |
| Metadata for 12 uncached visible rows   |             3 |         480 |
| Counts for 30 already-listed labels     |             1 |          30 |
| Reopen an unchanged cached conversation |             0 |           0 |

These are successful reads without authentication retries or attachment downloads.
The previous 100-thread bootstrap spent 4,011 quota units; the baseline now spends
one. The reduction comes from removing eager reads, rather than batching alone.
Batching reduces HTTP overhead, not quota use. Every inner call spends its normal
quota cost and has its own diagnostic entry; `batch sent` records the grouped
call count. Responses are correlated by Content-ID. Missing, duplicate or invalid
parts fail the request. Inner and outer rate limits share the existing cooldown;
expired-token parts are retried once without replaying successful reads. See
Google's [batching guide](https://developers.google.com/workspace/gmail/api/guides/batch).

Unread counts show `~` because Gmail label counts and the preview's thread
membership rules can differ. Local actions adjust those estimates using known
thread metadata. Search evaluates Gmail's server state; local simulations then
filter the returned rows. A locally moved conversation can be added to an
unsearched destination mailbox from cached metadata. Search does not index local
simulations. All ID pages load before metadata; duplicate IDs from concurrent changes are
removed. Local moves are applied before rows reach the UI.

Bodies are decoded from Gmail's base64url MIME parts with their declared charset.
Encoded headers and address groups are parsed, and small raster CID images are
resolved within a 1 MiB budget per message. Larger CID images remain unavailable.
The existing DOMPurify/CSP/script-disabled iframe path remains mandatory. List
metadata requests omit body data and inspect up to twelve nested MIME levels.

## Automated verification without a Gmail account

`npm test` covers the shared reader, account connection controls, local action
routing, polling/backoff and page deduplication. `cargo test --manifest-path
src-tauri/Cargo.toml` exercises native local HTTP fixtures and a Tauri mock runtime.
It covers PKCE, the actual loopback callback socket, cancellation/timeout, refresh
and revocation errors, MIME decoding, read/search/page/download requests, offline
cache fallback, history recovery/transactions and the frontend command payloads.
It also checks foreground priority, reserved quota, cached reads/local actions
between sync steps, cancellation before cursor commit, and atomic history invalidation.
Lazy-loading tests cover viewport-only metadata, unopened bodies, stale query data,
complete list pagination and reuse of unchanged opened mail after restart.
Batch fixtures check encoded nested GETs, response correlation, malformed parts,
inner/outer rate limits, per-call quota totals and cache fallback on partial failure.
The native CI jobs run these tests without real credentials or desktop interaction.

With `npm run dev` running, `node scripts/gmail-preview-check.mjs` drives a
synthetic desktop-provider UI in Chromium, checks connect/read/save/reset/disconnect
and activity window copy/close/reopen in light/dark at regular and compact sizes,
runs axe and writes screenshots under `/tmp/zusteller-gmail-preview`.
`node scripts/gmail-lazy-check.mjs` checks 40-row and 1,500-row lists, viewport-only
metadata, unopened bodies and cache reuse across label navigation and reopening in
light/dark at regular and compact sizes. Screenshots go to
`/tmp/zusteller-gmail-lazy`.
`npm run a11y` runs the existing broader reader audit. The synthetic check reports
known token contrast findings separately from failing structural findings.

These checks do not establish that Google's consent settings, a specific Desktop
OAuth client, real Keychain prompts or an actual Gmail account work. Those require
the live connection and restart checks above.

## Private testing

Quit Zusteller and launch the built app with `open -n /path/to/zusteller.app --args --privacy`.
For development, use `npm run tauri dev -- -- --privacy`. Connect the account in an
ordinary session first and allow any required Keychain access there. Privacy mode is fixed for the process lifetime; restart
without the argument to return to normal mail. Do not run an ordinary instance
alongside a privacy instance during screenshot or computer-use testing. Native
credential prompts are suppressed in privacy mode. If credentials cannot be read
or refreshed, reconnect in an ordinary session before testing again.

The sidebar says **Privacy mode** and the native main and Activity window titles
identify the mode. Rust replaces account identities, contacts, subjects, snippets,
plain text, HTML, dates, attachment names and user labels before IPC. IDs and page
cursors use aliases stable for that launch. Unknown output fields, avatar URLs,
email links, images and inline attachment data are discarded. Diagnostics retain
only known Google error categories.

This uses the real list, lazy-load, sync and cache paths without additional Gmail
requests. Counts, read/star flags, message/attachment counts and attachment sizes
remain visible. All displayed dates are synthetic, so this mode cannot verify real
date formatting or email-specific HTML layouts. Search, OAuth sign-in, attachment
opening and downloads, disconnect and resetting local changes are blocked.
Organization actions still update the existing local preview overlays; they do not write Gmail.

Original data remains in the native cache and credentials remain in Keychain.
This is a protected UI for testing, not an anonymized database export. Synthetic
fixtures verify masking and IPC routing before any real-account inspection. Run
`node scripts/gmail-privacy-check.mjs` against the dev server for synthetic
light/dark and compact UI checks. Screenshots go to `/tmp/zusteller-gmail-privacy`.
