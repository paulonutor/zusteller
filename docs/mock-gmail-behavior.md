# Gmail-like mock behaviour

The mock mail service can imitate the parts of the Gmail API that shape the UI. Use it to
prototype loading, error and rate-limit states without a Google account. Code:
`src/infrastructure/mail/mock/gmailBehavior.ts`, wired into `MockMailService.ts`.

## When it is on

| Context                                           | Behaviour                         |
| ------------------------------------------------- | --------------------------------- |
| Browser/app session (`npm run dev`, `tauri:mock`) | Gmail-like (default)              |
| `?gmail=0`                                        | Plain mock                        |
| Any explicit `?latency=N` (tests, screenshots)    | Plain mock                        |
| `?gmail=1`                                        | Gmail-like, even with `?latency=` |
| `new MockMailService(seed)` (unit tests)          | Plain mock                        |
| `new MockMailService(seed, { gmail: true })`      | Gmail-like                        |

Scripts and Playwright specs pass `?latency=0`, so they stay deterministic. Plain mode keeps
`latency`, `failNext()` and `setOffline()` exactly as before.

## What is simulated

- **Latency.** Per call, with seeded jitter: accounts/labels 60-160 ms, counts 150-400 ms,
  thread list 180-450 ms, thread summary 90-260 ms, thread read 120-380 ms, mutations 150-450 ms.
- **Quota.** A token bucket of 250 units/s (burst one second). Costs follow Gmail's usage table:
  profile and label calls 1, thread list/get/modify 10, thread delete 20, counts 1 per label,
  mutations per thread. When empty the call throws `MailServiceError('rate_limit')` with
  `retryAfter` in seconds (minimum 1). Selecting and archiving 30+ threads at once trips it.
- **Transient errors.** 0.5% of calls throw `MailServiceError('offline', ...)`, which is how the
  real service maps Google 5xx. Retrying normally succeeds.
- **Limits.** Pages hold at most 500 rows (plain mock: 200). Mutations accept at most 1000 thread
  ids, otherwise `invalid`.
- **List stubs.** `getThreads` returns rows with `metadataPending: true`: id, labels, read/starred
  flags, snippet and date, but no subject, participants or message count. The UI fills them through
  `getThreadSummary` (only present in this mode), as it does with the real service.
- **Search.** Whole-word matching (`inv` does not find "invoice"), `"quoted phrases"`, `-negation`,
  and the operators `from:` `to:` `cc:` `subject:` `label:` `in:` `is:unread|read|starred`
  `has:attachment` `filename:`. Terms are ANDed. There is no `OR` or parenthesis support.
- **Index lag.** Mail delivered with `simulateIncoming()` is in the inbox immediately but not
  searchable for 4 s.

Not simulated: expired tokens, history/sync, partial batch failure, real quota windows over a
minute, label limits, message-level operations.

## Tuning

`gmail` accepts options (all optional):

```ts
new MockMailService(seed, {
  gmail: {
    quotaUnitsPerSecond: 250,
    quotaBurst: 250,
    backendErrorRate: 0.005,
    searchIndexLagMs: 4000,
    latency: 0, // fixed ms instead of the per-call profile
    now: () => fakeTime, // injectable clock
  },
});
```

The PRNG seed is `options.seed` (default 1), so failures and jitter repeat run to run. Set
`backendErrorRate: 0` when a test must not see random 503s.

## Recipes

- Hit the rate-limit UI: `new MockMailService(seed, { gmail: { quotaUnitsPerSecond: 20, latency: 0 } })`,
  then select many rows and archive.
- See stub rows and loading placeholders: open the app with no params and scroll.
- Test search lag: call `simulateIncoming('Subject')`, search for it, advance the injected `now`.
- Force a specific failure regardless of mode: `failNext('getThread')`, `setOffline(true)`.
- Deterministic tests of Gmail-only behaviour: see `gmailBehavior.test.ts`.

The mock still follows its own thread rules (`domain/mail/semantics.ts`); this mode is not a claim
about Gmail's exact quotas or error text. Check `docs/gmail-preview.md` for the real read-only path.
