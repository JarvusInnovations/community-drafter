/**
 * The one place the storage layer shells out to `git` for history reads
 * (`specs/architecture.md`: "the request path never shells out to git" —
 * these helpers back the boot-time / post-commit read-model passes only,
 * never a route handler directly).
 */

// Control characters that cannot appear in a git commit message, used to
// delimit records/fields in a single `git log` call instead of one spawn per
// commit.
const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";

export interface CommitLogEntry {
  hash: string;
  committerDate: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  trailers: Record<string, string>;
}

async function runGit(
  args: string[],
  opts: { cwd: string; stdin?: string },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: opts.cwd,
    stdin: opts.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (opts.stdin !== undefined && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** Parse a `%(trailers)` block ("Key: value" lines) into a plain object. */
function parseTrailerBlock(block: string): Record<string, string> {
  const trailers: Record<string, string> = {};
  for (const line of block.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    trailers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return trailers;
}

/**
 * `git log --first-parent` over one path, oldest-first, with every commit's
 * trailers parsed. This is the pass `specs/architecture.md` describes for
 * building the version index and per-document activity; it is a boot-time /
 * post-commit operation, never called from a request handler. One `git log`
 * spawn covers the whole history — `%(trailers)` renders the parsed trailer
 * block inline, so there is no per-commit `git interpret-trailers` spawn.
 */
export async function logWithTrailers(
  dataDir: string,
  pathspec?: string,
): Promise<CommitLogEntry[]> {
  const args = [
    "log",
    "--first-parent",
    `--format=${RECORD_SEP}%H${FIELD_SEP}%cI${FIELD_SEP}%an${FIELD_SEP}%ae${FIELD_SEP}%s${FIELD_SEP}%(trailers)`,
  ];
  if (pathspec) args.push("--", pathspec);

  const { stdout, stderr, code } = await runGit(args, { cwd: dataDir });
  if (code !== 0) {
    // No commits yet touch this path (or the repo has no commits at all).
    if (/does not have any commits yet|unknown revision/i.test(stderr)) return [];
    throw new Error(`git log failed (${code}): ${stderr}`);
  }

  const records = stdout.split(RECORD_SEP).filter((chunk) => chunk.length > 0);
  const entries: CommitLogEntry[] = [];

  for (const record of records) {
    const fields = record.split(FIELD_SEP);
    const hash = fields[0] ?? "";
    const committerDate = fields[1] ?? "";
    const authorName = fields[2] ?? "";
    const authorEmail = fields[3] ?? "";
    const subject = fields[4] ?? "";
    // The trailer block may itself contain FIELD_SEP in the pathological
    // case; rejoin anything past the fifth separator as the block.
    const trailerBlock = fields.slice(5).join(FIELD_SEP);
    const trailers = parseTrailerBlock(trailerBlock);

    entries.push({ hash, committerDate, authorName, authorEmail, subject, trailers });
  }

  // git log yields newest-first; version numbering is oldest = 1.
  return entries.reverse();
}

/** `git show <commit>:<path>`, or `null` if the path didn't exist at that commit. */
export async function readFileAtCommit(
  dataDir: string,
  commit: string,
  relPath: string,
): Promise<string | null> {
  const { stdout, code } = await runGit(["show", `${commit}:${relPath}`], { cwd: dataDir });
  if (code !== 0) return null;
  return stdout;
}

const FRONTMATTER_DELIM = "+++";

/**
 * Split a gitsheets markdown record's raw file bytes into frontmatter (raw
 * TOML text, unused today but kept for symmetry) and body — the same shape
 * `sheet.loadBody` gives at HEAD, but for an arbitrary historical commit,
 * which the gitsheets API doesn't expose directly.
 */
export function splitFrontmatter(fileContents: string): { frontmatter: string; body: string } {
  if (!fileContents.startsWith(`${FRONTMATTER_DELIM}\n`)) {
    return { frontmatter: "", body: fileContents };
  }
  const closeMarker = `\n${FRONTMATTER_DELIM}\n`;
  const closeIdx = fileContents.indexOf(closeMarker, FRONTMATTER_DELIM.length + 1);
  if (closeIdx === -1) {
    return { frontmatter: "", body: fileContents };
  }

  const frontmatter = fileContents.slice(FRONTMATTER_DELIM.length + 1, closeIdx);
  let body = fileContents.slice(closeIdx + closeMarker.length);
  // One blank line conventionally separates the frontmatter close from the
  // body; it is not part of the body value itself.
  if (body.startsWith("\n")) body = body.slice(1);
  // The file always ends with exactly one trailing newline (gitsheets'
  // on-disk contract); strip it so this matches the in-memory `body` field.
  if (body.endsWith("\n")) body = body.slice(0, -1);
  return { frontmatter, body };
}
