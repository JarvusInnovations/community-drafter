# Plans

`specs/` says what should be true. `plans/` says how we are getting there next: one file per bounded chunk of work, with `depends:`, the `specs:` it implements, and a validation checklist that flips it to `done`. Together they form the work DAG.

The protocol (frontmatter, body template, status lifecycle, closeout commit, follow-ups taxonomy) is `.agents/skills/specops/references/plans-protocol.md`. Query the DAG with `.agents/skills/specops/scripts/specops next` and `… dag`; this README deliberately keeps no hand-drawn status table.

No plans exist yet: the initial spec batch is in design on the draft planning PR. When the batch is accepted, a set of plans is proposed here and the PR merges with them.
