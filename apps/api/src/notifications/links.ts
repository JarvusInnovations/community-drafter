/**
 * The participant route family (`specs/api/participant.md`,
 * `specs/screens/preferences.md`), built on the **document's site**
 * (`specs/behaviors/sites.md` § The document's site is canonical) — never
 * on the host a request happened to arrive at, and never on the
 * deployment's own URL. `baseUrl` is the site's origin; the default site of
 * a deployment with no `PUBLIC_URL` has none, and links stay relative
 * exactly as they did before sites existed.
 */
export function personalLink(baseUrl: string | undefined, token: string): string {
  return `${baseUrl ?? ""}/i/${token}`;
}

export function prefsLink(baseUrl: string | undefined, token: string): string {
  return `${personalLink(baseUrl, token)}/prefs`;
}

/**
 * `specs/behaviors/notifications.md` § Content rules: "a one-click 'stop all
 * optional messages' link"; `specs/screens/preferences.md` § Route: "the
 * one-click ... link ... lands here with the change already applied". A
 * plain `GET` to the prefs route with this query flag — the web app's prefs
 * screen fires the `POST prefs/stop-optional` itself on load, per the
 * spec's "a GET page that POSTs".
 */
export function stopOptionalLink(baseUrl: string | undefined, token: string): string {
  return `${prefsLink(baseUrl, token)}?stop-optional=1`;
}

export function compareLink(
  baseUrl: string | undefined,
  token: string,
  fromVersion: number,
  toVersion: number,
): string {
  return `${personalLink(baseUrl, token)}/history/compare?from=${fromVersion}&to=${toVersion}`;
}

export function historyLink(baseUrl: string | undefined, token: string): string {
  return `${personalLink(baseUrl, token)}/history`;
}
