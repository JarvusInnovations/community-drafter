import { Route, Routes } from "react-router";

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
    </Routes>
  );
}

export default App;
