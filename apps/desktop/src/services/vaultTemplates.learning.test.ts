import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { APP_LANGUAGES, getVaultTemplates, scaffoldVaultTemplate, parseBaseConfig, serializeBaseConfig, promoteTask } from "@plainva/ui";
import { VaultIndexer, VaultQueryService, upsertFrontmatterKeys, computeColumnSummaries, SimplenoteImporter, BackupVaultAdapter, VersionHistoryService, scanTasks } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { tourLessons } from "../../../../packages/ui/src/vaultTemplates/tourLearning";

describe("new tour learning material", () => {
  for (const { code } of APP_LANGUAGES) {
    it(`${code}: lessons, links, dates and real project calculations`, async () => {
      const def = getVaultTemplates(code).find(d => d.id === "plainva")!;
      const l = tourLessons(code);
      const dir = await mkdtemp(join(tmpdir(), "plainva-tour-test-"));
      const adapter = new LocalVaultAdapter(dir);
      const db = await realSqlite();
      try {
        await adapter.initialize();
        await scaffoldVaultTemplate({ adapter, isNewVault: true, template: def, vaultName: "Tour", subfoldersHeading: l.overview, now: new Date(2026, 11, 31) });
        const entries = await adapter.listDir("", true);
        const paths = new Set(entries.map(e => e.path));
        const lessons = def.notes.filter(n => n.path.startsWith(`${l.folder}/`) && /^\d{2} /.test(n.path.split("/").pop()!));
        expect(lessons).toHaveLength(10);
        for (const n of def.notes) {
          const path = n.path.replace(/\{\{today([+-]\d+)?\}\}/g, (_, offset) => {
            const date = new Date(2026, 11, 31 + Number(offset ?? 0));
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
          });
          const body = await adapter.readTextFile(path);
          expect(body, path).not.toContain("{{today");
          expect(body, path).not.toContain("%7B%7Btoday");
          // Internal Markdown and wiki targets, including aliases and embeds.
          // Bare [[ is an instruction to use completion, not a link.
          for (const m of body.matchAll(/\]\(([^)]+)\)|\[\[([^\]|#\n]+)(?:[|#][^\]]*)?\]\]/g)) {
            const target = decodeURI(m[1] ?? m[2]).split("#")[0];
            if (!target || /^(https?:|mailto:)/.test(target)) continue;
            const exists = paths.has(target) || paths.has(`${target}.md`) || [...paths].some(p => p.split("/").pop() === `${target}.md`);
            expect(exists, `${path} -> ${target}`).toBe(true);
          }
        }
        const days = entries.filter(e => e.path.startsWith(`${def.settings!.dailyNotesFolder}/`) && /\d{4}-\d{2}-\d{2}\.md$/.test(e.path));
        expect(days).toHaveLength(7);
        expect(days.some(d => d.path.endsWith("2027-01-03.md"))).toBe(true);
        const indexer = new VaultIndexer(adapter, db);
        await indexer.indexVaultFull();
        const query = new VaultQueryService(db);
        const projectBase = def.bases!.find(b => (b.config.columns as any).openTasks)!;
        const config = parseBaseConfig(serializeBaseConfig(projectBase.config));
        const projects = await query.queryDatabaseFiles(config);
        const emptyProject = projects.find(p => p["file.name"] === l.emptyProject)!;
        expect(emptyProject.openTasks).toBe(0);
        expect(emptyProject.plannedMinutes).toBeNull();
        const project = projects.find(p => p.openTasks === 4)!;
        expect(project, "four open tasks plus one finished sample").toBeDefined();
        expect(project.progress).toBe(20);
        expect(project.plannedMinutes).toBe(285);
        const taskConfig = parseBaseConfig(serializeBaseConfig(def.bases!.find(b => b.path === def.settings!.taskDatabase)!.config));
        expect(taskConfig.views.some((v: any) => v.type === "graph" && v.graphShowExternal)).toBe(true);
        const tasks = await query.queryDatabaseFiles(taskConfig);
        const task = tasks.find(t => t.effort === 120)!;
        const statusKey = Object.keys(taskConfig.columns).find(k => taskConfig.columns[k].input === "status")!;
        const doneKey = Object.keys(taskConfig.columns).find(k => taskConfig.columns[k].input === "checkbox")!;
        const statusOptions = taskConfig.columns[statusKey].options;
        const doneStatus = statusOptions[statusOptions.length - 1].value;
        await adapter.writeTextFile(task["file.path"], upsertFrontmatterKeys(await adapter.readTextFile(task["file.path"]), { [doneKey]: true, [statusKey]: doneStatus }));
        await indexer.indexVaultFull();
        const changed = (await query.queryDatabaseFiles(config)).find(p => p["file.path"] === project["file.path"])!;
        expect(changed.openTasks).toBe(3);
        expect(changed.progress).toBe(40);
        expect(changed.plannedMinutes).toBe(285);
        const text = await adapter.readTextFile(project["file.path"]);
        expect(text).not.toContain("openTasks:");
        expect(computeColumnSummaries([changed], ["plannedMinutes"], { plannedMinutes: "Sum" }).plannedMinutes.value).toBe(285);
        // The introductory checkbox becomes a task through the same promotion
        // flow as both shells; assigning its project updates the reverse link.
        const todayPath = `${def.settings!.dailyNotesFolder}/2026-12-31.md`;
        const checkbox = scanTasks(await adapter.readTextFile(todayPath))[0];
        const promoted = await promoteTask({ adapter, sourcePath: todayPath, task: checkbox,
          dbPath: def.settings!.taskDatabase!, noteType: "Note", allNotePaths: [...paths], fallbackTitle: l.captureTask });
        expect(promoted.ok).toBe(true);
        if (!promoted.ok) throw new Error(promoted.reason);
        expect(scanTasks(await adapter.readTextFile(todayPath))).toHaveLength(0);
        const projectKey = Object.keys(taskConfig.columns).find(k => taskConfig.columns[k].relationBase === projectBase.path)!;
        await adapter.writeTextFile(promoted.notePath, upsertFrontmatterKeys(await adapter.readTextFile(promoted.notePath), {
          [projectKey]: `[[${project["file.path"]}]]`,
        }));
        await indexer.indexVaultFull();
        expect((await query.queryDatabaseFiles(taskConfig)).some(row => row["file.path"] === promoted.notePath)).toBe(true);
        expect((await query.queryDatabaseFiles(config)).find(row => row["file.path"] === project["file.path"])!.openTasks).toBe(4);
        // Exercise the actual importer on the shipped attachment. It must
        // create two notes in a separate folder and leave the tour intact.
        const sample = def.rawFiles!.find(f => f.path.endsWith("tour-import.json"))!;
        const payload = JSON.parse(await adapter.readTextFile(sample.path));
        const importer = new SimplenoteImporter();
        const options = { targetVaultPath: dir, targetSubfolder: "Tour import", vaultAdapter: adapter };
        expect((await importer.analyze(payload, options)).totalNotes).toBe(2);
        const report = await importer.run(payload, options);
        expect(report.importedNotesCount).toBe(2);
        expect(await adapter.readTextFile(project["file.path"])).toBe(text);

        // History comes from real writes through the same backup adapter as
        // both shells. Only the clock advances past the normal interval.
        const path = def.notes[0].path;
        const original = await adapter.readTextFile(path);
        let clock = Date.now();
        const backed = new BackupVaultAdapter(adapter, { now: () => clock });
        const history = new VersionHistoryService(adapter);
        expect(await history.listVersions(path)).toHaveLength(0);
        await backed.writeTextFile(path, `${original}\nMy first edit.\n`);
        clock += 121_000;
        await backed.writeTextFile(path, `${original}\nMy second edit.\n`);
        const versions = await history.listVersions(path);
        expect(versions).toHaveLength(2);
        expect(await history.readVersionText(versions[0].backupPath)).toContain("My first edit.");
        await history.restoreVersion({ backupPath: versions[1].backupPath, targetPath: "Restored copy.md", writeAdapter: backed });
        expect(await adapter.readTextFile("Restored copy.md")).toBe(original);
        expect(await adapter.readTextFile(path)).toContain("My second edit.");
        // A newer definition is never applied to this existing vault, even if
        // untouched. No added lesson and no settings write follows a rejection.
        const before = await adapter.readTextFile(def.notes[0].path);
        await expect(scaffoldVaultTemplate({ adapter, isNewVault: false, template: def, vaultName: "Tour", subfoldersHeading: l.overview })).rejects.toThrow();
        expect(await adapter.readTextFile(def.notes[0].path)).toBe(before);
      } finally {
        await db.close();
        if (dirname(resolve(dir)) === resolve(tmpdir())) await rm(dir, { recursive: true, force: true });
      }
    }, 30_000);
  }
});
