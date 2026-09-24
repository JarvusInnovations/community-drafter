# Plans

`specs/` says what should be true. `plans/` says how we are getting there next: one file per bounded chunk of work, with `depends:`, the `specs:` it implements, and a validation checklist that flips it to `done`. Together they form the work DAG.

The protocol (frontmatter, body template, status lifecycle, closeout commit, follow-ups taxonomy) is `.agents/skills/specops/references/plans-protocol.md`. Query the DAG with `.agents/skills/specops/scripts/specops next` and `… dag`; this README deliberately keeps no hand-drawn status table.

The initial plan set (authored 2026-09-19) partitions the first release into eleven plans; `deploy`, `participant-sign-flow`, `admin-cli` and `notifications` together make the first live document possible, and `comment-mode` can land during its comment period. The second batch (authored 2026-09-19 after the first deploy) replaces the interim admin auth with operators: `operators-auth` (API) then `operators-cli-and-dashboard` (CLI and web). Phase-2 work (public participation via magic links, SMS) gets its own plans when scheduled.
