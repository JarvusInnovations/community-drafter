# Principles

The project's philosophy, written down as principles. Each picks a side of a real trade-off so an implementer can resolve an unspecified case the way the authors would. Feature specs reference the ones that bite on them from their own `## Principles` sections.

## Sign first, everything else after

The default engagement is: open the link, see the document, sign your name. One screen, no account, no form before the signature. Every advanced capability (commenting, version history, preferences, conditional signing) sits *behind* the signature in the layout and the flow, never in front of it. When a design choice would add a step before the sign button to make some later feature cleaner, refuse it.

*Why:* the alternative is a Google Form or a petition page. If this tool is not at least as fast to sign as those, people defer, and deferred action is lost action. The comment-and-revise machinery is what makes the tool worth building, but it must cost the non-commenting majority nothing.

## Just sign it for now

During the comment period the interface actively encourages signing before the text is final, and promises what makes that safe: you will be told when the final version is published, and you can remove your name any time until the signing window closes. Copy, defaults and notifications all serve that promise. Anything that makes early signing feel risky or irreversible (a "final" label on a draft, a revocation path that is hard to find, a missing final-version alert) violates this.

*Why:* a document whose signature count grows during drafting has momentum; one that waits for the final text has a deadline nobody feels. Reversibility is what lets us ask for the early signature honestly — and the promise stops at the final text, because a signer who has already answered the countdown is served by silence about it rather than by a warning.

## The clock is real

Every deadline shown to a participant is enforced by the system at that instant, not by an administrator remembering to flip a switch. Administrators may extend a deadline, but an extension is a visible, recorded, announced event; there is no quiet late acceptance. A comment submitted after the comment period closes is rejected, even by one minute, even from a core member.

*Why:* a consent-window governance model (the pilot's coalition charter is one) works only if "silence is consent" is a fair claim. That claim requires a deadline that was what it said it was.

## The link is the identity

An invited person's personal link *is* their credential. We do not ask them to log in, confirm an email, or create an account before reading, signing or commenting. We accept that links can be forwarded, and mitigate it with a visible "signing as *Name*, not you?" affordance and a confirmation email for every signature and revocation, rather than by adding authentication friction. **[phase 2]** sign-in for people arriving by a public link is additive; it never becomes a requirement for invited people.

*Why:* every authentication step is a place where a supporter with two spare minutes gives up. The invited population is known and small; the cost of an occasional misattributed signature (correctable through the confirmation email) is far lower than the cost of friction for everyone.

## Say exactly who signed

"Signed by N organizations and N individuals" means exactly the current, unrevoked signatories, listed. An official-capacity signature requires the signer to attest that they are authorized to sign for the organization. A personal-capacity signature never displays as if it were the organization's, however the person describes themself. Counts of supporters, list members or petition signers are never blended into signatory counts.

*Why:* a coalition's credibility rests on being able to answer "who is 'we'?" precisely. Inflating or blurring the signatory list is the one failure the tool must make structurally impossible.

## Nothing pending is lost; pending is labeled

Input is never lost, at any layer. While a participant types, the text is buffered in the browser so a reload restores it. The moment they finish a comment (or a general note) it is saved to the server, and the server acknowledges only after the write is durable in the record; only then is the browser buffer cleared. Saved-but-unsubmitted comments are visible to the participant as a clearly labeled queue, and they are readable by the team, clearly labeled *unsubmitted*, so that a comment someone wrote and never got around to sending is still there to be read. Submitting with a judgement is the participant's signal that they are done, not the moment their words become real.

*Why:* this is the pull-request review model with one deliberate difference from GitHub: we would rather read a half-finished thought than lose it. The audience is volunteers on phones between other things; the failure we cannot afford is "I wrote all that and it vanished." Labeling, not hiding, is what keeps the queue honest for both sides.

*Rules out:* an in-memory-only save that acknowledges before the commit; autosave that overwrites a newer local edit with an older server copy; any admin or export view that presents an unsubmitted comment without its label.

## Versions are for normies

Participants see v1, v2, v3, each with a date and a one-line description of what changed, and a readable redline between any two. They never see a hash, a branch, a commit, or the word "git". Git is the storage engine and the audit trail; it is invisible plumbing to everyone but the team.

*Why:* the audience is scientists, teachers, neighbors and museum members. Version control concepts are a barrier; version *numbers* are universally understood.

## The record is a git repo the team can read without the app

Every durable fact is either a field on one of a handful of flat, semantically named records in a private git repository, or a commit in that repository's history with trailers carrying the structured facts. The tree names things; git holds time. Versions, submissions, signature dates, revocations, sends and activity are read from `git log`, never copied into tables that could drift from it. The team and its agents can query all of it with ordinary tools and `gitsheets-axi` when the web app is down or gone. The app is a view over the record, not the record's owner. A database that is the sole source of truth for any durable fact, or a record that encodes a moment or a status in its path, violates this.

*Why:* the pilot's charter promises "the press can ask how a statement was approved and get a real answer." A git history of who signed, revoked, commented and published, with timestamps, is that answer. It also means the adopting team's agents and people keep working with the tools they already use.

## One instance, many documents, no lobby

There is one deployment with a generic name. Each document is reached only by its own links. There is no public homepage, index, search or discovery of documents; the only shared surface is the team's administrative view. A participant can never learn of a document they were not sent.

*Why:* the tool is infrastructure for many campaigns and for documents at different levels of confidentiality. A lobby would leak the existence of drafts and would become a product surface to design and defend.

## Essentials always, everything else opt-in

Confirmation of a signature, a revocation, and the invitation itself are always sent. Everything else (each revision, digests, phase changes, reminders) is a preference, with role-based defaults that are minimal and stated plainly on the preferences page, and a working unsubscribe on every message.

*Why:* the people we most want to keep engaged are the ones most likely to be over-messaged by every other campaign. Being the one that respects their inbox is a feature.

## Comments never orphan silently

A comment records which version and which passage it was written against. When the text changes, the comment is re-attached where the passage moved to if it can be found, and otherwise shown alongside its quoted original text, marked as written on the earlier version. A comment is never dropped from view because the words it pointed at changed.

*Why:* the precedent system (proposal-renderer) anchored comments to *current* text only and lost them silently on edit. In a tool whose whole point is revising text in response to comments, that failure mode is disqualifying.

## Keyboard first, announce every state change

Every interactive control has a visible focus ring, every action moves focus somewhere sensible (the heading of the state it produced, the field it opened), and every result is announced in a live region. Nothing is reachable only by pointer, and a page has exactly one `h1`.

*Why:* the people a coalition most needs to sign are often the ones reading on a phone with a screen reader or tabbing through on a keyboard between meetings. A control that only works with a mouse, or an action whose result appears somewhere focus never goes, is a silent "no" from exactly those people — and they will not tell us.
