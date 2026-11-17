import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkLinuxTree, checkMacApp, desktopCommand, desktopExec, HELPER, MAIN, partSizes, plistString } from "../scripts/package-entry.mjs";

// 0.9.0 is the first release with two programs in every package: the app and
// the MCP helper. Review of the rehearsal, 2026-11-16: the AppImage check
// took the first executable under usr/bin as "the binary" and reported the
// helper. What a package starts is now read from every built package, and
// one package per platform is started (release.yml, "The packages start the
// main program").
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

let dirs: string[] = [];
const tree = (files: Record<string, string | { text: string; exec: true }>) => {
  const dir = mkdtempSync(join(tmpdir(), "package-entry-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : content.text);
    if (typeof content !== "string") chmodSync(full, 0o755);
  }
  return dir;
};
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

const program = { text: "#!/bin/sh\n", exec: true } as const;
const desktop = (exec: string) => `[Desktop Entry]\nName=Plainva\nExec=${exec}\nType=Application\n`;
const plist = (exe: string) =>
  `<?xml version="1.0"?><plist version="1.0"><dict>\n<key>CFBundleExecutable</key>\n<string>${exe}</string>\n<key>CFBundleName</key><string>Plainva</string></dict></plist>`;

describe("the names", () => {
  it("are the two binaries of Cargo.toml, the app being default-run", () => {
    const cargo = read("apps/desktop/src-tauri/Cargo.toml");
    expect(cargo).toMatch(new RegExp(`^default-run = "${MAIN}"$`, "m"));
    expect(cargo).toMatch(new RegExp(`^name = "${MAIN}"$`, "m"));
    expect(read(`apps/desktop/src-tauri/src/bin/${HELPER}.rs`).length).toBeGreaterThan(0);
  });

  it("are the same in the Windows check", () => {
    const ps1 = read("apps/desktop/scripts/check-package-entry.ps1");
    expect(ps1).toContain(`$main = '${MAIN}.exe'`);
    expect(ps1).toContain(`$helper = '${HELPER}.exe'`);
    expect(read("apps/desktop/scripts/check-appimage.sh")).toContain(`for program in ${MAIN} ${HELPER}; do`);
    expect(read("apps/desktop/scripts/check-package-entry.sh")).toContain(`main=${MAIN}\n`);
    expect(read("apps/desktop/scripts/package-start-linux.sh")).toContain(`main=${MAIN}\n`);
  });
});

describe("reading an entry", () => {
  it("takes the program an Exec line starts", () => {
    expect(desktopExec(desktop("plainva-desktop %U"))).toBe("plainva-desktop");
    expect(desktopExec(desktop("/usr/bin/plainva-desktop"))).toBe("plainva-desktop");
    expect(desktopExec(desktop('"/opt/Plainva/plainva-mcp" --stdio'))).toBe("plainva-mcp");
    expect(desktopExec("[Desktop Entry]\nName=x\n")).toBeUndefined();
  });

  it("reads an Exec key as a launcher does", () => {
    // Only the [Desktop Entry] group; a desktop action has an Exec of its own.
    expect(desktopExec("[Desktop Action new]\nExec=plainva-mcp\n[Desktop Entry]\nExec = plainva-desktop %U\n")).toBe("plainva-desktop");
    expect(desktopExec("[Desktop Entry]\r\nExec=plainva-desktop\r\n")).toBe("plainva-desktop");
    expect(desktopExec("[Desktop Action new]\nExec=plainva-desktop\n")).toBeUndefined();
    // A launcher's own env prefix is read through.
    expect(desktopCommand(desktop("env GDK_BACKEND=x11 -u FOO -i /usr/bin/plainva-desktop %U"))).toEqual({ words: ["/usr/bin/plainva-desktop", "%U"] });
    // Quoted words with escapes, and the \s string escape.
    expect(desktopCommand(desktop('"/opt/My App/plainva-desktop" "a \\\\"b\\\\""'))).toEqual({ words: ["/opt/My App/plainva-desktop", 'a "b"'] });
    expect(desktopCommand(desktop("/opt/plainva\\sdesktop"))).toEqual({ words: ["/opt/plainva", "desktop"] });
  });

  it("says why it does not read an Exec key, instead of guessing", () => {
    expect(desktopCommand("[Desktop Entry]\nName=x\n")).toEqual({ error: "no Exec key in its [Desktop Entry] group" });
    expect(desktopCommand(desktop('"/opt/plainva-desktop'))).toEqual({ error: 'its Exec value has an unclosed quote: "/opt/plainva-desktop' });
    expect(desktopCommand(desktop("env -C /opt plainva-desktop"))).toEqual({ error: "its Exec runs env with the option -C, which this check does not read" });
    expect(desktopCommand(desktop("env FOO=1"))).toEqual({ error: "its Exec runs env without a program" });
    expect(desktopCommand(desktop(""))).toEqual({ error: "its Exec value is empty" });
  });

  it("takes a string of a property list", () => {
    expect(plistString(plist("plainva-desktop"), "CFBundleExecutable")).toBe("plainva-desktop");
    expect(plistString(plist("plainva-desktop"), "CFBundleIconFile")).toBeUndefined();
    // The value as written (a plist string keeps its spaces), entities decoded; an impossible code point stays as written.
    expect(plistString("<dict><key>CFBundleExecutable</key>\n<string> a&amp;b&#x41;&#99999999; </string></dict>", "CFBundleExecutable")).toBe(" a&bA&#99999999; ");
    expect(plistString("<dict><key> CFBundleExecutable </key><string>x</string></dict>", "CFBundleExecutable")).toBeUndefined();
    expect(plistString("<dict><key>CFBundleExecutable</key><string/></dict>", "CFBundleExecutable")).toBe("");
  });
});

// The trees below rest on POSIX execute bits and forward-slash paths; the scripts that read
// real packages this way run on Linux and macOS only (Windows: check-package-entry.ps1).
const onPosix = describe.skipIf(process.platform === "win32");

onPosix("a Linux package", () => {
  const good = { "usr/bin/plainva-desktop": program, "usr/bin/plainva-mcp": program, "usr/share/applications/Plainva.desktop": desktop("plainva-desktop") };

  it("passes when it carries both and its entry starts the app", () => {
    expect(checkLinuxTree(tree(good))).toEqual([]);
    expect(checkLinuxTree(tree({ ...good, AppRun: program, "Plainva.desktop": desktop("plainva-desktop") }), { appimage: true })).toEqual([]);
  });

  it("fails without the helper, with an entry on the helper, or without an entry", () => {
    const { "usr/bin/plainva-mcp": _helper, ...noHelper } = good;
    expect(checkLinuxTree(tree(noHelper))).toEqual(["usr/bin/plainva-mcp is missing or not executable"]);
    expect(checkLinuxTree(tree({ ...good, "usr/share/applications/Plainva.desktop": desktop("plainva-mcp") }))).toEqual([
      "usr/share/applications/Plainva.desktop starts plainva-mcp, not plainva-desktop",
    ]);
    const { "usr/share/applications/Plainva.desktop": _entry, ...noEntry } = good;
    expect(checkLinuxTree(tree(noEntry))).toEqual(["no .desktop file"]);
  });

  it("fails an AppImage whose root entry or AppRun is wrong", () => {
    expect(checkLinuxTree(tree({ ...good, "Plainva.desktop": desktop("plainva-mcp") }), { appimage: true })).toEqual([
      "Plainva.desktop starts plainva-mcp, not plainva-desktop",
      "AppRun is missing or not executable",
    ]);
  });

  it("names an entry it cannot read or does not understand, and does not crash", () => {
    const dir = tree(good);
    symlinkSync(join(dir, "nowhere.desktop"), join(dir, "usr/share/applications/Broken.desktop"));
    expect(checkLinuxTree(dir)).toEqual(["usr/share/applications/Broken.desktop cannot be read (ENOENT)"]);
    expect(checkLinuxTree(tree({ ...good, "usr/share/applications/Plainva.desktop": desktop("env -C /opt plainva-desktop") }))).toEqual([
      "usr/share/applications/Plainva.desktop: its Exec runs env with the option -C, which this check does not read",
    ]);
  });

  it("fails a program that is not executable", () => {
    expect(checkLinuxTree(tree({ ...good, "usr/bin/plainva-desktop": "#!/bin/sh\n" }))).toEqual(["usr/bin/plainva-desktop is missing or not executable"]);
  });
});

onPosix("a macOS app", () => {
  const good = { "Contents/Info.plist": plist("plainva-desktop"), "Contents/MacOS/plainva-desktop": program, "Contents/MacOS/plainva-mcp": program };

  it("passes when CFBundleExecutable is the app and the helper is next to it", () => {
    expect(checkMacApp(tree(good))).toEqual([]);
  });

  it("fails when the bundle starts the helper or the helper is missing", () => {
    expect(checkMacApp(tree({ ...good, "Contents/Info.plist": plist("plainva-mcp") }))).toEqual(["CFBundleExecutable is plainva-mcp, not plainva-desktop"]);
    const { "Contents/MacOS/plainva-mcp": _helper, ...noHelper } = good;
    expect(checkMacApp(tree(noHelper))).toEqual(["Contents/MacOS/plainva-mcp is missing or not executable"]);
    expect(checkMacApp(tree({}))).toEqual(["Contents/Info.plist is missing"]);
    expect(checkMacApp(tree({ ...good, "Contents/Info.plist": "<dict><key>CFBundleExecutable</key><string/></dict>" }))).toEqual([
      "CFBundleExecutable is empty, not plainva-desktop",
    ]);
  });

  it("reads a binary Info.plist through plutil, and says so where it cannot", () => {
    const binary = { ...good, "Contents/Info.plist": "bplist00\u0000\u0001" };
    expect(checkMacApp(tree(binary), { convert: () => plist("plainva-desktop") })).toEqual([]);
    expect(checkMacApp(tree(binary), { convert: () => plist("plainva-mcp") })).toEqual(["CFBundleExecutable is plainva-mcp, not plainva-desktop"]);
    const problems = checkMacApp(tree(binary), {
      convert: () => {
        throw new Error("plutil: not found");
      },
    });
    expect(problems).toEqual(["Contents/Info.plist is a binary property list and plutil could not read it (plutil: not found)"]);
  });
});

onPosix("the record of the new parts", () => {
  it("lists the app, the helper and the ONNX Runtime library by size, wherever they are", () => {
    const dir = tree({
      "usr/bin/plainva-desktop": program,
      "usr/bin/plainva-mcp": { text: "1234567", exec: true },
      "usr/lib/Plainva/resources/onnxruntime/libonnxruntime.so": "12345",
      "usr/lib/Plainva/resources/onnxruntime/LICENSE": "x",
      "Contents/Frameworks/libonnxruntime.dylib": "123",
      "onnxruntime/onnxruntime.dll": "12",
    });
    expect(partSizes(dir)).toEqual([
      { path: "Contents/Frameworks/libonnxruntime.dylib", bytes: 3 },
      { path: "onnxruntime/onnxruntime.dll", bytes: 2 },
      { path: "usr/bin/plainva-desktop", bytes: 10 },
      { path: "usr/bin/plainva-mcp", bytes: 7 },
      { path: "usr/lib/Plainva/resources/onnxruntime/libonnxruntime.so", bytes: 5 },
    ]);
  });
});

describe("in the release workflow", () => {
  type Step = { name?: string; if?: string; run?: string };
  const workflow = parse(read(".github/workflows/release.yml")) as { jobs: Record<string, { steps: Step[] }> };
  const steps = (job: string) => workflow.jobs[job].steps;
  const named = (job: string, name: string) => steps(job).find((s) => s.name === name);

  it("runs on the tag path and in the rehearsal, after the file check, for every leg", () => {
    for (const job of ["release", "rehearsal"]) {
      const step = named(job, "The packages start the main program");
      expect(step, job).toBeDefined();
      expect(step!.run).toContain("pwsh -NoProfile -File apps/desktop/scripts/check-package-entry.ps1");
      expect(step!.run).toContain('bash apps/desktop/scripts/check-package-entry.sh "${{ matrix.platform }}"');
      const names = steps(job).map((s) => s.name);
      expect(names.indexOf("The packages start the main program")).toBeGreaterThan(names.indexOf("Every release file was built"));
    }
    expect(named("release", "The packages start the main program")!.if).toBe(named("release", "Build Tauri App")!.if);
    expect(named("rehearsal", "The packages start the main program")!.if).toBeUndefined();
  });

  it("has rpm, rpm2cpio, Xvfb, D-Bus and xwininfo/xprop on the Linux runner of both paths", () => {
    for (const job of ["release", "rehearsal"]) {
      expect(named(job, "Install dependencies (ubuntu only)")!.run).toMatch(/apt-get install -y .*\bxvfb rpm rpm2cpio dbus x11-utils$/m);
    }
  });

  it("keeps the rehearsal's file list after a red check, as long as the build made every file", () => {
    expect(named("rehearsal", "List what a release would have uploaded")!.if).toBe("always() && steps.built.outcome == 'success'");
    expect((steps("rehearsal").find((s) => s.name === "Every release file was built") as Step & { id?: string }).id).toBe("built");
  });
});
