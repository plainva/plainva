import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ID, APP_URL } from "./services/appScheme";

/**
 * The app's identity is its id, never a literal (Labs channel,
 * docs/engineering/Labs_Channel.md).
 *
 * Plainva Labs installs as com.plainva.app.labs next to the store app. Every
 * place that spelled "com.plainva.app://" by hand — a widget tap, a launcher
 * shortcut, an OAuth redirect — would open the store app from Labs, or hand it
 * Labs' OAuth code. So the class is closed at the source: Android derives the
 * scheme from the application id, iOS from the build setting via Info.plist,
 * the web layer from appScheme.ts. This guard fails the next literal.
 */

const MOBILE = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(MOBILE, ...parts), "utf8");

function files(dir: string, extension: string): string[] {
  return readdirSync(join(MOBILE, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => relative(MOBILE, join(entry.parentPath, entry.name)));
}

// A quoted literal that starts an app URL: "com.plainva.app:/… or "com.plainva.app://…
// (backticks are left out: comments quote the URLs that way).
const LITERAL_APP_URL = /["']com\.plainva\.app:\//;

describe("app identity", () => {
  it("the web layer's scheme defaults to the store app", () => {
    expect(APP_ID).toBe("com.plainva.app");
    expect(APP_URL).toBe("com.plainva.app://");
  });

  it("no source spells an app URL by hand", () => {
    const sources = [
      ...files("src", ".ts").filter((file) => !file.includes(".test.")),
      ...files("src", ".tsx").filter((file) => !file.includes(".test.")),
      ...files("android/app/src/main/java", ".java"),
      ...files("ios/App/App", ".swift"),
      ...files("ios/App/PlainvaWidgets", ".swift"),
      ...files("ios/App/ShareExtension", ".swift"),
      ...files("ios/App/Shared", ".swift"),
    ];
    expect(sources.length).toBeGreaterThan(50);
    const offenders = sources.filter((file) => LITERAL_APP_URL.test(read(file)));
    expect(offenders, "build the URL from APP_URL / getPackageName() / widgetURLScheme").toEqual([]);
  });

  it("Android answers on its application id, and the labs build type has its own", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('<data android:scheme="${applicationId}" />');
    expect(manifest).not.toContain('android:scheme="com.plainva.app"');
    const gradle = read("android/app/build.gradle");
    expect(gradle).toMatch(/labs \{\s*initWith release\s*applicationIdSuffix '\.labs'/);
    const strings = read("android/app/src/labs/res/values/strings.xml");
    expect(strings).toContain('<string name="app_name">Plainva Labs</string>');
    expect(strings).toContain('<string name="custom_url_scheme">com.plainva.app.labs</string>');
  });
});
