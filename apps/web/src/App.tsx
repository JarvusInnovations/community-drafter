import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router";

import PrefsRoute from "./routes/prefs/PrefsRoute.tsx";
import { DocumentScreen } from "./participant/DocumentScreen.tsx";
import { copy } from "./participant/copy.ts";
import { NotFoundScreen } from "./participant/NotFoundScreen.tsx";
import { ParticipantLayout } from "./participant/ParticipantLayout.tsx";

// Code-split everything past the sign card so the initial participant load
// (`specs/architecture.md`'s 120 KB gzipped budget, `principles.md`'s "Sign
// first, everything else after") doesn't pay for history/compare/comment
// code most visits never touch.
const OlderVersionScreen = lazy(() =>
  import("./participant/OlderVersionScreen.tsx").then((m) => ({ default: m.OlderVersionScreen })),
);
const HistoryScreen = lazy(() =>
  import("./participant/HistoryScreen.tsx").then((m) => ({ default: m.HistoryScreen })),
);
const CompareScreen = lazy(() =>
  import("./participant/CompareScreen.tsx").then((m) => ({ default: m.CompareScreen })),
);
const CommentModeScreen = lazy(() =>
  import("./participant/comment/CommentModeScreen.tsx").then((m) => ({
    default: m.CommentModeScreen,
  })),
);

// `admin-dashboard`: the whole `/admin/*` family is code-split too — a
// participant opening `/i/:token` never touches this tree, and vice versa
// (`specs/architecture.md`'s 120 KB gzipped budget only covers the eager
// participant entry; every admin screen is lazy so it never counts against it).
const AdminLayout = lazy(() =>
  import("./admin/AdminLayout.tsx").then((m) => ({ default: m.AdminLayout })),
);
const LoginScreen = lazy(() =>
  import("./admin/LoginScreen.tsx").then((m) => ({ default: m.LoginScreen })),
);
const DeviceApprovalScreen = lazy(() =>
  import("./admin/DeviceApprovalScreen.tsx").then((m) => ({ default: m.DeviceApprovalScreen })),
);
const DocumentListScreen = lazy(() =>
  import("./admin/DocumentListScreen.tsx").then((m) => ({ default: m.DocumentListScreen })),
);
const OperatorsScreen = lazy(() =>
  import("./admin/OperatorsScreen.tsx").then((m) => ({ default: m.OperatorsScreen })),
);
const SitesScreen = lazy(() =>
  import("./admin/SitesScreen.tsx").then((m) => ({ default: m.SitesScreen })),
);
const DocumentLayout = lazy(() =>
  import("./admin/DocumentLayout.tsx").then((m) => ({ default: m.DocumentLayout })),
);
const DashboardScreen = lazy(() =>
  import("./admin/DashboardScreen.tsx").then((m) => ({ default: m.DashboardScreen })),
);
const PeopleScreen = lazy(() =>
  import("./admin/PeopleScreen.tsx").then((m) => ({ default: m.PeopleScreen })),
);
const SubmissionsScreen = lazy(() =>
  import("./admin/SubmissionsScreen.tsx").then((m) => ({ default: m.SubmissionsScreen })),
);
const VersionsScreen = lazy(() =>
  import("./admin/VersionsScreen.tsx").then((m) => ({ default: m.VersionsScreen })),
);
const ViewAsScreen = lazy(() =>
  import("./admin/ViewAsScreen.tsx").then((m) => ({ default: m.ViewAsScreen })),
);

// `public-and-embed`: the whole `/d/:slug/*` family is code-split too — a
// participant opening `/i/:token` never touches this tree, and vice versa.
const PublicLayout = lazy(() =>
  import("./public/PublicLayout.tsx").then((m) => ({ default: m.PublicLayout })),
);
const PublicDocumentScreen = lazy(() =>
  import("./public/DocumentScreen.tsx").then((m) => ({ default: m.DocumentScreen })),
);
const PublicHistoryScreen = lazy(() =>
  import("./public/HistoryScreen.tsx").then((m) => ({ default: m.HistoryScreen })),
);
const PublicCompareScreen = lazy(() =>
  import("./public/CompareScreen.tsx").then((m) => ({ default: m.CompareScreen })),
);
const SignatoriesScreen = lazy(() =>
  import("./public/SignatoriesScreen.tsx").then((m) => ({ default: m.SignatoriesScreen })),
);
const EmbedScreen = lazy(() =>
  import("./public/EmbedScreen.tsx").then((m) => ({ default: m.EmbedScreen })),
);

function LazyFallback(): JSX.Element {
  return <p className="p-4 text-muted-foreground">{copy.loading}</p>;
}

/**
 * The instance root (`specs/screens/admin-dashboard.md` § Navigation): one
 * line naming the instance and where its operators sign in. No lobby, no
 * document list (`principles.md` § One instance, many documents, no lobby).
 */
function HomePage(): JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-[420px] rounded-2xl border border-border bg-card p-6 text-center">
        <h1 className="text-xl font-bold tracking-tight">Community Drafter</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Documents here are reached through the personal links sent to their participants. If you
          run documents on this instance, sign in.
        </p>
        <a
          href="/admin/login"
          className="mt-4 inline-block rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_18px_rgba(36,87,245,0.28)]"
        >
          Sign in
        </a>
      </div>
    </main>
  );
}

function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/i/:token" element={<ParticipantLayout />}>
        <Route index element={<DocumentScreen />} />
        <Route
          path="v/:n"
          element={
            <Suspense fallback={<LazyFallback />}>
              <OlderVersionScreen />
            </Suspense>
          }
        />
        <Route
          path="history"
          element={
            <Suspense fallback={<LazyFallback />}>
              <HistoryScreen />
            </Suspense>
          }
        />
        <Route
          path="history/compare"
          element={
            <Suspense fallback={<LazyFallback />}>
              <CompareScreen />
            </Suspense>
          }
        />
        <Route
          path="comment"
          element={
            <Suspense fallback={<LazyFallback />}>
              <CommentModeScreen />
            </Suspense>
          }
        />
        <Route
          path="prefs"
          element={
            <Suspense fallback={<LazyFallback />}>
              <PrefsRoute />
            </Suspense>
          }
        />
      </Route>

      {/*
        `public-and-embed`: `/d/:slug` and its non-embed children share
        `PublicLayout`'s one bundle fetch; `embed` and `signatories` fetch
        their own and render no shared chrome at all (both must work
        standing alone in a foreign-origin iframe) — see each screen's own
        doc comment. Every route here is grouped in this one block.
      */}
      <Route
        path="/d/:slug/embed"
        element={
          <Suspense fallback={<LazyFallback />}>
            <EmbedScreen />
          </Suspense>
        }
      />
      <Route
        path="/d/:slug/signatories"
        element={
          <Suspense fallback={<LazyFallback />}>
            <SignatoriesScreen />
          </Suspense>
        }
      />
      <Route
        path="/d/:slug"
        element={
          <Suspense fallback={<LazyFallback />}>
            <PublicLayout />
          </Suspense>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<LazyFallback />}>
              <PublicDocumentScreen />
            </Suspense>
          }
        />
        <Route
          path="history"
          element={
            <Suspense fallback={<LazyFallback />}>
              <PublicHistoryScreen />
            </Suspense>
          }
        />
        <Route
          path="history/compare"
          element={
            <Suspense fallback={<LazyFallback />}>
              <PublicCompareScreen />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundScreen />} />
      </Route>

      {/* `admin-dashboard`: the read-mostly `/admin/*` family — grouped here as
          its own block, same convention as `/d/:slug/*` above. `/admin/login`
          and `/auth/device` sit outside `AdminLayout`'s session gate — they
          are how a signed-out visitor gets a session in the first place. */}
      <Route
        path="/admin/login"
        element={
          <Suspense fallback={<LazyFallback />}>
            <LoginScreen />
          </Suspense>
        }
      />
      <Route
        path="/auth/device"
        element={
          <Suspense fallback={<LazyFallback />}>
            <DeviceApprovalScreen />
          </Suspense>
        }
      />
      <Route
        path="/admin"
        element={
          <Suspense fallback={<LazyFallback />}>
            <AdminLayout />
          </Suspense>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<LazyFallback />}>
              <DocumentListScreen />
            </Suspense>
          }
        />
        <Route
          path="operators"
          element={
            <Suspense fallback={<LazyFallback />}>
              <OperatorsScreen />
            </Suspense>
          }
        />
        <Route
          path="sites"
          element={
            <Suspense fallback={<LazyFallback />}>
              <SitesScreen />
            </Suspense>
          }
        />
        <Route
          path="d/:slug"
          element={
            <Suspense fallback={<LazyFallback />}>
              <DocumentLayout />
            </Suspense>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<LazyFallback />}>
                <DashboardScreen />
              </Suspense>
            }
          />
          <Route
            path="people"
            element={
              <Suspense fallback={<LazyFallback />}>
                <PeopleScreen />
              </Suspense>
            }
          />
          <Route
            path="submissions"
            element={
              <Suspense fallback={<LazyFallback />}>
                <SubmissionsScreen />
              </Suspense>
            }
          />
          <Route
            path="versions"
            element={
              <Suspense fallback={<LazyFallback />}>
                <VersionsScreen />
              </Suspense>
            }
          />
          <Route
            path="view-as/:person"
            element={
              <Suspense fallback={<LazyFallback />}>
                <ViewAsScreen />
              </Suspense>
            }
          />
        </Route>
      </Route>

      {/*
        `specs/api/conventions.md`: an address nobody routed — `/login`,
        `/sign-in`, a mistyped link — is answered with the app's own
        "isn't available" page. The API serves this shell with a 404 for
        any unmatched HTML `GET`; this route is what the shell then
        renders (#60).
      */}
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}

export default App;
