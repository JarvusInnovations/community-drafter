---
status: planned
depends: []
specs:
  - specs/screens/document.md
  - specs/screens/comment-mode.md
  - specs/screens/admin-dashboard.md
---

# Plan: a11y-pass

## Scope

The participant accessibility findings from the keyboard-only and screen-reader-minded personas (#72), fixed together: visible focus everywhere, focus management and announcements after every action, names for every control, honest heading structure. Out: color contrast (measured fine everywhere, lowest 5.16:1) and the admin screens beyond the duplicate h1 on view-as.

## Implements

- `specs/screens/document.md` and `specs/screens/comment-mode.md` — add a `## Principles` local entry: "Keyboard first, announce every state change": every interactive control has a visible focus ring, every action moves focus somewhere sensible and announces its result in a live region, and nothing is reachable only by pointer.
- `specs/screens/admin-dashboard.md` — view-as has one h1.

## Approach

1. Capacity segmented control: a visible focus ring on the label when its sr-only radio has focus (`has-focus-visible:` or a focus-within ring), and the same for the judgement rows.
2. After Sign, Remove, Change how you're listed, Cancel, and comment submit: move focus to the resulting panel's heading and announce via an `aria-live="polite"` status region; the "You signed" panel gets a heading.
3. Composer textarea gets a label; the composer popup is `role="dialog"` with `aria-label`; Escape closes it.
4. Heading anchors: `aria-label` "Link to <heading text>"; keep headings exposed as headings after the anchor is prepended (the anchor must not swallow the heading's accessible name; check the a11y tree).
5. "Send comments" and "Sign" respond to Enter and Space (real `<button type="submit">` inside a form, or a key handler); post-signature actions are at least 32 px tall targets on phones with 8 px spacing.
6. DOM order on phones: the panel first is by design (Sign first); on desktop, put a "Skip to document" link at the top of the panel so keyboard users are not forced through the form.
7. One h1 on view-as; the header status pill is a `status` region.

## Validation

- [ ] Keyboard-only run of sign, change listing, remove, comment and submit at 1280 and 390 with focus visible at every stop (screenshots).
- [ ] Accessibility tree snapshot shows every control named, headings as headings, one h1 per page.
- [ ] Existing tests pass; add a component test for focus after sign and for the live region text.
- [ ] #72 closed by the PR.

## Risks / unknowns

- Focus management touches the same components as `participant-fixes-2`; keep changes to focus, labels and roles, not layout, to keep the merge clean.

## Notes

(closeout)

## Follow-ups

(closeout)
