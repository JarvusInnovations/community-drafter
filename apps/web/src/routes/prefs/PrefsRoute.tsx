import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { ALWAYS_CONFIRM_NOTE, FORCED_EXPLANATION, TOGGLES, type ToggleKey } from "./toggles.ts";

interface PrefsResponse {
  channel: string;
  every_revision: boolean;
  daily_digest: boolean;
  phase_changes: boolean;
  my_comments_addressed: boolean;
  reminders: boolean;
  forced: string[];
  email_masked?: string;
  ignored?: string[];
}

interface BundleResponse {
  document: { title: string };
}

/**
 * `specs/screens/preferences.md`: `/i/<token>/prefs`, also the landing page
 * for every subscription email's one-click "stop all optional messages"
 * link (`?stop-optional=1`, applied on load with a confirmation banner —
 * `specs/behaviors/notifications.md` § Content rules). Self-contained: it
 * fetches its own document title (`GET .../bundle`) and preferences
 * (`GET .../prefs`) rather than depending on `participant-sign-flow`'s
 * shared bundle hook, which isn't merged yet.
 */
export default function PrefsRoute() {
  const { token } = useParams<{ token: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [documentTitle, setDocumentTitle] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PrefsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const base = `/i/${token}/api`;

  const withPending = useCallback((key: string, active: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (active) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!token) {
      return undefined;
    }
    let cancelled = false;

    (async () => {
      try {
        const [bundleResponse, prefsResponse] = await Promise.all([
          fetch(`${base}/bundle`),
          fetch(`${base}/prefs`),
        ]);
        if (!prefsResponse.ok) {
          throw new Error("failed to load preferences");
        }
        const prefsData = (await prefsResponse.json()) as PrefsResponse;
        const bundleData = bundleResponse.ok
          ? ((await bundleResponse.json()) as BundleResponse)
          : null;
        if (cancelled) {
          return;
        }

        setDocumentTitle(bundleData?.document?.title ?? null);
        setPrefs(prefsData);
        setStatus("ready");

        if (searchParams.get("stop-optional") === "1") {
          const stopResponse = await fetch(`${base}/prefs/stop-optional`, { method: "POST" });
          if (!cancelled && stopResponse.ok) {
            const updated = (await stopResponse.json()) as PrefsResponse;
            setPrefs(updated);
            setBanner("Done — all optional messages are now off.");
          }
          const next = new URLSearchParams(searchParams);
          next.delete("stop-optional");
          setSearchParams(next, { replace: true });
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-runs if the token itself changes; `searchParams`/`setSearchParams`
    // deliberately aren't dependencies — this effect consumes the one-click
    // query param once on load rather than re-triggering as it's removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, base]);

  async function saveToggle(key: ToggleKey, value: boolean): Promise<void> {
    withPending(key, true);
    try {
      const response = await fetch(`${base}/prefs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) {
        throw new Error("save failed");
      }
      const updated = (await response.json()) as PrefsResponse;
      setPrefs(updated);
      setBanner(
        updated.ignored && updated.ignored.length > 0
          ? "That one can't be turned off — it's always on for you."
          : "Saved.",
      );
    } catch {
      setBanner("Couldn't save that change. Try again.");
    } finally {
      withPending(key, false);
    }
  }

  async function stopOptional(): Promise<void> {
    withPending("stop-optional", true);
    try {
      const response = await fetch(`${base}/prefs/stop-optional`, { method: "POST" });
      if (!response.ok) {
        throw new Error("save failed");
      }
      const updated = (await response.json()) as PrefsResponse;
      setPrefs(updated);
      setBanner("Done — all optional messages are now off.");
    } catch {
      setBanner("Couldn't save that change. Try again.");
    } finally {
      withPending("stop-optional", false);
    }
  }

  if (status === "loading") {
    return <main className="mx-auto max-w-xl p-6 text-muted-foreground">Loading…</main>;
  }
  if (status === "error" || !prefs) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p role="alert" className="text-foreground">
          We couldn&apos;t load your preferences. The link may have expired.
        </p>
      </main>
    );
  }

  const forced = new Set(prefs.forced);
  const values: Record<ToggleKey, boolean> = {
    every_revision: prefs.every_revision,
    daily_digest: prefs.daily_digest,
    phase_changes: prefs.phase_changes,
    my_comments_addressed: prefs.my_comments_addressed,
    reminders: prefs.reminders,
  };

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-xl font-semibold text-foreground">
        How we contact you about <em>{documentTitle ?? "this document"}</em>
      </h1>
      {prefs.email_masked && (
        <p className="mt-1 text-sm text-muted-foreground">Email: {prefs.email_masked}</p>
      )}

      <div aria-live="polite">
        {banner && (
          <p className="mt-4 rounded border border-border bg-muted px-3 py-2 text-sm text-foreground">
            {banner}
          </p>
        )}
      </div>

      <ul className="mt-6 space-y-5">
        {TOGGLES.map((toggle) => {
          const isForced = forced.has(toggle.key);
          const inputId = `notify-${toggle.key}`;
          return (
            <li key={toggle.key} className="flex items-start gap-3">
              <input
                id={inputId}
                type="checkbox"
                className="mt-1"
                checked={values[toggle.key]}
                disabled={isForced || pending.has(toggle.key)}
                onChange={(event) => void saveToggle(toggle.key, event.target.checked)}
              />
              <label htmlFor={inputId} className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{toggle.label}</span>
                {toggle.description && (
                  <span className="text-sm text-muted-foreground">{toggle.description}</span>
                )}
                {isForced && (
                  <span className="text-sm text-muted-foreground">{FORCED_EXPLANATION}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-sm text-muted-foreground">{ALWAYS_CONFIRM_NOTE}</p>

      <button
        type="button"
        onClick={() => void stopOptional()}
        disabled={pending.has("stop-optional")}
        className="mt-6 rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        Stop all optional messages
      </button>
    </main>
  );
}
