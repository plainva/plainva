import { encodeMarkdownLinkPath } from "@plainva/core";
import type { TourStrings } from "./plainvaTour";
import type { VaultTemplateDefinition, VaultTemplateNote } from "./types";
import { userGuideUrl } from "../lib/docsLinks";
import en from "./tourLessons.en.json";
import de from "./tourLessons.de.json";
import fr from "./tourLessons.fr.json";
import es from "./tourLessons.es.json";
import it from "./tourLessons.it.json";
import nl from "./tourLessons.nl.json";
import pl from "./tourLessons.pl.json";
import pt from "./tourLessons.pt-BR.json";
import zh from "./tourLessons.zh-CN.json";
import ja from "./tourLessons.ja.json";

export const TOUR_DATA_VERSION = "2026-09-11";
const LESSONS: Record<string, typeof en> = { en, de, fr, es, it, nl, pl, "pt-BR": pt, "zh-CN": zh, ja };
export const tourLessons = (language: string): typeof en => LESSONS[language] ?? en;

const guidePages = [
  ["Notes_and_Markdown"], ["Tasks"], ["Databases_Base"], ["Databases_Base"],
  ["Calendar_and_Tasks"], ["Comments_and_Suggestions"], ["Backups_and_Versioning"],
  ["Search", "Graph", "Notes_and_Markdown", "OKF"],
  ["Import", "Sync_Setup", "Calendar_and_Tasks", "Email_Capture"],
  ["Security_and_Sharing", "Automation_and_Scripts"],
];

/** Learning material is data, not a runtime tour or a migration. All paths are
 * assembled from the selected language and written only during vault creation. */
export function addTourLearning(def: VaultTemplateDefinition, s: TourStrings, language: string): VaultTemplateDefinition {
  const l = tourLessons(language);
  const f = s.folders;
  const k = s.keys;
  const notePath = (folder: string, title: string) => `${folder}/${title}.md`;
  const link = (path: string, label = path.replace(/\.md$|\.base$/g, "").split("/").pop()!) =>
    `[${label}](${encodeMarkdownLinkPath(path).replace(/%7B%7Btoday(?:[+%-]|\d)*%7D%7D/g, token => decodeURIComponent(token))})`;
  const project = (i: number) => notePath(f.projects, s.samples.projects[i].title);
  const firstTask = notePath(f.tasks, s.samples.tasks[0].title);
  const cheat = notePath(f.resources, s.samples.resources[0].title);
  const journal = notePath(f.journal, "{{today}}");
  const review = notePath(l.folder, l.reviewTitle);
  const steps = l.steps.map((step, i) => notePath(l.folder, `${String(i + 1).padStart(2, "0")} ${step.title}`));
  const targets = [cheat, journal, project(0), s.baseFiles.quickNotes, journal, cheat, cheat,
    project(0), `${f.attachments}/tour-import.json`, s.welcome.file];
  const lessonNotes: VaultTemplateNote[] = l.steps.map((step, i) => ({
    path: steps[i],
    properties: { plainva: { tasks: false } },
    body: `# ${String(i + 1).padStart(2, "0")} ${step.title}\n\n` +
      `**${l.open}:** ${link(targets[i])}\n\n## ${l.try}\n\n${step.action}\n\n## ${l.result}\n\n${step.result}\n\n` +
      `## ${l.more}\n\n${step.extra.replace(/!\[\[[^\]]*skizze\.svg\|240\]\]/g, `\`![[${f.attachments}/skizze.svg|240]]\``)}\n\n` +
      (i === 7 ? `${link(review)}\n\n` : "") +
      guidePages[i].map((page, n) => `[${l.handbook}${guidePages[i].length > 1 ? ` ${n + 1}` : ""}](${userGuideUrl(page, language)})`).join(" · ") +
      `\n\n${i > 0 ? link(steps[i - 1], l.previous) + " · " : ""}${link(s.welcome.file, l.overview)}${i < steps.length - 1 ? " · " + link(steps[i + 1], l.next) : ""}\n`,
  }));
  const notes = def.notes.map(n => structuredClone(n));
  // Keep the welcome short: direct exploration remains a first-class entry.
  notes[0].body = `# ${s.welcome.title}\n\n${l.intro}\n\n${link(steps[0], l.steps[0].title)}\n\n` +
    `## ${s.welcomeSections.databases}\n\n${def.bases!.map(b => `- ${link(b.path)}`).join("\n")}\n\n` +
    `## ${l.overview}\n\n${steps.map((path, i) => `${i + 1}. ${link(path, l.steps[i].title)}`).join("\n")}\n\n${l.version}\n`;
  for (let i = 0; i < 2; i++) {
    notes.find(n => n.path === project(i))!.body += `\n![[${s.baseFiles.tasks}]]\n`;
  }
  notes.find(n => n.path === `${f.templates}/${s.templates.project.file}`)!.body += `\n![[${s.baseFiles.tasks}]]\n`;
  for (let i = 0; i < s.samples.tasks.length; i++) {
    const task = notes.find(n => n.path === notePath(f.tasks, s.samples.tasks[i].title))!;
    const props = task.properties!;
    props.effort = [120, 45, 90, 30, 30, 15, 20, 45, 30][i];
    const start = [-2, 2, 4, -6, 1, 6, -1, -6, 9][i];
    const end = [1, 3, 7, -3, 3, 8, 0, -4, 11][i];
    props[k.start] = `{{today${start === 0 ? "" : start > 0 ? `+${start}` : start}}}`;
    props[k.end] = `{{today${end === 0 ? "" : end > 0 ? `+${end}` : end}}}`;
    if (i === 1 || i === 2) props.blockedBy = [{ uid: `[[${notePath(f.tasks, s.samples.tasks[i - 1].title)}]]`, reltype: "FINISHTOSTART" }];
  }
  notes.push({ path: notePath(f.tasks, l.milestone), body: `# ${l.milestone}\n\n${link(project(0))}\n`, properties: {
    [k.done]: false, [k.status]: s.options.taskStatus[0], [k.project]: `[[${project(0)}]]`,
    [k.start]: "{{today+8}}", [k.due]: "{{today+8}}", effort: 0,
    blockedBy: [{ uid: `[[${notePath(f.tasks, s.samples.tasks[2].title)}]]`, reltype: "FINISHTOSTART" }],
  } });
  notes.push({ path: notePath(f.projects, l.emptyProject),
    body: `# ${l.emptyProject}\n\n${l.emptyProjectBody}\n\n![[${s.baseFiles.tasks}]]\n`,
    properties: { [k.status]: notes.find(n => n.path === project(1))!.properties![k.status] },
  });
  // Whole-note tag examples cover inline and frontmatter values, including a
  // child tag and a genuinely empty note. Metadata remains on ordinary files.
  s.samples.quickNotes.forEach((sample, i) => {
    const n = notes.find(n => n.path === notePath(f.quickNotes, sample.title))!;
    const pv = (n.properties!.plainva ?? {}) as Record<string, unknown>;
    if (i === 0) { pv.icon = "lucide:pin"; n.properties!.tags = ["tour"]; }
    if (i === 1) pv.icon = "🛒";
    if (i === 2) { pv.icon = "💡"; pv.header_color = "#2a7f7b"; n.properties!.tags = ["tour/ideas"]; }
    if (i === 4) pv.icon = "lucide:image";
    if (i === 5) { delete pv.icon; delete pv.header_color; n.body = n.body.replace(/#tour\b/g, ""); }
    n.properties!.plainva = pv;
    if (i < 5) n.properties!.labels = [i % 2 ? l.labels.colored : l.labels.tagged];
  });
  // Replace only freshly generated sample days. No later-open date shifting.
  const withoutDays = notes.filter(n => !n.path.startsWith(`${f.journal}/`));
  for (let offset = -3; offset <= 3; offset++) {
    const token = (d: number) => `{{today${d === 0 ? "" : d > 0 ? `+${d}` : d}}}`;
    const neighbors = [offset > -3 ? link(notePath(f.journal, token(offset - 1)), l.previous) : "",
      offset < 3 ? link(notePath(f.journal, token(offset + 1)), l.next) : ""].filter(Boolean).join(" · ");
    withoutDays.push({ path: notePath(f.journal, token(offset)), type: "Daily Note", properties: {
      [k.date]: token(offset), [k.mood]: s.options.mood[offset < 0 ? 1 : 0], [k.topics]: ["tour"],
    }, body: `# ${token(offset)}\n\n${neighbors}\n\n${offset < 0 ? l.journalPast : offset > 0 ? l.journalFuture : l.journalToday}\n\n${link(firstTask)}\n${offset === 0 ? `\n- [ ] ${l.captureTask}\n` : ""}` });
  }
  const dailyTemplate = withoutDays.find(n => n.path === `${f.templates}/${s.templates.daily.file}`)!;
  delete dailyTemplate.properties!.datum;
  dailyTemplate.properties![k.date] = "{{date}}";
  withoutDays.find(n => n.path === cheat)!.body += `\n${l.cheatExtra}\n\n[[${project(0)}|${s.samples.projects[0].title}]]\n\n![[${f.attachments}/skizze.svg|240]]\n`;
  // Keep lifecycle metadata outside the resource collection: some languages
  // already use `status` for that collection's unrelated reading progress.
  withoutDays.push({ path: review, body: `# ${l.reviewTitle}\n\n${l.reviewBody}\n`, properties: {
    status: "draft", stale_after: "{{today-1}}",
    sources: [{ resource: "https://example.invalid/plainva-tour/reading-evening", title: l.reviewTitle }],
  } });
  withoutDays.push({ path: notePath(f.resources, l.standaloneTitle), body: `# ${l.standaloneTitle}\n\n${l.standaloneBody}\n` });
  withoutDays.filter(n => n.path.startsWith(`${f.areas}/`)).forEach((n, i) => { n.properties![k.cover] = `${f.attachments}/cover${i % 3 ? `-${i % 3 + 1}` : ""}.svg`; });
  const rawFiles = [...def.rawFiles!];
  const cover = rawFiles.find(r => r.path.endsWith("/cover.svg"))!.content;
  rawFiles.push({ path: `${f.attachments}/cover-2.svg`, content: cover.replace(/#2a7f7b/g, "#b8813e").replace(/#174f52/g, "#744b29").replace('cx="392"', 'cx="230"') });
  rawFiles.push({ path: `${f.attachments}/cover-3.svg`, content: cover.replace(/#2a7f7b/g, "#7462ab").replace(/#174f52/g, "#403763").replace('cy="52"', 'cy="160"') });
  rawFiles.push({ path: `${f.attachments}/tour-import.json`, content: JSON.stringify({ activeNotes: [
    { id: "plainva-tour-import-1", content: `${l.reviewTitle}\n\n${l.reviewBody}`, tags: ["tour-import"] },
    { id: "plainva-tour-import-2", content: `${l.standaloneTitle}\n\n${l.standaloneBody}`, tags: ["tour-import"] },
  ], trashedNotes: [] }, null, 2) + "\n" });
  return { ...def, folders: [...def.folders, l.folder], notes: [...withoutDays, ...lessonNotes], rawFiles };
}
