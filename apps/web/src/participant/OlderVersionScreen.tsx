import { useEffect, useState } from "react";
import { useParams } from "react-router";

import { ApiError, getVersion } from "./api.ts";
import { useParticipantBundle } from "./BundleContext.tsx";
import { DocumentView } from "./components/DocumentView.tsx";
import { copy } from "./copy.ts";
import { NotFoundScreen } from "./NotFoundScreen.tsx";
import { type VersionDetail } from "./types.ts";

/**
 * `/i/:token/v/:n` — an older version in read-only form
 * (`specs/screens/document.md` § Route). Reuses the shared bundle from
 * context for everything version-independent (status card, signatories,
 * …) and fetches only the requested version's body via
 * `GET /i/:token/api/versions/:n`.
 */
export function OlderVersionScreen(): JSX.Element {
  const { bundle, token, refetch } = useParticipantBundle();
  const { n } = useParams<{ n: string }>();
  const number = Number(n);

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; error: ApiError }
    | { status: "ready"; version: VersionDetail }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    getVersion(token, number)
      .then((version) => {
        if (!cancelled) {
          setState({ status: "ready", version });
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
  }, [token, number]);

  if (Number.isNaN(number)) {
    return <NotFoundScreen />;
  }
  if (state.status === "loading") {
    return <p className="p-4 text-muted-foreground">{copy.loading}</p>;
  }
  if (state.status === "error") {
    if (state.error.status === 404) {
      return <NotFoundScreen />;
    }
    return (
      <p role="alert" className="p-4 text-destructive">
        {copy.genericError}
      </p>
    );
  }

  return (
    <DocumentView
      bundle={bundle}
      token={token}
      refetch={refetch}
      version={state.version}
      isCurrent={number === bundle.version.number}
    />
  );
}
