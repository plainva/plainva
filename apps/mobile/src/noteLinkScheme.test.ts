import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetNoteLinkInbox, setNoteLinkHandler } from "@plainva/ui";

/**
 * Note links on the phone (F2, ADR 0037): the native projects register the
 * scheme — the store app `plainva`, the Labs build its own, so a Labs install
 * never takes the store app's links — and the app URL router hands such an
 * address to the shared inbox BEFORE the sign-in handlers, which would take
 * any address they do not know for an answer to a sign-in.
 */

vi.mock("./services/oauthService", () => ({ handleOAuthRedirect: vi.fn(async () => undefined) }));
vi.mock("./services/pim/pimOAuth", () => ({ handlePimOAuthRedirect: vi.fn(async () => false) }));

const MOBILE = join(__dirname, "..");
const read = (...parts: string[]) => readFileSync(join(MOBILE, ...parts), "utf8");

afterEach(() => resetNoteLinkInbox());

describe("the scheme the system knows", () => {
  it("Android: an intent filter for plainva://open, its scheme per build type", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('<data android:scheme="${noteLinkScheme}" android:host="open" />');
    const gradle = read("android/app/build.gradle");
    expect(gradle).toContain('manifestPlaceholders = [noteLinkScheme: "plainva"]');
    expect(gradle).toMatch(/labs \{[^}]*manifestPlaceholders \+= \[noteLinkScheme: "plainva-labs"\]/);
    expect(gradle).toMatch(/tlsTest \{[^}]*manifestPlaceholders \+= \[noteLinkScheme: "plainva-tlstest"\]/);
  });

  it("iOS: a URL type for the note links, after the app's own (which the sign-in reads first)", () => {
    const plist = read("ios", "App", "App", "Info.plist");
    const own = plist.indexOf("<string>$(PLAINVA_BUNDLE_BASE)</string>\n\t\t\t</array>");
    const note = plist.indexOf("<string>$(PLAINVA_NOTE_LINK_SCHEME)</string>");
    expect(own).toBeGreaterThan(0);
    expect(note).toBeGreaterThan(own);
    const project = read("ios", "App", "App.xcodeproj", "project.pbxproj");
    expect(project.match(/PLAINVA_NOTE_LINK_SCHEME = plainva;/g)).toHaveLength(2);
  });
});

describe("the router", () => {
  it("hands a note link to the inbox and nothing else", async () => {
    const { routeAppUrl } = await import("./services/appUrlRoutes");
    const { handleOAuthRedirect } = await import("./services/oauthService");
    const { handlePimOAuthRedirect } = await import("./services/pim/pimOAuth");
    const seen: string[] = [];
    setNoteLinkHandler((url) => seen.push(url));
    await routeAppUrl("plainva://open?vault=Work&path=Plan.md");
    await routeAppUrl("plainva-labs://open?path=Plan.md");
    expect(seen).toEqual(["plainva://open?vault=Work&path=Plan.md", "plainva-labs://open?path=Plan.md"]);
    expect(handleOAuthRedirect).not.toHaveBeenCalled();
    expect(handlePimOAuthRedirect).not.toHaveBeenCalled();
    await routeAppUrl("com.plainva.app://oauth?code=x");
    expect(handleOAuthRedirect).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(2);
  });
});
