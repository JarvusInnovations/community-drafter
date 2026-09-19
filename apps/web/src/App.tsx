import { Route, Routes } from "react-router";

import PrefsRoute from "./routes/prefs/PrefsRoute.tsx";

function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background p-6 text-foreground">
      <h1 className="text-2xl font-semibold">Community Drafter</h1>
      <p className="text-muted-foreground">
        Workspace bootstrap placeholder — see{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">specs/README.md</code>.
      </p>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* `notifications` plan: preferences screen. `participant-sign-flow`
          grouped its own /i/:token/* routes here too — a merge just adds
          more <Route> lines to this block. */}
      <Route path="/i/:token/prefs" element={<PrefsRoute />} />
    </Routes>
  );
}

export default App;
