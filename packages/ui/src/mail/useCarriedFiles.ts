import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MailAccountConfig } from "./mailAccounts";
import type { MailAttachment } from "./mailOut";
import { fetchAttachments } from "./mailClient";
import { MAIL_MAILBOX_CHANGED } from "./transport";
import {
  applyFetched,
  attachmentLimits,
  carriedFilesOf,
  carriedToSend,
  failAll,
  leftBehind,
  planFiles,
  readForwardSource,
  type AttachmentLimits,
  type CarriedFile,
  type CarriedRow,
  type ForwardSource,
  type LeftBehind,
} from "./carriedFiles";

/**
 * The files of a forwarded original, loaded and kept for one composer — the
 * half of `carriedFiles.ts` that talks to the mailbox. Both shells call this
 * and draw its rows their own way.
 *
 * It asks for the bytes as soon as it knows who sends (the bound belongs to
 * the sending mailbox), in ONE call per message, and never again on its own: a
 * file that did not come waits for `retry`. Whatever arrives after the
 * composer is gone is dropped.
 */

/** What a composer that moves to another window takes along: the reference,
 *  the files still on the draft, and the bytes that have already arrived. */
export interface CarriedSnapshot {
  source: ForwardSource;
  files: CarriedFile[];
}

export interface UseCarriedFilesOptions {
  /** What the mail client reads the mailbox's sign-in under; empty = not ready. */
  vaultPath: string | null | undefined;
  /** The reference the composer was opened with. Read once, on the first render. */
  source: ForwardSource | undefined;
  /** A composer that changed windows brings what it had. Read once. */
  restore?: CarriedSnapshot;
  /** The connected mailboxes — null while they are still being read. */
  accounts: readonly MailAccountConfig[] | null;
  /** The mailbox the message would be sent from. */
  sender: MailAccountConfig | null | undefined;
  /** The other files on the draft: arrived with it, or attached by hand. */
  others: readonly MailAttachment[];
}

export interface CarriedFilesState {
  /** One row per file of the original that is still on the draft. */
  rows: CarriedRow[];
  /** Something is still on its way: Send and Save draft wait for it. */
  loading: boolean;
  /** The files of the original that go out with the message. */
  attachments: MailAttachment[];
  /** For each OTHER file, in order: whether the sending mailbox takes it. */
  othersGo: boolean[];
  /** What a send would leave behind — asked about before it goes. */
  left: LeftBehind[];
  /** The bounds of the sending mailbox all of this was decided against — for
   *  the sentence that names one (`carriedLimitText`). */
  limits: AttachmentLimits;
  /** The files the draft opened with and the ones on it now, for `composeChanged`. */
  openedIndexes: number[];
  indexes: number[];
  /** Takes a file off the draft, whatever state it is in. */
  remove(index: number): void;
  /** Asks again for a file that did not come — without an index, for all. */
  retry(index?: number): void;
  /** The state to hand to another window; undefined when nothing was forwarded. */
  snapshot(): CarriedSnapshot | undefined;
}

const asIdle = ({ index, name, mime, size }: CarriedFile): CarriedFile => ({ index, name, mime, size, load: "idle" });

export function useCarriedFiles(options: UseCarriedFilesOptions): CarriedFilesState {
  const { vaultPath, accounts, sender, others } = options;
  // Held from the first render: on the phone the draft is read out of its nav
  // path on every render, so the reference is a new object each time. It is
  // read through the total reader here, whatever the caller did: it reached
  // the composer through a nav path, a window event or another window, and it
  // decides which mailbox is asked for whose bytes.
  const [source] = useState<ForwardSource | undefined>(() => readForwardSource(options.restore?.source ?? options.source));
  const [files, setFiles] = useState<CarriedFile[]>(() =>
    // A file that was still on its way in the other window is asked for again.
    options.restore ? options.restore.files.map((file) => (file.load === "loading" ? asIdle(file) : file)) : carriedFilesOf(source)
  );
  const [openedIndexes] = useState<number[]>(() => (source?.files ?? []).map((file) => file.index));

  // One value that changes when a bound does, not with every render: the plan
  // hangs on it, and the composer reads it from here instead of asking again.
  const { perFile, carriedTotal } = attachmentLimits(sender);
  const limits = useMemo<AttachmentLimits>(() => ({ perFile, carriedTotal }), [perFile, carriedTotal]);
  const plan = useMemo(() => planFiles(files, others, limits), [files, others, limits]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Indexes a call is out for — so a re-run of the effect (StrictMode, a
   *  re-render before the state has settled) never asks twice. */
  const asking = useRef(new Set<number>());
  const wantedKey = plan.wanted.join(",");
  useEffect(() => {
    // Not before the mailboxes are known: the bound is the sender's, and a
    // file fetched under the wrong one is megabytes nobody asked for.
    if (!source || !vaultPath || accounts === null) return;
    const asked = plan.wanted.filter((index) => !asking.current.has(index));
    if (asked.length === 0) return;
    const account = accounts.find((a) => a.id === source.accountId);
    if (!account) {
      setFiles((prev) => failAll(prev, asked, "account"));
      return;
    }
    for (const index of asked) asking.current.add(index);
    setFiles((prev) => prev.map((file) => (asked.includes(file.index) && file.load === "idle" ? { ...file, load: "loading" } : file)));
    const settle = () => {
      for (const index of asked) asking.current.delete(index);
    };
    void fetchAttachments(vaultPath, account, source.mailbox, source.messageId, asked, source.uidValidity).then(
      (answers) => {
        settle();
        if (alive.current) setFiles((prev) => applyFetched(prev, answers));
      },
      (error: unknown) => {
        settle();
        if (!alive.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        const failure = detail.includes(MAIL_MAILBOX_CHANGED) ? "changed" : "failed";
        setFiles((prev) => failAll(prev, asked, failure, failure === "changed" ? undefined : detail));
      }
    );
    // `wantedKey` stands for `plan.wanted`: the list is rebuilt on every plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, source, vaultPath, accounts]);

  const remove = useCallback((index: number) => {
    setFiles((prev) => prev.filter((file) => file.index !== index));
  }, []);

  const retry = useCallback((index?: number) => {
    setFiles((prev) =>
      prev.map((file) =>
        file.load === "failed" && file.failure !== "notAFile" && (index === undefined || file.index === index) ? asIdle(file) : file
      )
    );
  }, []);

  const snapshot = useCallback(
    (): CarriedSnapshot | undefined => (source ? { source, files: files.map((file) => (file.load === "loading" ? asIdle(file) : file)) } : undefined),
    [source, files]
  );

  const attachments = useMemo(() => carriedToSend(plan), [plan]);
  const left = useMemo(() => leftBehind(plan, others), [plan, others]);
  const indexes = useMemo(() => files.map((file) => file.index), [files]);

  return {
    rows: plan.rows,
    loading: plan.rows.some((row) => row.state === "loading"),
    attachments,
    othersGo: plan.others,
    left,
    limits,
    openedIndexes,
    indexes,
    remove,
    retry,
    snapshot,
  };
}
