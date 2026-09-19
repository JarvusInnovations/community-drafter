import { copy } from "./copy.ts";

/**
 * `plans/participant-sign-flow.md` § Approach: "error boundary renders the
 * 'link isn't available' page for 404." `specs/behaviors/access-and-identity.md`:
 * unknown, revoked and expired tokens all render this same generic page —
 * no detail here ever discloses which of those it was.
 */
export function NotFoundScreen(): JSX.Element {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold text-foreground">{copy.notFound.heading}</h1>
      <p className="text-muted-foreground">{copy.notFound.body}</p>
    </main>
  );
}
