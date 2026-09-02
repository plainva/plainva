import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  Check,
  Code,
  FolderInput,
  MoreVertical,
  Paintbrush,
  PanelRight,
  Pencil,
  FileX,
  FilePlus2,
  Search,
  MessageSquare,
  Mail,
  Send,
  Paperclip,
  FileDown,
  Share2,
  Smile,
  Trash2,
} from "lucide-react";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";
import { buildMailtoUrl, type MailAttachment } from "@plainva/ui/mail";
import { getCanDock, subscribeWindowClass } from "../services/windowClass";
import { type AnchorFrameHint, type AnchorHighlight, Banner, Button, commentTaskReply, commentTaskTitle, commentTaskTrailer, createTaskInDatabase, EmptyState, errorText, Fab, formatStampDate, frontmatterBlockOf, ICON, IconButton, markdownToPlainText, propertyAliasResolver, resolveOpenAction, saveNoteAsTemplateIn, staleSinceOf, toast, toAnchorFrameHint, trustSignalsFromBlock } from "@plainva/ui";
import { exportNoteAsMarkdown, mailNoteAsAttachment } from "../services/exportNote";
import { writeOverview } from "../services/indexOverviews";
import { sendTaskToProviderList } from "../services/pim/taskToProvider";
import { mConfirm } from "../services/mobileDialogs";
import { buildCommentAnchor, buildPropertyCommentAnchor, createWorkspaceObjectId, effectiveWorkspaceCapabilities, frontmatterKeys, insertAnchorMarkers, isPlainvaManagedIndex, mintAnchorMarkerId, propertyAnchorKey, readFrontmatterPath, resolveCommentAnchor, resolvePropertyAnchor, stripPlainvaIndexMarker, wikiTargetForPath, workspaceSliceIdsForObject, type WorkspaceCapability, type WorkspaceCommentAnchor, type WorkspaceCommentRecord, type WorkspacePropertyAnchorResolution } from "@plainva/core";
import { resolveGoverningBaseOf } from "../services/baseOps";
import { noteSaver, vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";
import { mPrompt } from "../services/mobileDialogs";
import { confirmDeleteFile } from "../lib/deleteFile";
import { clearDraft, readDraft, type NoteDraft } from "../services/draftJournal";
import { NoteContextSheet, type ContextTab } from "../components/NoteContextSheet";
import { RowActionSheet } from "../components/RowActionSheet";
import { FolderPickerSheet } from "../components/FolderPickerSheet";
import { CommentsSheet } from "../components/CommentsSheet";
import { listMobileComments, listMobileCommentAuthors, mobileCommentSelfId, postMobileComment, MOBILE_COMMENT_CAPABILITIES } from "../services/mobileComments";
import { EditorHost } from "../EditorHost";
import { AppBar } from "../components/AppBar";

/** A property value as the anchor quote carries it (desktop parity). */
function propertyValueText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => propertyValueText(v)).filter(Boolean).join(", ");
  if (typeof value === "object") return "";
  return String(value);
}

/**
 * Note view (M3E mockup 2/3): read-first. Reading shows back · title ·
 * bookmark · context · ⋮ plus a pencil FAB; editing collapses the bar to
 * back · title · tonal check. The context button opens the context sheet
 * (properties · backlinks · outline · graph · history — the mobile right
 * sidebar), so the former ⋮ entries for properties and version history
 * moved out of the menu (2026-07-16). The bookmark uses the same Bookmark
 * glyph as every other bookmark surface (tab bar, bookmark rows, desktop).
 * Remaining file actions (icon, stripe, source toggle, find, rename,
 * delete) live in the ⋮ sheet; property chips still open the sheet too.
 */
export function NoteScreen({
  vault,
  path,
  onBack,
  onOpenNote,
  onRenamed,
  onComposeMail,
}: {
  vault: MobileVault;
  path: string;
  onBack: () => void;
  onOpenNote: (path: string) => void;
  /** Retargets the open nav entry after a rename (path changes). */
  onRenamed: (newPath: string) => void;
  /** Opens Plainva's own composer with the note in it (S30). */
  onComposeMail?: (draft: { subject: string; body: string; attachments?: MailAttachment[] }) => void;
}) {
  const { t, i18n } = useTranslation();
  const title = path.split("/").pop()!.replace(/\.md$/i, "");
  /* Where this note lives (N5.1). The target picture pairs it with "vor 2 Std.";
     the modification time is not read on this screen, so the bar carries the
     half it actually knows rather than a guess. */
  const folder = path.split("/").slice(0, -1).join("/");
  const [doc, setDoc] = useState<string | null>(null);
  // OKF 0.2 `stale_after` (plan P3a, D3): display only. Reads the loaded
  // document; a property write from the context sheet reloads it (onMutated).
  const staleSince = useMemo(
    () => (doc === null ? null : staleSinceOf(trustSignalsFromBlock(frontmatterBlockOf(doc)))),
    [doc]
  );
  const [loadError, setLoadError] = useState(false);
  const [marked, setMarked] = useState(false);
  const [info, setInfo] = useState<ContextTab | null>(null);
  // The context surface can stand beside the work (S14) — but only where a
  // third column FITS and only when it was asked for (finding 2026-08-21). It
  // used to appear from 840 px on its own, which is how a 10" tablet ended up
  // with three squeezed columns; the same button now docks and undocks it, and
  // below DOCK_MIN it opens the sheet exactly as on a phone.
  const canDock = useSyncExternalStore(subscribeWindowClass, getCanDock);
  const [dockPref, setDockPref] = useState(getMobileSettings().contextPanelDocked);
  useEffect(() => {
    const onChanged = () => setDockPref(getMobileSettings().contextPanelDocked);
    window.addEventListener("m-settings-changed", onChanged);
    return () => window.removeEventListener("m-settings-changed", onChanged);
  }, []);
  const docked = canDock && dockPref;
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  // C4: live preview <-> raw markdown source (session mode, per note session).
  const [source, setSource] = useState(false);
  // Read-first (M4/E5): notes open rendered and read-only; the pencil FAB
  // flips into editing (and back), which also shows the keyboard toolbar.
  const [editing, setEditing] = useState(getMobileSettings().defaultView === "edit");
  const [workspaceCapabilities, setWorkspaceCapabilities] = useState<WorkspaceCapability[] | null>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  useEffect(() => {
    let stale = false;
    if (!vault.workspaceRuntime || !vault.workspaceState) { setWorkspaceCapabilities(null); return; }
    void vault.workspaceState.getObjectByPath(path).then((object) => {
      if (stale || !vault.workspaceRuntime) return;
      const objectId = object?.objectId ?? createWorkspaceObjectId();
      const sliceIds = workspaceSliceIdsForObject(vault.workspaceRuntime.policy.payload, { objectId, path, contentKind: object?.contentKind });
      const capabilities = effectiveWorkspaceCapabilities(vault.workspaceRuntime.policy.payload, { memberId: vault.workspaceRuntime.memberId, deviceId: vault.workspaceRuntime.device.publicIdentity.deviceId, objectId, sliceIds });
      setWorkspaceCapabilities(capabilities);
      if (!capabilities.includes("content.write")) setEditing(false);
    }).catch(() => { if (!stale) { setWorkspaceCapabilities([]); setEditing(false); } });
    return () => { stale = true; };
  }, [vault, path]);
  const workspaceCanWrite = workspaceCapabilities === null || workspaceCapabilities.includes("content.write");
  /**
   * Comments and suggestions (D5).
   *
   * A vault without an encrypted workspace has no policy, so the capability set
   * falls back to what a plain vault can honestly grant. `commentTick` reloads
   * after every write: the records live in a sideband file, not in the note, so
   * nothing else would tell this screen that a reply arrived.
   */
  const [comments, setComments] = useState<WorkspaceCommentRecord[]>([]);
  const [commentNames, setCommentNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentTick, setCommentTick] = useState(0);
  // Read once and kept: the device id does not change while a screen is open,
  // and null until it is here means nothing counts as addressed to you.
  const [commentSelfId, setCommentSelfId] = useState<string | null>(null);
  const commentCaps = workspaceCapabilities ?? MOBILE_COMMENT_CAPABILITIES;
  const canComment = commentCaps.includes("comment.create");
  useEffect(() => {
    let stale = false;
    void Promise.all([listMobileComments(vault, path), listMobileCommentAuthors(vault)])
      .then(([list, names]) => { if (!stale) { setComments(list); setCommentNames(names); } })
      .catch(() => { if (!stale) { setComments([]); setCommentNames(new Map()); } });
    return () => { stale = true; };
  }, [vault, path, commentTick]);
  useEffect(() => {
    let stale = false;
    void mobileCommentSelfId()
      .then((id) => { if (!stale) setCommentSelfId(id); })
      .catch(() => { if (!stale) setCommentSelfId(null); });
    return () => { stale = true; };
  }, []);
  /**
   * Property comments (E2) - the count per frontmatter key and the anchor a
   * fresh one carries.
   *
   * THREADS, not messages: a reply inherits its thread's anchor and carries
   * none of its own, so `propertyAnchorKey` is null for every reply and the
   * filter counts roots by construction. Counting messages would inflate one
   * busy discussion into the appearance of many separate remarks.
   *
   * The alias trail for a RENAMED key lives in the governing `.base`
   * (`previousKeys`), and it is loaded lazily: it only decides the fate of a
   * key that is already gone from the frontmatter. In the common case nothing
   * was renamed, and the walk over every `.base` of the vault never runs.
   */
  const [pendingPropertyAnchor, setPendingPropertyAnchor] = useState<WorkspaceCommentAnchor | null>(null);
  /**
   * Stufe E (E4): the range a widget was asked about, parked until the card is
   * posted.
   *
   * Kept apart from `pendingPropertyAnchor` on purpose: a property anchor is a
   * FINISHED record (its key and value are read the moment the sheet opens),
   * while a text anchor has to be built against the text as it stands at SUBMIT
   * time — the quote it carries is what makes it survive an edit.
   */
  const [pendingRange, setPendingRange] = useState<{ from: number; to: number; display: AnchorFrameHint } | null>(null);
  const [propertyAliasColumns, setPropertyAliasColumns] = useState<Record<string, unknown> | null>(null);
  const propertyAnchorKeys = useMemo(
    () => comments.map((c) => (c.anchor ? propertyAnchorKey(c.anchor) : null)),
    [comments],
  );
  const missingPropertyKey = useMemo(() => {
    if (doc === null) return false;
    const keys = new Set(frontmatterKeys(doc));
    return propertyAnchorKeys.some((k) => k !== null && !keys.has(k));
  }, [propertyAnchorKeys, doc]);
  useEffect(() => {
    let stale = false;
    if (!missingPropertyKey) { setPropertyAliasColumns(null); return; }
    void resolveGoverningBaseOf(vault, path)
      .then((base) => { if (!stale) setPropertyAliasColumns((base?.columns as Record<string, unknown>) ?? null); })
      .catch(() => { if (!stale) setPropertyAliasColumns(null); });
    return () => { stale = true; };
  }, [missingPropertyKey, vault, path]);
  const propertyResolutions = useMemo(() => {
    const map = new Map<string, WorkspacePropertyAnchorResolution>();
    if (doc === null) return map;
    const keys = new Set(frontmatterKeys(doc));
    const aliasOf = propertyAliasResolver(propertyAliasColumns ? [{ columns: propertyAliasColumns }] : []);
    comments.forEach((comment, i) => {
      const key = propertyAnchorKeys[i];
      if (!key) return;
      map.set(comment.commentId, resolvePropertyAnchor(key, (candidate) => keys.has(candidate), aliasOf));
    });
    return map;
  }, [comments, propertyAnchorKeys, doc, propertyAliasColumns]);
  /**
   * Stufe E (E4): resolve every open comment against the text the editor shows.
   *
   * An ORPHAN contributes nothing - its passage is gone, and tinting an
   * arbitrary spot would be worse than tinting none; its card says so instead.
   * A widget-backed range carries a frame hint, because a mark can only paint
   * over text and a replaced range shows none.
   */
  const anchorHighlights = useMemo<readonly AnchorHighlight[]>(() => {
    if (doc === null) return [];
    const out: AnchorHighlight[] = [];
    for (const comment of comments) {
      if (comment.resolvedAt || !comment.anchor) continue;
      const resolution = resolveCommentAnchor(doc, comment.anchor);
      if (resolution.status === "orphan") continue;
      out.push({ commentId: comment.commentId, from: resolution.from, to: resolution.to, frame: toAnchorFrameHint(comment.anchor.display) });
    }
    return out;
  }, [comments, doc]);
  const propertyCommentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const res of propertyResolutions.values()) {
      // An ORPHAN is left out - its key is gone from the frontmatter, so there
      // is no row to put a number on; the card in the comments sheet still
      // names it. A renamed one counts against the key that exists TODAY,
      // which is the row the reader sees.
      if (res.status === "orphan") continue;
      counts.set(res.key, (counts.get(res.key) ?? 0) + 1);
    }
    return counts;
  }, [propertyResolutions]);
  /**
   * Starts a comment on a property row.
   *
   * The key IS the anchor; nothing is written into the Markdown. The marker id
   * is minted and never inserted - a marker pair inside the YAML frontmatter
   * would corrupt exactly the block the anchor depends on.
   */
  const startPropertyComment = (key: string) => {
    if (doc === null) return;
    setPendingPropertyAnchor(
      buildPropertyCommentAnchor(key, propertyValueText(readFrontmatterPath(doc, [key])), mintAnchorMarkerId(doc)),
    );
    setInfo(null);
    setCommentsOpen(true);
  };
  /**
   * A Plainva-managed overview is read-only until the reader says otherwise
   * (desktop parity). Without the guard the next auto-update run silently
   * overwrites whatever was typed here — which is the whole reason the marker
   * exists. The way out is named and one tap away, and it removes the marker:
   * the file becomes the user's and stops updating itself.
   */
  const managedIndex = /(^|\/)index\.md$/i.test(path) && doc !== null && isPlainvaManagedIndex(doc);
  useEffect(() => {
    let stale = false;
    void vaultOps
      .read(vault, path)
      .then(async (text) => {
        if (stale) return;
        setLoadError(false);
        setDoc(text);
        // Draft recovery (package G): offer an unsaved draft that is newer
        // than the file on disk and differs from it.
        const d = await readDraft(vault, path);
        if (stale || !d || d.text === text) return;
        const info = await vault.adapter.getFileInfo(path).catch(() => null);
        if (!stale && (!info || d.ts > info.mtime)) setDraft(d);
      })
      .catch(() => {
        // The note is gone (a stale bookmark/recent, or deleted while open) —
        // show a friendly not-found body instead of a fatal unhandled rejection.
        if (!stale) setLoadError(true);
      });
    void vaultOps.getBookmarks(vault).then((marks) => {
      if (!stale) setMarked(marks.includes(path));
    });
    return () => {
      stale = true;
    };
  }, [vault, path]);

  /** Regenerates this overview from the folder it belongs to. */
  const refreshManagedIndex = () => {
    void (async () => {
      try {
        await writeOverview(vault, path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
      } catch (e) {
        console.error("[mobile] refreshing the managed index failed", e);
        toast.error(t("indexMd.generateFailed"));
      }
    })();
  };

  /** Hands the file back to the user: the marker goes, so do the auto-updates. */
  const unlockManagedIndex = () => {
    void (async () => {
      if (doc === null) return;
      const ok = await mConfirm({ title: t("indexMd.editAnyway"), message: t("indexMd.editAnywayConfirm") });
      if (!ok) return;
      const stripped = stripPlainvaIndexMarker(doc);
      await vaultOps.save(vault, path, stripped);
      setDoc(stripped);
      setReloadTick((n) => n + 1);
      setEditing(true);
    })();
  };

  const editorEvent = (name: string) => window.dispatchEvent(new CustomEvent(name, { detail: { path } }));

  const rename = () => {
    void (async () => {
      const { value, cancelled } = await mPrompt({
        title: t("common.rename"),
        message: t("mobile.renamePrompt"),
        initial: title,
      });
      const trimmed = value?.trim();
      if (cancelled || !trimmed || trimmed === title) return;
      const dir = path.includes("/") ? `${path.slice(0, path.lastIndexOf("/"))}/` : "";
      await vaultOps.rename(vault, path, trimmed);
      onRenamed(`${dir}${trimmed}.md`);
    })();
  };

  const share = () => {
    void (async () => {
      const body = markdownToPlainText((doc ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));
      try {
        await Share.share({ title, text: `${title}\n\n${body}`.trim(), dialogTitle: t("mobile.share") });
      } catch {
        /* user dismissed the share sheet, or no share target */
      }
    })();
  };

  const exportMarkdown = () => void exportNoteAsMarkdown(vault, path, t);

  /**
   * The note leaving as mail (S30). The desktop offers four ways and the phone
   * had none; the two that make sense with a touch keyboard are here.
   *
   * `mailto:` hands the note to whatever mail app the phone already has set
   * up — no account in Plainva required, which is the common case on a phone.
   * "Compose" goes to Plainva's own composer instead, where a signature, Cc
   * and attachments are available. Copying as rich text is deliberately absent:
   * a phone clipboard has no HTML flavour to paste into.
   */
  const noteBody = () => markdownToPlainText((doc ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""));

  const sendViaMailto = () => {
    const res = buildMailtoUrl(title, noteBody());
    if (res.truncated) toast.info(t("mail.mailtoTruncated"));
    void Browser.open({ url: res.url }).catch(() => toast.error(t("mail.mailtoFailed")));
  };

  // The command surface reaches the open note through events (S16): the
  // registry is a list of intents, and the screen that owns the note is the
  // only place that knows how to carry them out.
  useEffect(() => {
    const onRename = () => rename();
    const onToggle = () => setEditing((e) => !e);
    const onShare = () => share();
    const onExport = () => exportMarkdown();
    window.addEventListener("m-note-rename", onRename);
    window.addEventListener("m-note-toggle-edit", onToggle);
    window.addEventListener("m-note-share", onShare);
    window.addEventListener("m-note-export", onExport);
    return () => {
      window.removeEventListener("m-note-rename", onRename);
      window.removeEventListener("m-note-toggle-edit", onToggle);
      window.removeEventListener("m-note-share", onShare);
      window.removeEventListener("m-note-export", onExport);
    };
  });


  /**
   * A comment that became work (D11, desktop parity).
   *
   * The thread stays and gains a reply naming the task - the only honest link,
   * because the comment log is append-only and a body cannot be rewritten. It
   * stays OPEN too: promoting says "this became work", not "this is settled".
   *
   * The task goes through the SAME creation path as a promoted checkbox and as
   * "+ Entry", so a task born from a comment is not subtly unlike the others.
   */
  const promoteCommentToTask = async (comment: WorkspaceCommentRecord) => {
    const dbPath = getMobileSettings().taskDatabase.trim();
    if (!dbPath) {
      toast.info(t("tasks.promoteNoDb"));
      return;
    }
    const notes = vault.queryService
      ? (await vault.queryService.listNotes().catch(() => [])).map((n) => n.path)
      : [];
    const title = commentTaskTitle(comment.body, t("workspaceSecurity.commentTaskFallback"));
    const res = await createTaskInDatabase({
      adapter: vault.files,
      dbPath,
      title,
      noteType: getMobileSettings().defaultNoteType,
      trailer: commentTaskTrailer({
        body: comment.body,
        quote: (comment.anchor as WorkspaceCommentAnchor | null)?.quote ?? null,
        noteTarget: wikiTargetForPath(path, notes),
        sourceLabel: t("workspaceSecurity.commentTaskSource"),
      }),
    });
    if (!res.ok) {
      toast.error(res.reason === "noFolder" ? t("tasks.promoteNoFolder") : t("tasks.promoteNoDb"));
      return;
    }
    // The new note exists now, so its own wiki target is computed against a
    // list that contains it - otherwise the reply names a target that could
    // collide with a note added a moment later.
    await postMobileComment(vault, {
      path,
      body: commentTaskReply(
        wikiTargetForPath(res.notePath, [...notes, res.notePath]),
        t("workspaceSecurity.commentTaskCreated"),
      ),
      parentCommentId: comment.commentId,
      authorName: getMobileSettings().verifierName,
    });
    setCommentTick((n) => n + 1);
    await sendTaskToProviderList(vault.files, dbPath, res.notePath, title).catch(() => undefined);
    toast.info(t("workspaceSecurity.commentTaskCreated"));
  };

  /**
   * Accepting a proposal is an ORDINARY edit plus a resolve (desktop parity).
   *
   * The passage is found by resolving the anchor against the text as it stands
   * right now, never by trusting stored offsets: the note may have been edited
   * on another device since. An orphaned anchor is refused rather than guessed -
   * writing a proposal into a spot nobody proposed it for is the worse failure.
   */
  const applySuggestion = async (comment: WorkspaceCommentRecord, outcome: "applied" | "declined") => {
    const name = getMobileSettings().verifierName;
    if (outcome === "declined") {
      await postMobileComment(vault, { path, body: "", resolvedCommentId: comment.commentId, suggestionOutcome: "declined", authorName: name });
      setCommentTick((n) => n + 1);
      return;
    }
    const text = doc;
    if (!comment.suggestion || !comment.anchor || text === null) return;
    const resolution = resolveCommentAnchor(text, comment.anchor);
    if (resolution.status === "orphan") {
      toast.error(t("workspaceSecurity.suggestionOrphan"));
      return;
    }
    const next = text.slice(0, resolution.from) + comment.suggestion.replacement + text.slice(resolution.to);
    setDoc(next);
    noteSaver.schedule(vault, path, next);
    try {
      await postMobileComment(vault, { path, body: "", resolvedCommentId: comment.commentId, suggestionOutcome: "applied", authorName: name });
    } catch (error) {
      // The swap is already in the buffer. If the record never landed, the note
      // must not silently keep a change nobody agreed to.
      setDoc(text);
      noteSaver.schedule(vault, path, text);
      throw error;
    }
    setCommentTick((n) => n + 1);
  };

  /**
   * Tapping a quote reveals its passage in the note (D6).
   *
   * Resolved here, against the text as it stands, and handed to the editor as
   * offsets - the same rule accepting a suggestion follows, for the same
   * reason. An orphaned anchor says so instead of scrolling somewhere
   * arbitrary, and the sheet closes so the passage is actually visible.
   */
  const revealAnchor = (comment: WorkspaceCommentRecord) => {
    if (!comment.anchor || doc === null) return;
    const resolution = resolveCommentAnchor(doc, comment.anchor);
    if (resolution.status === "orphan") {
      toast.error(t("workspaceSecurity.suggestionOrphan"));
      return;
    }
    setCommentsOpen(false);
    window.dispatchEvent(new CustomEvent("m-editor-goto-range", {
      detail: { path, from: resolution.from, to: resolution.to },
    }));
  };

  const page = (
    <div className="m-page m-page--note">
      <AppBar onBack={onBack} subtitle={folder} title={title} actions={<>{!editing && (
            <IconButton
              label={t("mobile.toggleBookmark")}
              active={marked}
              onClick={() =>
                void vaultOps.toggleBookmark(vault, path).then((next) => setMarked(next))
              }
            >
              <Bookmark fill={marked ? "currentColor" : "none"} size={ICON.head} />
            </IconButton>
          )}
          {!editing && (
            <IconButton
              active={docked}
              label={t("mobile.noteContext")}
              data-testid="note-context"
              onClick={() => {
                // Wide enough for the column: the button IS the dock switch and
                // the choice is remembered. Narrower: it opens the sheet.
                if (canDock) void updateMobileSettings({ contextPanelDocked: !dockPref });
                else setInfo("props");
              }}
            >
              <PanelRight size={ICON.head} />
            </IconButton>
          )}
          {!editing && (
            <IconButton label={t("mobile.noteMenu")} data-testid="note-menu" onClick={() => setMenu(true)}>
              <MoreVertical size={ICON.head} />
            </IconButton>
          )}
          {editing && (
            <IconButton
              label={t("mobile.doneEditing")}
              active={true}
              data-testid="note-done"
              onClick={() => setEditing(false)}
            >
              <Check size={ICON.head} />
            </IconButton>
          )}</>} />
      {draft && (
        <div className="m-draftbanner">
          <span>
            {t("editor.draftBanner", {
              time: new Date(draft.ts).toLocaleTimeString(),
            })}
          </span>
          <span className="m-config-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const d = draft;
                setDraft(null);
                setDoc(d.text);
                setReloadTick((n) => n + 1);
                noteSaver.schedule(vault, path, d.text);
              }}
            >
              {t("editor.draftRestore")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearDraft(vault, path);
                setDraft(null);
              }}
            >
              {t("editor.draftDiscard")}
            </Button>
          </span>
        </div>
      )}
      {managedIndex && (
        <div className="m-draftbanner" data-testid="managed-index-banner">
          <span>{t("indexMd.managedBanner")}</span>
          <span className="m-config-actions">
            <Button onClick={refreshManagedIndex} size="sm" variant="ghost">
              {t("indexMd.refreshNow")}
            </Button>
            <Button onClick={unlockManagedIndex} size="sm" variant="ghost">
              {t("indexMd.editAnyway")}
            </Button>
          </span>
        </div>
      )}
      {staleSince && (
        <div data-testid="okf-stale-banner">
          <Banner
            kind="warning"
            actions={
              <Button onClick={() => setInfo("props")} size="sm" variant="ghost">
                {t("trust.openProperties")}
              </Button>
            }
          >
            {t("trust.staleBanner", { date: formatStampDate(staleSince, i18n.language) })}
          </Banner>
        </div>
      )}
      {doc !== null && (
        <EditorHost
          editable={editing && workspaceCanWrite && !managedIndex}
          initialDoc={doc}
          key={`${path}#${reloadTick}`}
          canComment={canComment}
          anchorHighlights={anchorHighlights}
          onCommentAnchorRequest={(req) => { setPendingRange(req); setPendingPropertyAnchor(null); setCommentsOpen(true); }}
          onOpenNote={onOpenNote}
          path={path}
          vault={vault}
        />
      )}
      {!workspaceCanWrite && <div className="m-inline-notice">{workspaceCapabilities?.includes("comment.create") ? t("workspaceSecurity.commentOnly", { defaultValue: "Comment-only access — file content is read-only." }) : t("workspaceSecurity.readOnly", { defaultValue: "Read-only access — changes cannot be saved." })}</div>}
      {doc === null && loadError && (
        /* A note that is gone leaves nothing to do ON this screen — so the one
           action is off it. The tab bar could do it, but a pushed note covers
           the bar's own root and the reader would be guessing (N7). */
        <EmptyState
          action={
            <Button data-testid="note-missing-back" onClick={onBack} variant="tonal">
              {t("common.back")}
            </Button>
          }
          icon={<FileX size={ICON.touch} />}
        >
          {t("mobile.noteMissing")}
        </EmptyState>
      )}
      {!editing && workspaceCanWrite && !managedIndex && (
        <Fab
          aria-label={t("mobile.editNote")}
          className="m-fab-float"
          data-testid="note-edit"
          icon={<Pencil size={ICON.touch} />}
          onClick={() => setEditing(true)}
        />
      )}

      {commentsOpen && (
        <CommentsSheet
          comments={comments}
          memberNames={commentNames}
          selfMemberId={commentSelfId}
          propertyResolutions={propertyResolutions}
          canComment={canComment}
          canWrite={workspaceCanWrite}
          onClose={() => { setCommentsOpen(false); setPendingPropertyAnchor(null); setPendingRange(null); }}
          onSubmit={async (body, parentCommentId) => {
            /* A reply inherits its thread's anchor, so a parked anchor belongs
               to a ROOT only - otherwise the reply would claim a second anchor
               of its own. */
            const root = parentCommentId === null;
            const text = doc;
            let anchor = root ? pendingPropertyAnchor : null;
            /* Stufe E (E4): a parked RANGE becomes its anchor here, against the
               text as it stands - the quote is what carries it across an edit,
               so capturing it when the sheet opened would already be stale. */
            let marker: { before: string } | null = null;
            if (root && anchor === null && pendingRange && text !== null) {
              const id = mintAnchorMarkerId(text);
              anchor = buildCommentAnchor(text, pendingRange.from, pendingRange.to, id, pendingRange.display);
              /* The marker only goes in where writing is allowed. Without it
                 the anchor still resolves - quote first, then context - it is
                 just less precise after a heavy edit. */
              if (workspaceCanWrite) {
                const next = insertAnchorMarkers(text, pendingRange.from, pendingRange.to, id);
                marker = { before: text };
                setDoc(next);
                noteSaver.schedule(vault, path, next);
              }
            }
            try {
              await postMobileComment(vault, { path, body, parentCommentId, anchor, authorName: getMobileSettings().verifierName });
            } catch (error) {
              /* The markers are already in the buffer. If the record never
                 landed, the note must not keep a pair pointing at a comment
                 that does not exist. */
              if (marker) {
                setDoc(marker.before);
                noteSaver.schedule(vault, path, marker.before);
              }
              throw error;
            }
            setPendingPropertyAnchor(null);
            setPendingRange(null);
            setCommentTick((n) => n + 1);
          }}
          onResolve={(commentId) => {
            void postMobileComment(vault, { path, body: "", resolvedCommentId: commentId, authorName: getMobileSettings().verifierName })
              .then(() => setCommentTick((n) => n + 1));
          }}
          onPromoteToTask={(comment) => { void promoteCommentToTask(comment).catch((e) => toast.error(errorText(e))); }}
          onApplySuggestion={(comment) => { void applySuggestion(comment, "applied"); }}
          onDeclineSuggestion={(comment) => { void applySuggestion(comment, "declined"); }}
          onRevealAnchor={revealAnchor}
        />
      )}
      {menu && (
        <RowActionSheet
          title={title}
          onClose={() => setMenu(false)}
          actions={[
            /*
             * A text file is not a note (C15/S14), so three of these entries do
             * not belong to it. Icon and colour WRITE `plainva` frontmatter into
             * the file — on a `.csv` that is not a preference, it is damage; the
             * OKF header would land in the first data row. "Markdown source"
             * would be a control that does nothing, because a text file has one
             * mode. The rest (find, rename, move, send, share, export, delete)
             * are file actions and stay.
             */
            ...(resolveOpenAction(path) === "text" ? [] : [
            {
              icon: <Smile size={ICON.head} />,
              label: t("docHeader.changeIcon"),
              onClick: () => {
                setMenu(false);
                editorEvent("m-editor-pick-icon");
              },
            },
            {
              icon: <Paintbrush size={ICON.head} />,
              label: t("docHeader.changeColor"),
              onClick: () => {
                setMenu(false);
                editorEvent("m-editor-pick-color");
              },
            },
            {
              icon: <Code size={ICON.head} />,
              label: source ? t("editor.livePreview") : t("editor.sourceMode"),
              onClick: () => {
                setMenu(false);
                setSource((s) => {
                  window.dispatchEvent(
                    new CustomEvent("m-editor-set-mode", { detail: { path, mode: s ? "live" : "source" } }),
                  );
                  return !s;
                });
              },
            },
            ]),
            {
              icon: <Search size={ICON.head} />,
              label: t("search.find"),
              onClick: () => {
                setMenu(false);
                editorEvent("m-editor-find");
              },
            },
            /*
             * Comments live behind the menu, not on a permanent button: on a
             * phone the note itself is the scarce surface, and most readings of
             * a note involve no comment at all. `comment.read` gates it because
             * a slice may hand out the text without the discussion around it.
             */
            ...(commentCaps.includes("comment.read") ? [{
              icon: <MessageSquare size={ICON.head} />,
              label: t("workspaceSecurity.comments"),
              onClick: () => {
                setMenu(false);
                setCommentsOpen(true);
              },
            }] : []),
            {
              icon: <Pencil size={ICON.head} />,
              label: t("common.rename"),
              onClick: () => {
                setMenu(false);
                rename();
              },
            },
            {
              icon: <FolderInput size={ICON.head} />,
              label: t("mobile.moveNote"),
              onClick: () => {
                setMenu(false);
                setMoving(true);
              },
            },
            {
              icon: <Mail size={ICON.head} />,
              label: t("mail.sendViaMailto"),
              onClick: () => {
                setMenu(false);
                sendViaMailto();
              },
            },
            {
              icon: <Send size={ICON.head} />,
              label: t("mail.sendNoteViaEmail"),
              onClick: () => {
                setMenu(false);
                onComposeMail?.({ subject: title, body: noteBody() });
              },
            },
            {
              /*
               * The note as a FILE on the mail, not as its body (S30 follow-up).
               * The composer could already attach; what was missing was a draft
               * that arrives with the file on it. Sends the saved Markdown, so
               * the recipient gets something that reopens as the note.
               */
              icon: <Paperclip size={ICON.head} />,
              label: t("mail.sendNoteAsAttachment"),
              onClick: () => {
                setMenu(false);
                void mailNoteAsAttachment(vault, path, title, t).then((a) => {
                  if (a) onComposeMail?.({ subject: title, body: "", attachments: [a] });
                });
              },
            },
            {
              icon: <Share2 size={ICON.head} />,
              label: t("mobile.share"),
              onClick: () => {
                setMenu(false);
                share();
              },
            },
            {
              // Parity gap template-authoring: the phone could USE templates but not
              // make one. The rules are the shared ones — the phone only supplies
              // its own template folder, because the two shells keep different
              // settings models.
              icon: <FilePlus2 size={ICON.head} />,
              label: t("editor.saveAsTemplate"),
              onClick: () => {
                setMenu(false);
                void (async () => {
                  await noteSaver.flush(path).catch(() => {});
                  const saved = await saveNoteAsTemplateIn(
                    vault.adapter,
                    getMobileSettings().templateFolder,
                    path,
                  ).catch(() => null);
                  if (saved) {
                    toast.info(t("editor.templateSaved", { name: saved.split("/").pop() }));
                  } else {
                    toast.warning(t("editor.exportFailed"));
                  }
                })();
              },
            },
            {
              // Sharing the TEXT (above) cannot be printed or reopened as the
              // note; handing over the FILE can — the system sheet then offers
              // Print, Save to Files and every editor installed. That is the
              // phone's print/PDF/export, and it is one action instead of three
              // half-built ones (S42).
              icon: <FileDown size={ICON.head} />,
              label: t("editor.exportMarkdown"),
              onClick: () => {
                setMenu(false);
                exportMarkdown();
              },
            },
            {
              icon: <Trash2 size={ICON.head} />,
              label: t("common.delete"),
              danger: true,
              onClick: () => {
                setMenu(false);
                void confirmDeleteFile(vault, path, title, t).then((ok) => {
                  if (ok) onBack();
                });
              },
            },
          ]}
        />
      )}

      {moving && (
        <FolderPickerSheet
          onClose={() => setMoving(false)}
          onPick={(folder) => {
            void vaultOps.moveNote(vault, path, folder).then((newPath) => {
              if (newPath !== path) onRenamed(newPath);
            });
          }}
          title={t("mobile.moveTitle")}
          vault={vault}
        />
      )}

      {info && !docked && (
        <NoteContextSheet
          canComment={canComment}
          canWrite={workspaceCanWrite}
          commentCounts={propertyCommentCounts}
          initialTab={info}
          onClose={() => setInfo(null)}
          onCommentProperty={startPropertyComment}
          onMutated={() => {
            void vaultOps.read(vault, path).then((text) => {
              setDoc(text);
              setReloadTick((n) => n + 1);
            });
          }}
          onJumpToLine={(line) =>
            window.dispatchEvent(new CustomEvent("m-editor-goto-line", { detail: { path, line } }))
          }
          onOpenNote={onOpenNote}
          onRestored={() => {
            void vaultOps.read(vault, path).then((text) => {
              setDoc(text);
              setReloadTick((n) => n + 1);
            });
          }}
          path={path}
          vault={vault}
        />
      )}
    </div>
  );

  if (!docked) return page;
  // Work and context side by side (M3 supporting pane). The panel is the same
  // component, told to dock — a second implementation would drift within a
  // release, and the six sections are the point, not the container.
  return (
    <div className="m-worksplit">
      {page}
      <NoteContextSheet
        canComment={canComment}
        canWrite={workspaceCanWrite}
        commentCounts={propertyCommentCounts}
        docked
        initialTab={info ?? "props"}
        key={info ?? "props"}
        onClose={() => setInfo(null)}
        onCommentProperty={startPropertyComment}
        onMutated={() => {
          void vaultOps.read(vault, path).then((text) => {
            setDoc(text);
            setReloadTick((n) => n + 1);
          });
        }}
        onJumpToLine={(line) =>
          window.dispatchEvent(new CustomEvent("m-editor-goto-line", { detail: { path, line } }))
        }
        onOpenNote={onOpenNote}
        onRestored={() => {
          void vaultOps.read(vault, path).then((text) => {
            setDoc(text);
            setReloadTick((n) => n + 1);
          });
        }}
        path={path}
        vault={vault}
      />
    </div>
  );
}
