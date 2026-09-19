/**
 * `bun test` preload (`bunfig.toml`) that registers a `happy-dom` DOM into
 * the global scope, so component tests can use `@testing-library/react`
 * (`render`, `screen`, `fireEvent`) exactly as they would under Jest/Vitest
 * with `jsdom`. Chosen per `jarvus-react`'s testing guidance
 * ("`@testing-library/react` + `happy-dom` via `bun add -d`, or a lighter
 * approach if that stack fights Bun") — it didn't fight Bun; no lighter
 * approach was needed.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
