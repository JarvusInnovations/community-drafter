import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";

import { CitationsToggle } from "./CitationsToggle.tsx";
import { useCitationsMode } from "../../lib/citations.ts";

afterEach(() => {
  cleanup();
  try {
    globalThis.localStorage?.clear();
  } catch {
    // A test environment without storage is exactly the case the hook tolerates.
  }
});

/** A stand-in for the document card: the toggle, plus what the hook resolved. */
function Harness(): JSX.Element {
  const { mode, sourcesShown, setSourcesShown } = useCitationsMode();
  const location = useLocation();
  return (
    <>
      <CitationsToggle checked={sourcesShown} onChange={setSourcesShown} />
      <p data-testid="mode">{mode}</p>
      <p data-testid="search">{location.search}</p>
    </>
  );
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/i/:token" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * `specs/screens/document.md` § Display Rules 5, *Sources as footnotes*.
 */
describe("the Sources-as-footnotes toggle", () => {
  it("is off by default and offers the reading preference, not an action", () => {
    renderAt("/i/abc");
    const box = screen.getByRole("checkbox", { name: "Sources as footnotes" });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("mode").textContent).toBe("links");
  });

  it("switches the mode and writes it into the URL so the form can be shared", () => {
    renderAt("/i/abc");
    fireEvent.click(screen.getByRole("checkbox", { name: "Sources as footnotes" }));

    expect(screen.getByTestId("mode").textContent).toBe("footnotes");
    expect(screen.getByTestId("search").textContent).toContain("citations=footnotes");

    fireEvent.click(screen.getByRole("checkbox", { name: "Sources as footnotes" }));
    expect(screen.getByTestId("mode").textContent).toBe("links");
    expect(screen.getByTestId("search").textContent).toContain("citations=links");
  });

  it("honors ?citations= from the URL, including the PDF's own mode", () => {
    renderAt("/i/abc?citations=hybrid");
    expect(screen.getByTestId("mode").textContent).toBe("hybrid");
    expect(
      (screen.getByRole("checkbox", { name: "Sources as footnotes" }) as HTMLInputElement).checked,
    ).toBe(true);
    cleanup();

    // Nonsense falls back rather than erroring: it changes presentation only.
    renderAt("/i/abc?citations=sideways");
    expect(screen.getByTestId("mode").textContent).toBe("links");
  });

  it("remembers the choice for this reader, and the URL still wins", () => {
    renderAt("/i/abc");
    fireEvent.click(screen.getByRole("checkbox", { name: "Sources as footnotes" }));
    cleanup();

    renderAt("/i/abc");
    expect(screen.getByTestId("mode").textContent).toBe("footnotes");
    cleanup();

    renderAt("/i/abc?citations=links");
    expect(screen.getByTestId("mode").textContent).toBe("links");
  });
});
