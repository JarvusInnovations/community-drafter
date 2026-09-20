/**
 * `specs/screens/admin-dashboard.md` § Design: "The funnel is a horizontal
 * bar of segments (invited → sent → opened → acted) with counts beneath;
 * signed is split into organizations and individuals as two stat tiles,
 * conditional and revoked as small muted tiles."
 */
export interface FunnelCounts {
  invited: number;
  sent: number;
  opened: number;
  acted: number;
}

const STAGE_TONE = ["bg-muted-foreground/40", "bg-primary/50", "bg-primary/75", "bg-primary"];

export function FunnelBar({
  funnel,
  labels,
}: {
  funnel: FunnelCounts;
  labels: { invited: string; sent: string; opened: string; acted: string };
}): JSX.Element {
  const stages = [
    { key: "invited", label: labels.invited, count: funnel.invited },
    { key: "sent", label: labels.sent, count: funnel.sent },
    { key: "opened", label: labels.opened, count: funnel.opened },
    { key: "acted", label: labels.acted, count: funnel.acted },
  ] as const;
  const max = Math.max(1, funnel.invited);

  return (
    <div>
      <div
        className="flex h-3 w-full gap-1 overflow-hidden rounded-full bg-muted"
        role="presentation"
      >
        {stages.map((stage, index) => (
          <div
            key={stage.key}
            className={`h-full rounded-full ${STAGE_TONE[index]}`}
            style={{ width: `${Math.max(6, (stage.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stages.map((stage) => (
          <div key={stage.key} className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {stage.label}
            </p>
            <p className="text-xl font-bold tracking-tight text-foreground">{stage.count}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const TILE_SURFACE = { ok: "bg-ok-soft", muted: "bg-muted", amber: "bg-amber-soft" } as const;
const TILE_INK = { ok: "text-ok", muted: "text-foreground", amber: "text-amber" } as const;

export function StatTile({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: number;
  /** `amber` is the "something to act on" tone — the behind-the-current-version count. */
  tone?: "ok" | "muted" | "amber";
}): JSX.Element {
  return (
    <div className={`rounded-xl border border-border px-3 py-2.5 ${TILE_SURFACE[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`text-lg font-bold ${TILE_INK[tone]}`}>{value}</p>
    </div>
  );
}
