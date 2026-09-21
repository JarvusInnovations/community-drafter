import { useEffect, useState } from "react";

import { ApiError, listSites } from "./api.ts";
import { Card } from "./components/Card.tsx";
import { Pill } from "./components/Pill.tsx";
import { copy } from "./copy.ts";
import { type SiteRow } from "./types.ts";

/**
 * `/admin/sites` — `specs/screens/admin-dashboard.md` § "Sites"
 * (superadmin, default host): one row per site with the From address mail
 * will actually use, operator and document counts, and honest verification
 * states.
 *
 * Nothing on this page changes DNS; it reports what is true and what is
 * missing (`specs/behaviors/sites.md` § Principles, "A site record never
 * moves DNS"). Creating and editing sites is CLI-only in phase 1, and the
 * page shows the command.
 */
export function SitesScreen(): JSX.Element {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSites()
      .then((rows) => {
        if (!cancelled) {
          setSites(rows);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : copy.genericError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-[1120px] px-5 py-6">
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
        {copy.sites.heading}
      </h1>
      <p className="mt-3 rounded-xl border-l-[3px] border-border bg-muted px-3 py-2.5 text-sm text-muted-foreground">
        {copy.sites.intro}{" "}
        <code className="rounded bg-card px-1.5 py-0.5">{copy.sites.createCommand}</code>
      </p>

      {error ? (
        <p role="alert" className="mt-4 text-destructive">
          {error}
        </p>
      ) : null}

      {sites === null && !error ? (
        <p className="mt-4 text-muted-foreground">{copy.loading}</p>
      ) : null}

      {sites && sites.length === 0 ? (
        <p className="mt-4 text-muted-foreground">{copy.sites.empty}</p>
      ) : null}

      {sites && sites.length > 0 ? (
        <Card className="mt-4 overflow-x-auto p-0">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3">{copy.sites.columns.site}</th>
                <th className="px-4 py-3">{copy.sites.columns.hostname}</th>
                <th className="px-4 py-3">{copy.sites.columns.from}</th>
                <th className="px-4 py-3">{copy.sites.columns.operators}</th>
                <th className="px-4 py-3">{copy.sites.columns.documents}</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.slug} className="border-b border-border last:border-0 align-top">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-foreground">{site.name}</span>{" "}
                    <span className="text-muted-foreground">({site.slug})</span>
                    {site.default ? (
                      <span className="ml-2">
                        <Pill tone="muted">{copy.sites.defaultPill}</Pill>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{site.hostname ?? "—"}</div>
                    <div className="mt-1">
                      <Pill tone={site.hostname_verified ? "ok" : "amber"}>
                        {site.hostname_verified
                          ? copy.sites.hostnameVerified
                          : copy.sites.hostnameUnverified}
                      </Pill>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{site.from_line}</div>
                    <div className="mt-1">
                      {site.sender_email ? (
                        <Pill tone={site.sender_verified === true ? "ok" : "amber"}>
                          {site.sender_verified === true
                            ? copy.sites.senderVerified
                            : copy.sites.senderUnverified}
                        </Pill>
                      ) : (
                        <Pill tone="muted">{copy.sites.senderPlatform}</Pill>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{site.operators.length}</td>
                  <td className="px-4 py-3 text-foreground">{site.documents}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {/*
       * The DNS a customer still has to add, per unverified site — the page
       * says what is missing rather than implying a live address.
       */}
      {(sites ?? [])
        .filter((site) => !site.default && site.dns.length > 0 && !site.hostname_verified)
        .map((site) => (
          <Card key={`dns-${site.slug}`} className="mt-4">
            <h2 className="text-sm font-bold text-foreground">
              {copy.sites.dnsHeading(site.hostname ?? site.slug)}
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {site.dns.map((record) => (
                <li key={`${record.type}-${record.name}`}>
                  <code className="rounded bg-muted px-1.5 py-0.5">
                    {record.type} {record.name} → {record.value}
                  </code>{" "}
                  — {record.purpose}
                </li>
              ))}
            </ul>
          </Card>
        ))}
    </main>
  );
}
