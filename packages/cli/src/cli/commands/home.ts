import { clientFrom } from "./common.js";
import { isConfigured, resolveConfig } from "../config.js";
import { cliInvocation } from "../invocation.js";
import { bool, parseFlags, str, type FlagSpec } from "../flags.js";
import { computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { DocumentSummary, InvitationRow, NotificationsSummary, WhoAmI } from "../types.js";

const HOME_FLAGS: FlagSpec = { positionals: 0, boolean: ["--if-configured"] };

/** How many open documents to drill into for invited/opened/signed + failure counts. */
const DRILL_DOWN_LIMIT = 10;

/**
 * The no-args view (AXI §8) and, via `home --if-configured`, what the
 * SessionStart hook prints (`specs/api/admin-cli.md` § Session hook).
 *
 * `GET /documents` (one call) gives every document's phase and aggregate
 * counts. For open documents only — the ones with an actionable funnel — a
 * bounded number of follow-up calls (invitations + notifications) resolve
 * the finer invited/opened/signed/failure breakdown the spec asks for,
 * capped at `DRILL_DOWN_LIMIT` so this stays a session-start-safe payload.
 */
export async function homeCommand(args: string[]): Promise<string> {
  const parsed = parseFlags("home", args, HOME_FLAGS);
  const ifConfigured = bool(parsed, "--if-configured");
  // `specs/api/admin-cli.md` § Output rules, "One invocation form per
  // surface": every emitted command reads `signatories-axi …`, and the
  // resolved path of the shim (which is not on PATH) is printed exactly
  // once — here, as `invoke_as` — so a reader learns how to run any of
  // them without the two forms interleaving.
  const cli = "signatories-axi";
  const invokeAs = cliInvocation();

  if (!isConfigured({ profile: str(parsed, "--profile") })) {
    if (ifConfigured) return ""; // hook: stay silent when unconfigured (spec: "when SIGNATORIES_URL is set")
    return joinBlocks(
      renderObject({ documents: "not signed in", invoke_as: invokeAs }),
      renderHelp([
        `Run \`${cli} login <email> --url <instance>\` to sign in`,
        `Run \`${cli} --help\` to see the full command list`,
      ]),
    );
  }

  // `specs/api/admin-cli.md`: the home view leads with who is signed in and
  // where, so an agent (or a person juggling a bot profile) can never act
  // under the wrong identity without seeing it.
  const config = resolveConfig({ profile: str(parsed, "--profile") });
  const client = clientFrom(parsed);

  let who: WhoAmI;
  let documents: DocumentSummary[];
  try {
    [who, documents] = await Promise.all([
      client.get<WhoAmI>("/whoami"),
      client.get<DocumentSummary[]>("/documents"),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const expired = /unauthenticated|operator_inactive|401/iu.test(message);
    const identity = renderObject({
      signed_in: expired ? "no — the stored sign-in is expired or revoked" : "unknown",
      instance: config.url,
      profile:
        config.tokenSource === "env" ? "(SIGNATORIES_TOKEN from the environment)" : config.profile,
      invoke_as: invokeAs,
    });
    if (expired) {
      return joinBlocks(
        identity,
        renderHelp([`Run \`${cli} login <email> --url ${config.url}\` to sign in again`]),
      );
    }
    if (ifConfigured) {
      // A hook must never error out a session (axi-skills: home/dashboard split).
      return joinBlocks(
        identity,
        renderObject({ documents: `could not reach the API: ${message}` }),
      );
    }
    throw error;
  }

  const identity = renderObject({
    signed_in: `${who.name} <${who.email}>`,
    kind: who.kind,
    // `specs/api/admin-cli.md` § Session hook: the identity line names the
    // site the profile is signed in to, since the same command against two
    // profiles is two different tenants.
    site: who.site ? `${who.site.name} (${who.site.slug})` : "default",
    instance: config.url,
    profile:
      config.tokenSource === "env" ? "(SIGNATORIES_TOKEN from the environment)" : config.profile,
    token_expires: who.expires_at,
    invoke_as: invokeAs,
  });

  if (documents.length === 0) {
    return joinBlocks(
      identity,
      renderObject({ documents: "0 documents found" }),
      renderHelp([`Run \`${cli} docs create <slug> --title "..." ...\` to start one`]),
    );
  }

  const openDocs = documents
    .filter((d) => d.state === "open")
    .sort((a, b) => nextDeadline(a).localeCompare(nextDeadline(b)))
    .slice(0, DRILL_DOWN_LIMIT);

  const drillDowns = new Map<
    string,
    { invited: number; opened: number; signed: number; failed: number }
  >();
  await Promise.all(
    openDocs.map(async (doc) => {
      try {
        const [invitations, notifications] = await Promise.all([
          client.get<InvitationRow[]>(`/documents/${encodeURIComponent(doc.slug)}/invitations`),
          client.get<NotificationsSummary>(
            `/documents/${encodeURIComponent(doc.slug)}/notifications`,
          ),
        ]);
        drillDowns.set(doc.slug, {
          invited: invitations.length,
          opened: invitations.filter((i) => i.opened_at).length,
          signed: invitations.filter((i) => i.signature && !i.signature.revoked).length,
          failed: notifications.failed,
        });
      } catch {
        // Best-effort drill-down — a single document's failure never blocks the rest.
      }
    }),
  );

  const rows = documents.map((doc) => {
    const drill = drillDowns.get(doc.slug);
    return {
      slug: doc.slug,
      phase: doc.phase,
      next_deadline: nextDeadline(doc) || "",
      invited: drill?.invited ?? doc.counts.participations,
      opened: drill?.opened ?? "",
      signed:
        drill?.signed ??
        doc.counts.signatures.organizations +
          doc.counts.signatures.individuals +
          doc.counts.signatures.unlisted,
      failures: drill?.failed ?? "",
    };
  });

  const totalFailures = [...drillDowns.values()].reduce((sum, d) => sum + d.failed, 0);
  const suggestions = [
    `Run \`${cli} docs show <slug>\` for a document's full dashboard`,
    `Run \`${cli} feedback export <slug>\` to pull the pending-comment bundle for an LLM round`,
  ];
  if (totalFailures > 0)
    suggestions.unshift(
      `Run \`${cli} notifications retry <slug>\` — ${totalFailures} failed notification(s) across open documents`,
    );
  if (documents.length > DRILL_DOWN_LIMIT + openDocs.length) {
    suggestions.push(
      `Run \`${cli} docs show <slug>\` — only the ${DRILL_DOWN_LIMIT} nearest-deadline open documents got a full drill-down here`,
    );
  }

  return joinBlocks(
    identity,
    renderList("documents", rows, [
      computed("slug", (r) => r.slug),
      computed("phase", (r) => r.phase),
      computed("next_deadline", (r) => r.next_deadline),
      computed("invited", (r) => r.invited),
      computed("opened", (r) => r.opened),
      computed("signed", (r) => r.signed),
      computed("failures", (r) => r.failures),
    ]),
    renderHelp(suggestions),
  );
}

function nextDeadline(doc: DocumentSummary): string {
  if (doc.phase === "commenting") return doc.comments_close_at ?? "";
  if (doc.phase === "signing") return doc.signing_closes_at ?? "";
  return "";
}
