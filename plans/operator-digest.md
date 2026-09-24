---
status: done
depends: []
specs:
  - specs/api/admin-cli.md
  - specs/api/admin.md
  - specs/behaviors/notifications.md
  - specs/data-model.md
  - specs/screens/admin-dashboard.md
issues: [74]
pr: 105
---

# Plan: operator-digest

## Scope

Issue #74, from the 2026-09-20 simulated run: a document's own operators get no mail about
their document — four signatures, an opt-out and two participant actions produced nothing
but a dashboard they had to remember to open — and a person's first visit is invisible
because opens are tracked as a write-behind field and never appear as an event.

In:

1. **Opens as events.** The batched `Action: track` commit becomes per document and names
   the people whose *first* open it recorded (`Opened` trailer); the activity feed expands
   that into one `opened` entry per person and drops `track` commits that recorded no first
   open. Still no per-open commit — opens stay write-behind.
2. **An operator digest**, once a day at the instance digest hour, per open document, to
   that document's active operators, reporting the last 24 hours and sending nothing on a
   quiet day. Plus **first-signature** and **first-comment** notices, once each per
   document, the moment they happen.
3. Every one of those messages names the document and links to its dashboard on the
   **document's** site host, with the From/Reply-To/tag of `behaviors/sites.md` § Mail.
4. `notifications list` and the dashboard's notification-health card say when the last
   operator digest went out.

Out: site-operator mail (a site's group is who *may* run a document, not who runs this
one), per-operator digest preferences, and any change to the participant digest.

## Implements

- `specs/behaviors/notifications.md` — the three new catalogue rows, § Operator digest, and
  the § Operator mail rules widened to cover them.
- `specs/data-model.md` — the `Opened` trailer; `documents.operator_notified`.
- `specs/screens/admin-dashboard.md` — `opened` entries in recent activity; the last-digest
  line in notification health.
- `specs/api/admin.md` — `action: "opened"` activity entries; `operator_digest_sent` on the
  notifications endpoint.
- `specs/api/admin-cli.md` — `notifications list` prints the last operator digest.

## Approach

1. `Opened` joins the shared trailer set and `CommitInput`; `OpenTracker.flush` groups its
   pending batch by document and commits one `track` per document, naming first opens from
   the read model (its sole writer) in `Opened`.
2. `documents.operator_notified` is an optional `event → value` table in the Zod schema and
   `.gitsheets/documents.toml`, so every record written before it existed still validates.
3. The read model expands a `track` commit's `Opened` into per-person `opened` activity
   entries and hides the ones naming nobody; `listActivitySince` serves the digest's window
   from the same in-memory log.
4. `notifications/operator-mail.ts` grows a site-resolved send (the schedulers have no
   request to read a site from) and `notifications/operator-digest.ts` collects a window's
   facts — invitations and first opens from the participation records, everything else from
   the log — renders them and records `operator_notified` in one `Action: send` commit after
   at least one delivery.
5. The existing `DigestScheduler` tick runs the operator digest alongside the participant
   one; the bus's `sign`/`submit` events drive the two first-response notices.
6. `GET .../notifications` returns `operator_digest_sent`; the CLI and the dashboard card
   print it.

## Validation

- [x] A first open shows up in the document's activity as an `opened` entry naming the
      person; a second visit by the same person adds no entry.
- [x] A busy day's digest names invitations delivered, first opens, reviews, signatures
      added and removed, declines and deadline moves, each with its count.
- [x] A quiet day sends nothing and records nothing.
- [x] The first signature produces exactly one notice; a second signature produces none.
- [x] A delivery failure is logged and does not throw, and does not enter the dispatcher's
      participation failure list.
- [x] Each message is sent with the document's site's From line, Reply-To and tag, and
      links to that site's host.
- [x] No operator message carries an email address, comment text or a token.
- [x] `notifications list` and the dashboard show the last operator digest date.
- [x] Gates in every touched package: lint, format:check, typecheck, test (api 241, web
      105, cli 51, shared 35); web build 106.69 KB gzip of a 120 KB budget; CLI bundle
      rebuilt and the drift gate clean.

## Risks / unknowns

- The tracker decides "is this a first open" from the read model rather than from inside
  the transaction, so the `Opened` trailer could over-claim if anything else ever wrote
  `first_opened_at`. Nothing else does, and the transaction still refuses to overwrite a
  value that is already set.
- One `track` commit per document per flush instead of one per flush: more commits on an
  instance running several busy documents, still bounded by the flush interval.

## Notes

- **`Opened` rather than a per-person `Person` trailer.** A `track` flush covers many
  people at once, and the commit wrapper's trailers are single-valued, so the first opens
  ride as one comma-separated list — the same shape the deadline trailer already uses.
  Grouping the flush by document is what lets those opens reach a document's feed at all.
- **The tracker asks the read model whether an open is a first one**, because the trailer
  has to exist before the transaction opens. It is the only writer of `first_opened_at`,
  and the transaction still refuses to overwrite one that is set, so the trailer cannot
  outlive the fact.
- **The digest window mixes two sources on purpose**: `sent_at` and `first_opened_at` are
  written only on the event they name, so the records answer "invitations delivered" and
  "first opens" directly; everything else exists only in the history and is read from
  `git log`. Written down in the spec so the next reader does not "fix" the inconsistency.
- **The recipients are the document's operators, not the site's group.** A site with
  thirty documents would otherwise mail every one of its operators thirty times a day.
- Two existing expectations moved: a signature now also produces the operators' notice,
  which is one more message and one more commit.
- Rebased twice — the second time onto the `@community-drafter/*` → `@signatories/*`
  rename (PR #104), which also moved the skill to `skills/signatories-axi/`.

## Follow-ups

- **Versions published are not in the digest.** A publish is something that happened on
  the document, but the operator who published it already knows, and the spec's list came
  from what the sim operators said they were missing. If a second operator ever reports
  missing a colleague's publish, that is the line to add. *Tracked as: none — raise an
  issue if it comes up.*
- **No per-operator digest preference.** Operator mail is deliberately not
  preference-gated; if a digest ever becomes unwanted, the honest lever is removing
  yourself from the document, not a toggle. *Deferred: revisit only with a real report.*
