import { AI_POLICY_DIMENSIONS, type VaultQueryService } from "@plainva/core";
import {
  calendarDay,
  capturedNotePath,
  captureVocabularyOf,
  createTaskInDatabase,
  dailyNotePathFor,
  flushPendingSave,
  machineProposals,
  noteDisplayName,
  noteMovePlan,
  noteRenamePlan,
  notifyFileOps,
  parseTaskCapture,
  prepareTaskNote,
  profileDefault,
  proposeSuggestionRound,
  withNoteRule,
  type DraftCreator,
  type OpenProposal,
  type VaultPolicyHost,
  type VaultWriteDeps,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { confirmDeleteFile } from "../../lib/deleteFile";
import { mobileCommentOperations } from "../commentOperations";
import { appendPlannedJournalEntry, journalHeading } from "../journalService";
import { listAllMobileComments } from "../mobileComments";
import { getMobileSettings } from "../mobileSettings";
import { providerListLabel, sendTaskToProviderList } from "../pim/taskToProvider";
import { vaultOps, type MobileVault } from "../vaultService";

/**
 * What the phone does for the assistant's writing tools (plan KI-Harness P5).
 * Each act is the phone's own way of doing that thing: a rename and a move
 * through `vaultOps` (unsaved text first, links and the index after), a
 * deletion through the sheet every delete goes through, a task through the
 * task database, a line through the journal. The assistant itself changes
 * nothing — it proposes, drafts, or asks.
 */

const vocabulary = () => captureVocabularyOf((key) => i18n.t(key), i18n.language);
const inboxFolder = () => getMobileSettings().inboxFolder.trim() || (profileDefault<string>("inboxFolder") ?? "Inbox");

/** A day key as the middle of that day: the daily note of a day does not depend on the hour. */
function dayAtNoon(day: string): Date | null {
  const date = new Date(`${day}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mobileWriteDeps(vault: MobileVault, query: VaultQueryService, read: (path: string) => Promise<string | null>): VaultWriteDeps {
  const exists = (path: string) => vault.files.exists(path).catch(() => false);
  return {
    sealed: () => vault.workspaceRuntime !== null,
    async current(path) {
      // The editor's pending keystrokes land first: a proposal is made against the note as it is.
      if (/\.md$/i.test(path)) await flushPendingSave(path);
      return read(path);
    },
    async propose(round) {
      await proposeSuggestionRound(mobileCommentOperations(vault), round);
    },
    folderExists: async (folder) => !folder || (await exists(folder)),
    taskVocabulary: vocabulary,
    // Where a task or a journal line would land, for the rules of that place: the task database's folder, the daily note.
    async draftPlace(kind, day) {
      const settings = getMobileSettings();
      const taskDb = settings.taskDatabase.trim();
      if (kind === "task" && taskDb) {
        const prepared = await prepareTaskNote({ adapter: { readTextFile: (path: string) => vaultOps.read(vault, path), exists }, dbPath: taskDb, title: "task", noteType: settings.defaultNoteType });
        return prepared.ok ? `${prepared.folder}/task.md` : null;
      }
      // Without a task database a task is a line in the journal.
      const date = dayAtNoon(day);
      return date ? dailyNotePathFor(date, { folder: settings.dailyFolder, format: settings.dailyFormat }) : null;
    },
    renamePlan: (path, title) => noteRenamePlan(query, exists, path, title),
    async rename(path, title) {
      try {
        return await vaultOps.rename(vault, path, title);
      } catch {
        return null;
      }
    },
    movePlan: (path, folder) => noteMovePlan(exists, path, folder),
    async move(path, folder) {
      try {
        const moved = await vaultOps.moveNote(vault, path, folder);
        return moved === path ? null : moved;
      } catch {
        return null;
      }
    },
    // The assistant never deletes: this opens the sheet every delete on the phone goes through, and that one decides.
    requestDelete: (path) => confirmDeleteFile(vault, path, noteDisplayName(path), i18n.t.bind(i18n)),
    // A rule of the note itself, after the user's yes: saved through the conflict-aware chain, synced like any edit.
    async setRule(path, rule, set) {
      await flushPendingSave(path);
      const text = await read(path);
      if (text === null) return false;
      const next = withNoteRule(text, rule, set);
      if (next === text) return false;
      await vaultOps.save(vault, path, next);
      return true;
    },
  };
}

export function mobileDraftCreator(vault: MobileVault, policy: VaultPolicyHost): DraftCreator {
  const journal = async (entry: { text: string; day: string; time: string; task: boolean }): Promise<string> =>
    appendPlannedJournalEntry(vault, { date: entry.day, time: entry.time, heading: journalHeading(), text: entry.text, ...(entry.task ? { task: true } : {}) });
  return {
    note: ({ folder, stem, content }) => vaultOps.createNoteWithContent(vault, folder ?? inboxFolder(), stem, content),
    async taskList() {
      const taskDb = getMobileSettings().taskDatabase.trim();
      return taskDb ? providerListLabel({ readTextFile: (path: string) => vaultOps.read(vault, path) }, taskDb) : null;
    },
    async task({ text, day, atProvider }) {
      const settings = getMobileSettings();
      const taskDb = settings.taskDatabase.trim();
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      // Without a task database a task is what it is everywhere else in Plainva: a line with an open box, in the journal.
      if (!taskDb) return journal({ text, day: day || calendarDay(now), time, task: true });
      const adapter = {
        readTextFile: (path: string) => vaultOps.read(vault, path),
        writeTextFile: (path: string, content: string) => vaultOps.save(vault, path, content),
        exists: (path: string) => vault.files.exists(path),
      };
      // The same reading as a line typed into the capture field — with "today" being the day it was drafted.
      const read = parseTaskCapture(text, vocabulary(), day);
      const created = await createTaskInDatabase({
        adapter,
        dbPath: taskDb,
        title: read.title.trim() || text,
        noteType: settings.defaultNoteType,
        ...(read.due ? { dueDate: read.due, dueMinutes: read.minutes } : {}),
        tags: read.tags,
        priority: read.priority,
        repeat: read.repeat,
      });
      if (!created.ok) throw new Error(created.reason);
      notifyFileOps([{ type: "create", path: created.notePath }]);
      // …and in the provider list the task database names, where the card's chip stayed on (C4, S17): through the one
      // service every way of creating a task uses. The note exists; a failure there is reported and never costs it.
      if (atProvider) void sendTaskToProviderList(adapter, taskDb, created.notePath, read.title.trim() || text, read.due ?? undefined);
      return created.notePath;
    },
    journal,
    async placeDenies(folder, stem) {
      const effective = await policy.policyOf(capturedNotePath(folder ?? inboxFolder(), stem), "");
      return AI_POLICY_DIMENSIONS.filter((dimension) => effective.policy[dimension] === "deny");
    },
  };
}

/** The notes of the vault that carry open suggestions of a machine, from the phone's own comment store. */
export async function mobileProposals(vault: MobileVault): Promise<OpenProposal[]> {
  return machineProposals(await listAllMobileComments(vault));
}
