/** `PUBLIC_URL` + the participant route family (`specs/api/participant.md`, `specs/screens/preferences.md`). */
export function personalLink(publicUrl: string | undefined, token: string): string {
  return `${publicUrl ?? ""}/i/${token}`;
}

export function prefsLink(publicUrl: string | undefined, token: string): string {
  return `${personalLink(publicUrl, token)}/prefs`;
}

/**
 * `specs/behaviors/notifications.md` § Content rules: "a one-click 'stop all
 * optional messages' link"; `specs/screens/preferences.md` § Route: "the
 * one-click ... link ... lands here with the change already applied". A
 * plain `GET` to the prefs route with this query flag — the web app's prefs
 * screen fires the `POST prefs/stop-optional` itself on load, per the
 * spec's "a GET page that POSTs".
 */
export function stopOptionalLink(publicUrl: string | undefined, token: string): string {
  return `${prefsLink(publicUrl, token)}?stop-optional=1`;
}

export function compareLink(
  publicUrl: string | undefined,
  token: string,
  fromVersion: number,
  toVersion: number,
): string {
  return `${personalLink(publicUrl, token)}/history/compare?from=${fromVersion}&to=${toVersion}`;
}

export function historyLink(publicUrl: string | undefined, token: string): string {
  return `${personalLink(publicUrl, token)}/history`;
}
