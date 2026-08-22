import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@plainva/ui";
import { MailDraftModal } from "./MailDraftModal";
import { getWindowBus } from "../../services/windowBus";
import type { ComposeSnapshot } from "../../services/mail/composeHandoff";

/**
 * The composer as its own OS window (multi-window P3).
 *
 * Its first act is to collect the draft it was opened for: recipients, subject,
 * body and attachments travel over the bus rather than through the URL, because
 * attachments are base64 and a draft is not an address. The draft is TAKEN, not
 * read — a reload starts from what the writer has typed since, not from the
 * state the window was popped out with.
 *
 * Sending and saving go back to the central window (§12.4); this window only
 * draws the form and closes.
 */
export function ComposeWindow({ label }: { label: string | null }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<ComposeSnapshot | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  useEffect(() => {
    if (!label) {
      setState("empty");
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const bus = await getWindowBus();
        const snap = await bus.request("compose-draft", { label });
        if (!alive) return;
        setSnapshot(snap);
        setState(snap ? "ready" : "empty");
      } catch (e) {
        // No answer means no draft to write into: saying so is better than an
        // empty form that silently lost what someone had written.
        console.warn("[ComposeWindow] could not collect the draft", e);
        if (alive) setState("empty");
      }
    })();
    return () => {
      alive = false;
    };
  }, [label]);

  const close = () => {
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        await getCurrentWindow().close();
      } catch {
        /* browser/test: there is no OS window to close */
      }
    })();
  };

  if (state === "loading") return <EmptyState>{t("common.loading")}</EmptyState>;
  if (state === "empty" || !snapshot) return <EmptyState>{t("mail.composeLost")}</EmptyState>;

  return (
    <MailDraftModal
      variant="window"
      restore={snapshot}
      subject={snapshot.subject}
      markdown={snapshot.body}
      onClose={close}
    />
  );
}
