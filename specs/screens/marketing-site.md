# Screen: Marketing Site (GitHub Pages)

A static homepage for the platform, published from this repository to GitHub Pages. It tells a first-time visitor what Community Drafter is, walks through how a document runs with real screenshots, and points them at the repository and the admin skill. It is not part of the running instance and never links to any document.

## Route

`https://jarvusinnovations.github.io/community-drafter/` (and any custom domain later), built from `site/` by a workflow on pushes to `develop` that touch `site/**`.

## Data Requirements

None at runtime. Screenshots are static files under `site/img/`, captured from a demo document with fictional participants; none shows a personal-link token, an email address, or a real signer other than the project's own maintainers.

## Display Rules

Top to bottom, one page:

1. **Hero**: the name, a one-sentence definition ("Community drafting and signing of collective statements"), a two-line elaboration in plain words (open it, sign it; comments, versions and revocation behind that), and two calls to action: "See how it works" (anchor) and "View on GitHub".
2. **What it is**: three short cards: the participant's experience (one screen, no account), the team's experience (publish versions with a one-line changelog, answer comments in rounds), the record (every action is a commit in a private git repo).
3. **How it works**: numbered steps, each with a phone-width screenshot and two or three sentences: personal link and the sign card; sign now, remove later; inline comments and a submission with a position; versions with a changelog and a redline; the final list of signatories in personal or official capacity.
4. **Principles**: five one-line principles lifted from `specs/principles.md` (sign first; the clock is real; say exactly who signed; nothing pending is lost; the record is a git repo), each with its one-sentence why.
5. **For teams**: how to run one: install the admin skill, create, publish, open, invite, export feedback, publish again; a code block with the commands.
6. **Footer**: repository link, license, "built by Jarvus Innovations", and a note that the pilot deployment serves a civic coalition while the tool is generic.

Rules: works at phone width with no horizontal scroll; light scheme only, like the app; no external scripts and no third-party requests (the font is served from the site itself); images have alt text describing the state shown; no analytics.

## Design

The same design as the app (`document.md` § Design): the cool neutral page, white cards with a 1 px border and rounded corners, near-black ink and a muted ink, one accent blue for links, buttons and the step numbers, Inter served from `site/fonts/` with a system fallback. The hero is a plain band on the page background with a rule beneath it, not a tinted gradient. Buttons are the app's primary (blue, soft shadow) and quiet (bordered) styles. Screenshots sit in a phone frame in the ink color or a bordered card, with a soft shadow. Code blocks use the muted surface. Nothing on the page uses a warm or paper-toned color.

## Actions

Links only.

## Navigation

External entry; links out to GitHub. Nothing links back into a running instance.

## Principles

**Inherited**
- [One instance, many documents, no lobby](../principles.md#one-instance-many-documents-no-lobby): the site is the only public surface that describes the platform, and it describes it without pointing at any document.
- [Sign first, everything else after](../principles.md#sign-first-everything-else-after): the story the page tells leads with the one-screen sign flow, not with the comment machinery.
