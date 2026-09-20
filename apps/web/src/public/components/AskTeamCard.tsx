import { copy } from "../copy.ts";

/**
 * `specs/screens/public-and-embed.md` § Display Rules "Public read view":
 * the card shown in place of the status card and identity line — "Want to
 * add your name? This document is open to invited signers. Ask the team
 * for your personal link: *reply_to*." (quoted verbatim). Phase 2 replaces
 * this with the "sign or comment" magic-link form when
 * `public_access = participate`; out of scope here.
 */
export function AskTeamCard({ replyTo }: { replyTo?: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-sm">
      <p className="text-xl font-bold tracking-tight text-foreground">{copy.askTeam.heading}</p>
      <p className="mt-1 text-muted-foreground">
        {copy.askTeam.intro}{" "}
        {replyTo ? (
          <a href={`mailto:${replyTo}`} className="font-medium text-primary">
            {replyTo}
          </a>
        ) : (
          copy.askTeam.fallback
        )}
      </p>
    </div>
  );
}
