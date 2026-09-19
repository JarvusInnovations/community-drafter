import { copy } from "./copy.ts";

/**
 * `specs/screens/admin-dashboard.md` § Navigation: "Sign-in via Google when
 * no session." A plain link to `/auth/login` — the server redirects to
 * Google (or bounces straight back via the dev bypass); there's nothing for
 * the SPA to orchestrate client-side.
 */
export function SignInScreen(): JSX.Element {
  const returnPath = `${window.location.pathname}${window.location.search}`;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold">{copy.signIn.heading}</h1>
      <p className="max-w-sm text-muted-foreground">{copy.signIn.body}</p>
      <a
        href={`/auth/login?return=${encodeURIComponent(returnPath.startsWith("/admin") ? returnPath : "/admin")}`}
        className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background"
      >
        {copy.signIn.button}
      </a>
    </main>
  );
}
