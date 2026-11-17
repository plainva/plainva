import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkLinuxTree, checkMacApp, desktopExec, HELPER, MAIN, partSizes, plistString } from "../scripts/package-entry.mjs";

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
    expect(read("apps/desktop/scripts/package-start-linux.sh")).toContain(`main=${MAIN}\ntitle=Plainva\n`);
  });

  it("looks for the window title the app sets", () => {
    const conf = JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")) as { app: { windows: { title: string }[] } };
    expect(conf.app.windows[0].title).toBe("Plainva");
  });
});

describe("reading an entry", () => {
  it("takes the program an Exec line starts", () => {
    expect(desktopExec(desktop("plainva-desktop %U"))).toBe("plainva-desktop");
    expect(desktopExec(desktop("/usr/bin/plainva-desktop"))).toBe("plainva-desktop");
    expect(desktopExec(desktop('"/opt/Plainva/plainva-mcp" --stdio'))).toBe("plainva-mcp");
    expect(desktopExec("[Desktop Entry]\nName=x\n")).toBeUndefined();
  });

  it("takes a string of a property list", () => {
    expect(plistString(plist("plainva-desktop"), "CFBundleExecutable")).toBe("plainva-desktop");
    expect(plistString(plist("plainva-desktop"), "CFBundleIconFile")).toBeUndefined();
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

  it("has rpm2cpio, Xvfb, D-Bus and xwininfo on the Linux runner of both paths", () => {
    for (const job of ["release", "rehearsal"]) {
      expect(named(job, "Install dependencies (ubuntu only)")!.run).toMatch(/apt-get install -y .*\bxvfb rpm2cpio dbus x11-utils$/m);
    }
  });
});
