/* global URL */
import { fileURLToPath } from "node:url";
import { barrelImports } from "./barrelImports.mjs";

const at = (relative) => fileURLToPath(new URL(`../../${relative}`, import.meta.url));

/** The entries of the shared packages, as both shells' builds resolve them (`barrelImports.mjs`). */
export const PACKAGE_BARRELS = {
  "@plainva/core": at("packages/core/src/index.ts"),
  "@plainva/core/ai": at("packages/core/src/ai/index.ts"),
  "@plainva/core/import": at("packages/core/src/import/index.ts"),
  "@plainva/core/workspace": at("packages/core/src/workspace/index.ts"),
  "@plainva/ui": at("packages/ui/src/index.ts"),
  "@plainva/ui/ai": at("packages/ui/src/ai/index.ts"),
  "@plainva/ui/mail": at("packages/ui/src/mail/index.ts"),
};

/** The build plugin both shells use: named imports of an entry go to the defining module. */
export function packageBarrels() {
  return barrelImports(PACKAGE_BARRELS);
}
