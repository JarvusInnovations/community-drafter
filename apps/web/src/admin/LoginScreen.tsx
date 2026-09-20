import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";

import { requestLogin } from "./api.ts";
import { copy } from "./copy.ts";

/**
 * `/admin/login` — `specs/screens/admin-dashboard.md` § Sign-in: "one email
 * field and a button; after submit, always [the non-disclosing sentence]
 * ... No other text, no link to anything else." `POST /auth/login` itself
 * always 202s regardless of whether the address is an operator
 * (`specs/api/auth.md`), so this screen shows the same sentence
 * unconditionally — even a network failure never earns different text,
 * since that too could otherwise be read as a signal.
 */
export function LoginScreen(): JSX.Element {
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const returnPath = params.get("return") ?? undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await requestLogin(email.trim(), returnPath);
    } catch {
      // Deliberately ignored — see the doc comment above.
    }
    setSubmitting(false);
    setSent(true);
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <h1 className="text-2xl font-semibold">{copy.signIn.heading}</h1>
      {sent ? (
        <p role="status" className="max-w-sm text-muted-foreground">
          {copy.signIn.sent}
        </p>
      ) : (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex w-full max-w-sm flex-col gap-3"
        >
          <p className="text-muted-foreground">{copy.signIn.body}</p>
          <label className="text-left text-sm">
            {copy.signIn.emailLabel}
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full rounded border border-border p-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {submitting ? copy.signIn.submitting : copy.signIn.submit}
          </button>
        </form>
      )}
    </main>
  );
}
