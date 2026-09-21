import { parseSubcommand, requirePositional, str, type FlagSpec } from "../flags.js";
import { computed, joinBlocks, renderHelp, renderList, renderObject } from "../output.js";
import type { NotificationsRetryResult, NotificationsSummary } from "../types.js";
import { clientFrom, render } from "./common.js";

const NOTIFICATIONS_FLAGS: Record<string, FlagSpec> = {
  list: { positionals: 1 },
  retry: { positionals: 1, value: ["--event", "--person"] },
};

export const NOTIFICATIONS_HELP = `usage: signatories-axi notifications <list|retry> ...

list <slug>
retry <slug> [--event <name>] [--person <id>]`;

export async function notificationsCommand(args: string[]): Promise<string> {
  const { sub, parsed } = parseSubcommand("notifications", args, NOTIFICATIONS_FLAGS);
  const client = clientFrom(parsed);

  switch (sub) {
    case "list": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi notifications list <slug>",
      );
      const summary = await client.get<NotificationsSummary>(
        `/documents/${encodeURIComponent(slug)}/notifications`,
      );
      return render(parsed, summary, () =>
        joinBlocks(
          renderObject({
            sent: summary.sent,
            pending: summary.pending,
            failed: summary.failed,
            // `specs/api/admin-cli.md`: `list` also says when the last
            // operator digest went out, or that none has — it is the one
            // delivery `sent` cannot show, because operator mail writes
            // nothing to a participation.
            operator_digest_sent: summary.operator_digest_sent ?? "none yet",
          }),
          summary.failures && summary.failures.length > 0
            ? renderList("failures", summary.failures, [
                computed<NonNullable<NotificationsSummary["failures"]>[number]>(
                  "event",
                  (f) => f.event,
                ),
                computed<NonNullable<NotificationsSummary["failures"]>[number]>(
                  "person",
                  (f) => f.person,
                ),
                computed<NonNullable<NotificationsSummary["failures"]>[number]>("at", (f) => f.at),
                computed<NonNullable<NotificationsSummary["failures"]>[number]>(
                  "error",
                  (f) => f.error,
                ),
              ])
            : "",
          summary.failed > 0
            ? renderHelp([`Run \`signatories-axi notifications retry ${slug}\` to re-dispatch`])
            : "",
        ),
      );
    }

    case "retry": {
      const slug = requirePositional(
        parsed,
        0,
        "slug",
        "signatories-axi notifications retry <slug>",
      );
      const result = await client.post<NotificationsRetryResult>(
        `/documents/${encodeURIComponent(slug)}/notifications/retry`,
        {
          event: str(parsed, "--event"),
          person: str(parsed, "--person"),
        },
      );
      return render(parsed, result, () => renderObject(result));
    }

    default:
      return sub; // unreachable
  }
}
