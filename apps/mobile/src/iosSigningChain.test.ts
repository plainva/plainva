import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The iOS signing chain, as a test (plan Widgets, W7).
 *
 * Three bundles have to line up across four files that nothing else compares:
 * the Xcode project names a bundle id and a profile variable, the workflow
 * passes a secret and that variable, and two Python scripts check the profile
 * before and after the build. Miss one and the failure arrives as a signing
 * error at the end of a twenty-minute macOS run, or — worse — as an upload
 * Apple refuses.
 *
 * Textual, like the bridge guard next door: it runs in the ordinary suite on
 * any OS and catches the mistake at commit time instead of after a round trip.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "..", "..", "..");
const read = (rel: string) => readFileSync(resolve(repositoryRoot, rel), "utf8");

const BUNDLES = [
  { id: "com.plainva.app", variable: "PLAINVA_APP_PROFILE" },
  { id: "com.plainva.app.share", variable: "PLAINVA_SHARE_PROFILE" },
  { id: "com.plainva.app.widgets", variable: "PLAINVA_WIDGETS_PROFILE" },
] as const;

describe("iOS signing chain", () => {
  const installer = read("apps/mobile/scripts/install-ios-profiles.py");
  const verifier = read("apps/mobile/scripts/verify-ios-share-archive.py");
  const workflow = read(".github/workflows/ios.yml");

  for (const bundle of BUNDLES) {
    it(`${bundle.id} is known to the installer, the verifier and the workflow`, () => {
      expect(installer, "the installer validates this bundle's profile").toContain(`"${bundle.id}"`);
      expect(installer, "…and exports the variable the project signs with").toContain(`"${bundle.variable}"`);
      expect(verifier, "the archive check knows this bundle").toContain(`"${bundle.id}"`);
      expect(workflow, "xcodebuild is handed the variable").toContain(`${bundle.variable}="$${bundle.variable}"`);
    });
  }

  it("every bundle carries the shared App Group, before and after the build", () => {
    // The group is the only way an extension reaches the snapshot. A profile
    // without it builds, signs, uploads — and the widget stays empty forever.
    for (const source of [installer, verifier]) {
      expect(source).toContain('"group.com.plainva.app"');
    }
  });

  it("insists that no two bundles share one profile", () => {
    expect(installer).toContain("Two bundles share one profile");
    expect(verifier).toContain("Every bundle needs its own matching profile");
  });

  it("compiles every Swift file of the widget target", () => {
    // The trap this closes: a file that is on disk but not in project.pbxproj
    // simply is not built. Nothing warns, the archive is smaller, and the
    // widget behaves as if the code had never been written.
    const project = read("apps/mobile/ios/App/App.xcodeproj/project.pbxproj");
    const sources = readdirSync(resolve(repositoryRoot, "apps/mobile/ios/App/PlainvaWidgets")).filter((f) => f.endsWith(".swift"));
    expect(sources.length, "the widget target has sources").toBeGreaterThan(0);
    const missing = sources.filter((file) => !project.includes(`${file} in Sources */`));
    expect(missing, `these files are in PlainvaWidgets/ but not compiled: ${missing.join(", ")}`).toEqual([]);
    // The shared store is compiled into BOTH targets — one file, two build files.
    expect(project.match(/WidgetStore\.swift in Sources \*\/,/g) ?? []).toHaveLength(2);
    // ...and the extension is embedded, or it ships as a target nobody runs.
    expect(project).toContain("PlainvaWidgets.appex in Embed App Extensions");
  });

  it("keeps the widgets profile optional until its target exists", () => {
    // Before W4 there is no widget target, so a missing secret must not fail
    // the build - and once the secret IS there, a missing .appex must.
    expect(workflow).toContain("IOS_WIDGETS_PROVISIONING_PROFILE_BASE64");
    expect(workflow).toContain("PLAINVA_EXPECT_WIDGETS=1");
    expect(verifier).toContain("PLAINVA_EXPECT_WIDGETS");
    expect(verifier).toContain("PlainvaWidgets.appex is missing from the archive");
  });
});
