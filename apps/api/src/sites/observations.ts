/**
 * `specs/api/admin.md` § Sites: `hostname_verified` and `sender_verified`
 * "are observations (does the hostname route here, has the provider
 * accepted this sender), never promises."
 *
 * So they are recorded from what actually happened rather than asserted: a
 * hostname is verified once a request has arrived on it, and a sender once
 * the provider accepted a message tagged with that site. Nothing here
 * checks DNS or calls a provider API — a site record never moves DNS, and
 * the credential that could is deliberately out of reach of an HTTP
 * request (`specs/behaviors/sites.md` § Principles).
 *
 * Both observations live in memory, like the dispatcher's failure list: a
 * restart forgets them and they re-accrue from the next request and the
 * next send. `null` means "not observed yet", which is what the Sites page
 * shows as "not verified yet".
 */
export class SiteObservations {
  private readonly hosts = new Set<string>();
  private readonly senders = new Map<string, boolean>();

  markHostSeen(hostname: string): void {
    if (hostname) this.hosts.add(hostname.toLowerCase());
  }

  hostSeen(hostname: string | undefined): boolean {
    return hostname ? this.hosts.has(hostname.toLowerCase()) : false;
  }

  /** One send outcome for the site a message was tagged with. */
  recordSend(siteSlug: string | undefined, accepted: boolean): void {
    if (!siteSlug) return;
    this.senders.set(siteSlug, accepted);
  }

  senderAccepted(siteSlug: string): boolean | null {
    return this.senders.get(siteSlug) ?? null;
  }
}
