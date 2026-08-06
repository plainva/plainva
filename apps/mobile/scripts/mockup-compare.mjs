#!/usr/bin/env node
/**
 * Puts each captured surface next to the mockup section it is supposed to
 * match.
 *
 * This exists because of how the previous rework failed (N0.2). Its protocol
 * compared every step against the PREVIOUS step's screenshot. That proves a
 * step changed something; it never proves the result matches the target. A
 * surface that was 20% off in step 20 and untouched in step 21 reported
 * "0 diff" — and counted as confirmed. The accounts area went through fifteen
 * steps that way without ever taking the shape of the mockup.
 *
 * So the comparison here is deliberately NOT automatic. There is no pixel
 * diff, and there is no pass/fail: the mockup is a drawing of an idea, not a
 * rendering of this app, and any similarity score over it would be a number
 * that means nothing. What the tool does is remove every excuse for not
 * looking — it renders the mockup's own phone frames, lays them beside the
 * real capture, and carries the caption text (including its explicit "Vorher:"
 * lines, which name what the target replaces).
 *
 * The output is `compare.html`. The result of using it is a NAMED LIST OF
 * DEVIATIONS in the step log. "0 diff" is not an outcome this tool can produce.
 *
 *   node scripts/mockup-compare.mjs --shots screenshots/baseline
 *   node scripts/mockup-compare.mjs --shots screenshots/baseline --theme dark
 */

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * The mockup lives in the private workspace repo, one level above the app.
 * Keeping the path here rather than copying the file means the comparison can
 * never run against a stale duplicate.
 */
const MOCKUP = resolve(APP_DIR, "../../../docs/planning/mockups/Mobile_Neuentwurf_2026-08-02.html");

/**
 * Surface -> mockup section. A surface without an entry is reported as
 * UNMAPPED rather than skipped quietly: "no target picture" is a finding about
 * the mockup or about the surface, and both deserve to be seen.
 */
const SURFACE_SECTIONS = {
  onboarding: "s20",
  home: "s5",
  "home-folder": "s5",
  attachments: "s5",
  "empty-vault": "s5",
  "quick-create": "s5",
  "navigator-tags": "s5",
  "note-read": "s7",
  "note-edit": "s8",
  "note-menu": "s8",
  "note-context": "s9",
  search: "s6",
  "areas-sheet": "s3",
  today: "s10",
  tasks: "s11",
  "tab-tasks": "s11",
  "navigator-databases": "s12",
  "import-wizard": "s13",
  calendar: "s14",
  mail: "s15",
  graph: "s16",
  "tab-graph": "s16",
  settings: "s17",
  "settings-appearance": "s17",
  "settings-editor": "s17",
  "settings-about": "s17",
  "settings-behavior": "s17",
  "settings-content": "s17",
  "settings-backup": "s17",
  "settings-navbar": "s17",
  "settings-maintenance": "s17",
  "settings-sync": "s18",
  "settings-cloud-accounts": "s18",
  "cloud-accounts": "s18",
  "settings-pim": "s18",
  "settings-mail": "s18",
  vaults: "s18",
  "vault-detail": "s18",
  "vault-detail-cloud": "s18",
  "settings-security": "s19",
};

function parseArgs(argv) {
  const out = { shots: "screenshots/baseline", theme: "light", out: "screenshots/compare" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--shots") out.shots = argv[++i];
    else if (a === "--theme") out.theme = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

/** Renders the mockup and cuts out every phone frame, section by section. */
async function captureMockup(outDir) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  const shots = {};
  try {
    await page.goto(`file://${MOCKUP}`, { waitUntil: "networkidle" });
    const sections = await page.$$eval("section[id]", (nodes) =>
      nodes.map((n) => ({
        id: n.id,
        title: n.querySelector("h2")?.textContent?.trim() ?? n.id,
        stages: [...n.querySelectorAll(".stage")].map((stage) => ({
          heading: stage.querySelector(".cap h3")?.textContent?.trim() ?? "",
          // The caption paragraphs carry the intent — including the "Vorher:"
          // line, which states exactly what the target is meant to replace.
          notes: [...stage.querySelectorAll(".cap p")].map((p) => p.textContent.trim()),
          devices: stage.querySelectorAll(".dev").length,
        })),
      })),
    );

    for (const section of sections) {
      const frames = await page.$$(`#${section.id} .dev`);
      shots[section.id] = { ...section, images: [] };
      for (let i = 0; i < frames.length; i += 1) {
        const file = `${section.id}-${i}.png`;
        await frames[i].screenshot({ path: join(outDir, "mockup", file) }).catch(() => {});
        shots[section.id].images.push(file);
      }
    }
  } finally {
    await browser.close();
  }
  return shots;
}

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderHtml(rows, theme, shotsRel) {
  const body = rows
    .map((r) => {
      const target = r.section
        ? r.section.stages
            .map(
              (s) =>
                `<div class="stage"><h4>${esc(s.heading)}</h4>${s.notes
                  .map((n) => `<p class="${n.startsWith("Vorher:") ? "before" : ""}">${esc(n)}</p>`)
                  .join("")}</div>`,
            )
            .join("")
        : `<p class="unmapped">Keine Mockup-Zuordnung — als ungeprüft führen.</p>`;
      const targetImgs = r.section
        ? r.section.images.map((f) => `<img src="mockup/${f}" alt="">`).join("")
        : "";
      return `<section>
  <h2>${esc(r.surface)} <span class="sec">${esc(r.section ? `→ § ${r.section.title}` : "→ ohne Zuordnung")}</span></h2>
  <div class="cols">
    <div class="col"><h3>App</h3><img class="shot" src="${esc(r.shot)}" alt=""></div>
    <div class="col"><h3>Mockup</h3><div class="targets">${targetImgs}</div>${target}</div>
  </div>
  <div class="dev-note"><b>Abweichungen:</b> hier eintragen — „0 Diff" ist kein Ergebnis, das
  diese Gegenüberstellung erzeugen kann.</div>
</section>`;
    })
    .join("\n");

  return `<!doctype html><meta charset="utf-8"><title>Mockup-Vergleich (${esc(theme)})</title>
<style>
 body{font:15px/1.55 system-ui,sans-serif;margin:0;padding:24px;background:#f4f6f6;color:#16302e}
 h1{font-size:22px;margin:0 0 4px}
 .lede{color:#5c6b69;max-width:70ch;margin:0 0 24px}
 section{background:#fff;border:1px solid #dde5e4;border-radius:12px;padding:16px;margin:0 0 20px}
 section>h2{font-size:17px;margin:0 0 12px}
 .sec{font-weight:400;color:#5c6b69;font-size:14px}
 .cols{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}
 .col h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#5c6b69;margin:0 0 8px}
 img.shot{max-width:320px;width:100%;border:1px solid #dde5e4;border-radius:8px}
 .targets{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
 .targets img{max-width:210px;border-radius:8px}
 .stage{border-top:1px solid #eef2f2;padding-top:8px;margin-top:8px}
 .stage h4{margin:0 0 4px;font-size:14px}
 .stage p{margin:0 0 4px;color:#40514f;font-size:14px}
 .stage p.before{color:#8a4b3f}
 .unmapped{color:#8a4b3f}
 .dev-note{margin-top:12px;padding:8px 10px;background:#f4f6f6;border-radius:8px;color:#5c6b69;font-size:14px}
</style>
<h1>Mockup-Vergleich — Theme ${esc(theme)}</h1>
<p class="lede">Links die echte Aufnahme, rechts das Zielbild samt seiner eigenen Beschreibung.
Bewusst ohne Pixel-Diff und ohne Ampel: das Mockup ist eine Zeichnung, kein Rendering dieser App —
eine Ähnlichkeitszahl darüber wäre eine Zahl ohne Bedeutung. Das Ergebnis dieser Seite ist eine
<b>benannte Abweichungsliste</b> im Schritt-Log. Aufnahmen aus <code>${esc(shotsRel)}</code>.</p>
${body}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(APP_DIR, args.out);
  const shotsDir = resolve(APP_DIR, args.shots, args.theme);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, "mockup"), { recursive: true });

  const captured = (await readdir(shotsDir).catch(() => {
    throw new Error(`no captures in ${shotsDir} — run screenshot-baseline.mjs first`);
  }))
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""))
    .sort();
  if (captured.length === 0) throw new Error(`no PNGs in ${shotsDir}`);

  process.stdout.write("rendering the mockup…\n");
  const sections = await captureMockup(outDir);

  const rows = captured.map((surface) => ({
    surface,
    shot: relative(outDir, join(shotsDir, `${surface}.png`)),
    section: sections[SURFACE_SECTIONS[surface]] ?? null,
  }));

  await writeFile(join(outDir, "compare.html"), renderHtml(rows, args.theme, args.shots), "utf8");

  const unmapped = rows.filter((r) => !r.section).map((r) => r.surface);
  process.stdout.write(`${rows.length} surfaces -> ${join(outDir, "compare.html")}\n`);
  if (unmapped.length) {
    process.stdout.write(`without a mockup section (report as UNVERIFIED): ${unmapped.join(", ")}\n`);
  }
}

await main();
