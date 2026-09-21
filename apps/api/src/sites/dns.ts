/**
 * `specs/behaviors/sites.md` § Onboarding a hostname, step 4: creating a
 * site prints, in one block, every DNS record the customer must add — the
 * CNAME for the hostname, and, when the site declares a `sender_email`, the
 * two records the mail provider requires.
 *
 * **A site record never moves DNS** (§ Principles): nothing here creates,
 * changes or checks a record. This is a list of what someone else has to
 * add, and the values the provider owns are named as things to fetch from
 * its console rather than guessed at.
 */

/** The platform's own alias customers point their hostname at. */
export const SITE_CNAME_TARGET = "sites.signatories.org";

/** Where the two provider values come from; automating this is a follow-up, not a thing the service does. */
const FROM_PROVIDER = "get this value from Postmark → Sender Signatures";

export interface DnsRecord {
  type: "CNAME" | "TXT";
  name: string;
  value: string;
  purpose: string;
}

/** The mail domain a sender address belongs to. */
function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export function dnsRecordsForSite(site: {
  hostname: string;
  sender_email?: string;
}): DnsRecord[] {
  const records: DnsRecord[] = [
    {
      type: "CNAME",
      name: site.hostname,
      value: SITE_CNAME_TARGET,
      purpose: "Point this hostname at the service (the certificate provisions on its own once it resolves)",
    },
  ];

  if (site.sender_email) {
    const domain = domainOf(site.sender_email);
    records.push(
      {
        type: "TXT",
        name: `<the DKIM host Postmark shows>.${domain}`,
        value: `${FROM_PROVIDER} → ${domain} → DKIM`,
        purpose: "Let the mail provider sign this site's mail (DKIM)",
      },
      {
        type: "CNAME",
        name: `pm-bounces.${domain}`,
        value: `${FROM_PROVIDER} → ${domain} → Return-Path`,
        purpose: "Return-Path for this site's mail",
      },
    );
  }

  return records;
}
