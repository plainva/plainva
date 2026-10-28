/**
 * The build the phone's production end-to-end tests run against, and only
 * that build (`vite build --mode e2e`, the `smoke:prod` script).
 *
 * It ships a standard Google sign-in, as a real build does - with the client
 * of the fake Google provider the tests answer every request with
 * (`packages/ui/src/testing/fakeOAuthProvider.ts`), so the standard path runs
 * end to end without a real Google project. A release build is built in its
 * own mode and never sees any of this: `e2eBuildEnv` gives nothing for any
 * other mode, and `e2eBuildIsolation.test.ts` holds the release workflows and
 * the `build` script to that.
 */
export const E2E_BUILD_MODE = "e2e";

/** The fake provider's iOS client: a shape Google accepts, a name no real project carries. */
export const E2E_STANDARD_GOOGLE_IOS_CLIENT_ID = "1234-plainva-test.apps.googleusercontent.com";

/** The environment the e2e build adds; empty for every other mode. */
export function e2eBuildEnv(mode) {
  if (mode !== E2E_BUILD_MODE) return {};
  return {
    VITE_PLAINVA_GOOGLE_IOS_CLIENT_ID: E2E_STANDARD_GOOGLE_IOS_CLIENT_ID,
    // Gmail through the standard sign-in, as a build whose Google project offers it.
    VITE_PLAINVA_GOOGLE_MAIL_STATE: "production",
  };
}

/** The same as Vite `define` entries: they join `import.meta.env`, which the app reads as a whole. */
export function e2eBuildDefine(mode) {
  return Object.fromEntries(Object.entries(e2eBuildEnv(mode)).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
}
