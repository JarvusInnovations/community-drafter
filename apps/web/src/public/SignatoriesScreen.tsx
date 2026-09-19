import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { ApiError, getPublicBundle } from "./api.ts";
import { copy } from "./copy.ts";
import { type PublicBundle, type SignatoryListItem } from "./types.ts";
import { formatAbsolute } from "../participant/format.ts";
import { NotFoundScreen } from "../participant/NotFoundScreen.tsx";

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; bundle: PublicBundle };

/** `specs/behaviors/signatures.md` § Display: capacity-specific display strings, same as `../participant/components/Signatories.tsx`'s. */
function signatoryLabel(item: SignatoryListItem): string {
  if (item.capacity === "official") {
    const who = item.title ? `${item.display_name}, ${item.title}` : item.display_name;
    return `${item.org} — ${who}`;
  }
  return item.descriptor ? `${item.display_name}, ${item.descriptor}` : item.display_name;
}

/**
 * `/d/:slug/signatories` — a minimal-chrome, frameable page/fragment
 * (`specs/screens/public-and-embed.md` § Display Rules): the counts line,
 * then the ordered list the API already returns (organizations first,
 * alphabetically; then individuals, chronologically), the unlisted-count
 * footnote, and a last-updated time. Fetches its own bundle rather than
 * nesting under `PublicLayout` because it's embeddable on its own, exactly
 * like `EmbedScreen`, and must render without any shared chrome.
 */
export function SignatoriesScreen(): JSX.Element | null {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    if (!slug) {
      return;
    }
    let cancelled = false;
    getPublicBundle(slug)
      .then((bundle) => {
        if (!cancelled) {
          setState({ status: "ready", bundle });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) {
          return;
        }
        setState({
          status: "error",
          error:
            err instanceof ApiError
              ? err
              : new ApiError(500, "internal_error", copy.genericError, {}),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (!slug) {
    return <NotFoundScreen />;
  }
  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-muted-foreground">
        {copy.loading}
      </main>
    );
  }
  if (state.status === "error") {
    if (state.error.status === 404) {
      return <NotFoundScreen />;
    }
    return (
      <main className="flex min-h-screen items-center justify-center text-destructive">
        {copy.genericError}
      </main>
    );
  }

  const { signatories } = state.bundle;
  if (!signatories) {
    return <main className="p-4 text-sm text-muted-foreground">{copy.signatories.hidden}</main>;
  }

  return (
    <main className="p-4 pb-8">
      <p className="text-sm text-muted-foreground">
        {copy.signatories.counts(signatories.organizations, signatories.individuals)}
        {signatories.unlisted > 0 ? `, ${copy.signatories.unlisted(signatories.unlisted)}` : ""}
      </p>
      {signatories.list ? (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {signatories.list.map((item) => (
            <li
              key={`${item.capacity}:${item.org ?? ""}:${item.display_name}:${item.descriptor ?? ""}`}
              className="text-foreground"
            >
              {signatoryLabel(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">{copy.signatories.countsOnly}</p>
      )}
      {signatories.updated_at ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {copy.signatoriesPage.updatedAt(formatAbsolute(signatories.updated_at))}
        </p>
      ) : null}
    </main>
  );
}
