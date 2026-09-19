/**
 * Golden test fixtures: realistic charter-like prose across revisions, used
 * by render/diff/anchor tests. Not a test file itself (no `.test.ts` suffix,
 * so `bun test` skips it).
 */

export const CHARTER_V1 = `# Save the Academy Charter

## 1. Purpose

We, the undersigned members of the community, affirm our commitment to preserving the academy's mission for future generations.

## 2. Commitments

- Protect the museum collection from deaccession.
- Preserve public access to the library.
- Sustain funding for education programs.

## 3. How a statement becomes the coalition's

Comments are open for two weeks before publication.

> Silence is consent, and we say so on the post.

## 4. Signatories

| Name | Capacity |
| --- | --- |
| Jane Doe | Individual |
| River Trust | Organization |

Thank you for reading this draft charter.
`;

/**
 * Relative to v1: four content changes (Purpose paragraph, first Commitments
 * item, the blockquote, the "Individual" cell) and one addition (a fourth
 * Commitments item) — exactly "4 changed, 1 added, 0 removed", matching
 * `plans/render-and-diff.md`'s Validation criterion. Everything else is
 * byte-identical so those blocks must keep their v1 ids.
 */
export const CHARTER_V2 = `# Save the Academy Charter

## 1. Purpose

We, the undersigned members of the community, affirm our commitment to preserving the academy's mission for future generations and the community it serves.

## 2. Commitments

- Protect the museum collection from deaccession or sale.
- Preserve public access to the library.
- Sustain funding for education programs.
- Report progress to the community quarterly.

## 3. How a statement becomes the coalition's

Comments are open for two weeks before publication.

> Silence is consent, and we say so clearly on the post.

## 4. Signatories

| Name | Capacity |
| --- | --- |
| Jane Doe | Individual signer |
| River Trust | Organization |

Thank you for reading this draft charter.
`;

/**
 * Relative to v2: the Purpose paragraph is rewritten past the similarity
 * threshold (removed + added rather than matched), the first Commitments
 * item is removed outright, the "3." heading drops one level (format-only:
 * text unchanged), and the blockquote is untouched (for re-anchoring tests).
 */
export const CHARTER_V3 = `# Save the Academy Charter

## 1. Purpose

The coalition's core team publishes this charter on behalf of everyone who signs it, present and future.

## 2. Commitments

- Preserve public access to the library.
- Sustain funding for education programs.
- Report progress to the community quarterly.

### 3. How a statement becomes the coalition's

Comments are open for two weeks before publication.

> Silence is consent, and we say so clearly on the post.

## 4. Signatories

| Name | Capacity |
| --- | --- |
| Jane Doe | Individual signer |
| River Trust | Organization |

Thank you for reading this draft charter.
`;

/** Two identical list items in one render: exercises the ordinal-suffix rule. */
export const DUPLICATE_BLOCKS_FIXTURE = `- Sign here.
- Sign here.
`;

/** A `<script>` tag and an `onclick` attribute: exercises HTML sanitization. */
export const RAW_HTML_FIXTURE = `# Notice

<script>alert(1)</script>

<a href="#" onclick="evil()">Click</a> this link, or don't.
`;
