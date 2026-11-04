import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_STANDARD_GOOGLE_IOS_CLIENT_ID } from "../scripts/e2e-build-env.mjs";

/**
 * Before the production-build tests start: the bundle they run against is the
 * e2e build (Sammelplan § 3.171 Nr. 12).
 *
 * The tests of the standard Google sign-in (`account-sign-in.spec.ts`) need a
 * build made with `vite build --mode e2e` — it carries the client of the fake
 * provider the tests answer every request with (`scripts/e2e-build-env.mjs`).
 * A plain `vite build` leaves it out, as a release build must, and those tests
 * then failed far into their run with nothing that said why. `smoke:prod`
 * builds it right; this says so at once where `dist/` came from elsewhere.
 * Every built chunk is read for the client: it lands in the chunks of the
 * sign-in, wherever a bundler puts them.
 */
export default function bundleCheck(): void {
  const dist = join(fileURLToPath(new URL(".", import.meta.url)), "..", "dist", "assets");
  const build = "pnpm --filter mobile exec vite build --mode e2e (or run the whole thing with pnpm --filter mobile smoke:prod)";
  if (!existsSync(dist)) throw new Error(`apps/mobile/dist is missing — the production-build tests need the e2e build first: ${build}`);
  const chunks = readdirSync(dist).filter((name) => name.endsWith(".js"));
  const carries = chunks.some((name) => readFileSync(join(dist, name), "utf8").includes(E2E_STANDARD_GOOGLE_IOS_CLIENT_ID));
  if (!carries) {
    throw new Error(
      "apps/mobile/dist is not the e2e build: it lacks the fake provider's Google client, so the standard sign-in tests cannot pass. " +
        `Build it with ${build}. A release build must never carry it (e2eBuildIsolation.test.ts).`,
    );
  }
}
