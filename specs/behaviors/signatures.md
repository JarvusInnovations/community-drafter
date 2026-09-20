# Behavior: Signatures

## Rule

A signature is a person's name added to a specific document, in a stated capacity, reversible until the signing phase closes and permanent after. The public signatory list and counts reflect exactly the current signatures and nothing else.

## Applies To

`screens/document.md` (the sign card, signatory list), `screens/public-and-embed.md`, `screens/admin-dashboard.md`, the participant and public APIs, notifications.

## Capacity

| Capacity | Required fields | Display |
| --- | --- | --- |
| **personal** | `display_name`; optional `descriptor` (≤ 120 chars) | "Jane Doe, former Academy educator" or "Jane Doe" |
| **official** | `display_name`, `org`, `title` (title may be blank), `authorized = true` | "Skype a Scientist — Jane Doe, Executive Director" |

- The document's `capacities` setting controls which options the sign card offers; when only one is allowed the choice is not shown.
- The sign card preselects from the invitation's `suggested_capacity`, else `personal`. Fields prefill from the `people` record (`name`, `org`, `role`, `descriptor`); the participant may edit any of them for this signature. Edits do not change the `people` record.
- Official capacity shows the attestation as a required checkbox with the text: "I am authorized to sign this on behalf of *Org*." The server rejects an official signature without it.
- The descriptor for personal capacity is introduced as "How would you like to be described? (optional)" with a hint such as "your neighborhood, profession, or connection to the Academy". It is free text; the copy discourages job titles at organizations the person is not signing for, and the render never places it in the organizations section.
- **One signature per person per document.** A person who wants to sign for their organization and also as a resident picks one; changing capacity replaces the signature. (Decided 2026-09-19: simplicity of the card and of the counts wins over the rare dual case.)

## Signing

- Available in the commenting and signing phases. Signing writes the `signature` table on the participation (`Action: sign` commit, `Version` trailer = version seen), replaces a `decline` judgement, and triggers the confirmation. One commit.
- Signing during the comment period is encouraged by the card copy: "Sign now. We'll email you when the final version is published, and you can remove your name any time until *Sep 30*." The date is `signing_closes_at`, updated live if extended.
- Re-signing after revocation is an `Action: resign` commit setting `revoked = false`; the dates of signing, revoking and re-signing are those commits' dates. The re-signature is a new signature: everywhere a signature's time is shown to its signer or to the team, it is the time of the commit that put the signature currently in force — the `resign` commit, not the superseded `sign` one.
- A signer who submits with `sign` or "keep" while a newer version exists produces a `submit` commit with the newer `Version` trailer and moves the signature onto that version (§ A signature belongs to a version).
- Signing through comment mode is the same signature by another door. A `submit` commit that writes, re-instates or revokes the `signature` table carries a `Signature` trailer (`sign` | `resign` | `revoke`) and is read back as that signature event, so a signature made with comments has the same dates and the same audit trail as one made from the sign card.

## A signature belongs to a version

- Every signature carries the version its signer saw: `signature.signed_on_version`, the same number as the `Version` trailer of the commit that wrote it.
- The number advances only when the signer says so again — **re-affirming** the signature against the newer text by pressing "Keep my name" or "Confirm my signature", or by submitting with `sign` or "keep" from comment mode. Each re-affirmation is a `sign` commit whose `Version` trailer is the version re-affirmed. Editing how a signature is listed, an operator's action, and the publication of a new version all leave it where it is: only the signer can move their name onto a version.
- A signature whose version is lower than the document's current version is **behind**. Being behind is a fact about the signature, not a state of it: it stands, it is counted, and it is displayed publicly exactly as any other (§ Principles — public display is uniform).
- On a record written before the field existed the number is not stored. It is read back from the `Version` trailer of the commit behind the signature in force; nothing rewrites those records to add it.
- Both sides are told, because the product's promise is that a named signatory read what they signed. The signer's own card names the version they signed and says plainly when the text has changed since (`screens/document.md` § Display Rules 3); the team sees the version on every signature, a marker on the ones that are behind, and a count of them (`screens/admin-dashboard.md`).

## Conditional signatures

- `signature.conditional = true` is set by the `sign_conditional` judgement or "make my signature conditional", and cleared by a later `sign`/"keep" judgement or by the signer pressing "Confirm my signature" on the final version.
- Public display is identical to an unconditional signature.
- When a `final` version is published, conditional signers receive a message showing their comments' dispositions and two buttons: confirm or remove. Unconfirmed conditional signatures **remain signatures** through closing; the team's dashboard lists them for outreach.

## Revocation

- "Remove my name" is available on every participant page while signed, in the commenting and signing phases. It asks for confirmation and an optional reason (private to the team), then commits `Action: revoke` with the `Reason` trailer, setting `signature.revoked = true`, and sends a confirmation email.
- Revocation removes the person from public lists and counts immediately. The signature table stays on the record with `revoked = true`; the history shows the sign and revoke commits to admins.
- After `signing_closes_at`, the button is gone and the page says the signatory list is final; a person who wants their name removed after that contacts the team, and an admin may revoke through the admin API with a recorded reason. Post-close admin revocations are shown as a footnote on every signatory list and count ("1 signature removed after closing at the signer's request"), so a count that changed after the clock stays truthful.

## Display

- **Signatory list order**: organizations (official capacity) first, alphabetically by `org`; then individuals chronologically by `signed_at` (earliest first), because the list should show momentum and reward early signers.
- **Counts**: "Signed by *N* organizations and *N* individuals" where the organization count is distinct `org` values among official signatures and the individual count is personal signatures plus any official signers counted once as people only when the copy says "people". Never blend with supporter or petition counts.
- `listed = false` signers are counted but not named ("and 3 others who asked not to be listed"). They are counted **once**, in that clause alone: an unlisted signer is excluded from the organizations and the individuals figures, so the three numbers in a counts line never overlap.
- `display_approved = false` (**[phase 2]** public-source) signers are neither counted nor named until approved.
- `show_signatories = count` shows only the counts; `none` shows nothing to participants and the public, though the admin dashboard always shows all.
- Every participant page shows the participant's own status line prominently: "You signed version 2 on Sep 19 as Jane Doe (personal)" (the version is the one the signature is attached to; the date is that of the commit behind the signature in force — the `resign` commit after a removal and re-signature, else the `sign` commit) with the change/remove actions, or "You haven't signed yet".

## Principles

**Inherited**

- [Say exactly who signed](../principles.md#say-exactly-who-signed): the attestation, the capacity split, the count rules, and the ban on blending other counts.
- [Just sign it for now](../principles.md#just-sign-it-for-now): sign-during-drafting copy, revocation as a first-class button, the final-version alert.

**Local**

- **Public display is uniform.** Conditional, reaffirmed, or early signatures look identical in public. Differences exist for the team, not the readers of the statement.
