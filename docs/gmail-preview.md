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
the desktop host for visual tests.

## What to try

- Browse Inbox, Sent, Starred, All, Junk and Trash; open a user label.
- Search using Gmail syntax such as `from:someone@example.com` or `has:attachment`.
- Scroll to fetch older pages. Open plain and HTML messages and multi-message
  conversations. Use **Save** beside an attachment to download it through a
  native Save As dialog. Downloads are limited to 15 MiB.
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
permissions and FileVault, rather than application encryption. Recent metadata,
requested pages and opened bodies are limited to 32 MiB or 2,000 entries per
account, and evicted after 30 days during reads/sync. Local simulations are
separate and survive cache eviction. This is not a full offline mirror.

The initial sync covers 100 recent conversations. Older pages load on demand.
Polling targets three seconds while active and fifteen seconds when inactive,
with immediate checks on focus, reconnect and manual refresh outside a retry
cooldown. Failures back off up to five minutes and honor Retry-After, including
HTTP dates. Focus and manual refresh preserve the retry deadline. Native requests
share an 80-quota-unit/second budget with a 400-unit burst, below the current
6,000-unit/user/minute default for new Google projects. Rate-limit responses pause
all Gmail reads for at least sixty seconds, or longer when Retry-After requires
it; cached mail and local actions remain available. Large initial/history syncs
take longer because metadata reads are paced. List refreshes reuse metadata
maintained by history sync and fetch only missing summaries. See Google's
[quota reference](https://developers.google.com/workspace/gmail/api/reference/quota).
Opening mail, loading mailbox/search pages, attachments and local actions take
priority over background sync. Sync releases the native worker between page
requests or small metadata batches and during quota waits, and leaves 80 quota units available
for interactive reads. A request already in flight must finish before the worker
can switch to a user action. Sustained interaction can delay background sync.
Diagnostics records `sync waiting_for_quota` when background pacing begins.
The Gmail Activity window reports sync errors and the last successful sync. History
pagination is applied before its cursor is committed; expired history rebuilds
the recent window and revalidates
older cached conversations.
Disconnecting or replacing the connection cancels any uncommitted sync pass.

Independent thread-metadata reads use Gmail multipart batches of up to four
calls. Label-count reads use batches of up to fifty. One remaining read is sent
normally. The endpoint is `/batch` on Gmail's API host, as specified by its
[discovery document](https://gmail.googleapis.com/$discovery/rest?version=v1).
Small metadata batches keep sync able to yield and fit a full authentication
retry plus the interactive reserve in the 400-unit burst.

| Read work                           | HTTP requests before batching | HTTP requests now | Quota units |
| ----------------------------------- | ----------------------------: | ----------------: | ----------: |
| Initial sync of 100 threads         |                           102 |                27 |       4,011 |
| List page with 30 missing summaries |                            31 |                 9 |       1,210 |
| Counts for 30 already-listed labels |                            30 |                 1 |          30 |

Batching reduces HTTP overhead, not quota use. Every inner call spends its normal
quota cost and has its own diagnostic entry; `batch sent` records the grouped
call count. Responses are correlated by Content-ID. Missing, duplicate or invalid
parts fail the pass without committing its cursor. Inner and outer rate limits
share the existing cooldown; expired-token parts are retried once without
replaying successful reads. See Google's
[batching guide](https://developers.google.com/workspace/gmail/api/guides/batch).

Unread counts show `~` because Gmail label counts and the preview's thread
membership rules can differ. Local actions adjust those estimates using known
thread metadata. Search evaluates Gmail's server state; local simulations then
filter the returned rows. A locally moved conversation can be added to an
unsearched destination mailbox from cached metadata. Search does not index local
simulations. Results retain Gmail pagination, so concurrent changes and injected
local rows can produce duplicate IDs across pages; the UI deduplicates IDs.

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
between sync steps, and cancellation or metadata failure before cursor commit.
Batch fixtures check encoded nested GETs, response correlation, malformed parts,
inner/outer rate limits, per-call quota totals and cache fallback on partial failure.
The native CI jobs run these tests without real credentials or desktop interaction.

With `npm run dev` running, `node scripts/gmail-preview-check.mjs` drives a
synthetic desktop-provider UI in Chromium, checks connect/read/save/reset/disconnect
and activity window copy/close/reopen in light/dark at regular and compact sizes,
runs axe and writes screenshots under `/tmp/zusteller-gmail-preview`.
`npm run a11y` runs the existing broader reader audit. The synthetic check reports
known token contrast findings separately from failing structural findings.

These checks do not establish that Google's consent settings, a specific Desktop
OAuth client, real Keychain prompts or an actual Gmail account work. Those require
the live connection and restart checks above.
