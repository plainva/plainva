import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AiExternalReview, Banner, Button, externalStatusText, externalTopFolders, TextInput, toast, useExternalAdd, useExternalReview } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { getMobileAiSession } from "../services/ai/mobileAi";
import { mConfirm } from "../services/mobileDialogs";
import type { MobileVault } from "../services/vaultService";

/**
 * The two sheets of "External tools (MCP)" on the phone (plan KI-Harness
 * P4.5): the desktop's dialogs in the grammar of a sheet, over the same
 * model. A phone starts no programs, so a server here is an address.
 */

/** Add a server by its address. The system shows the address once more and asks. */
export function ExternalAddSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const form = useExternalAdd(session, t, false);
  const submit = () => {
    void form.submit().then((id) => {
      if (id) onAdded(id);
    });
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(event) => event.stopPropagation()} data-testid="ai-ext-add">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("ai.ext.add.title")}</p>
        <TextInput value={form.name} maxLength={60} placeholder={t("ai.ext.add.name")} aria-label={t("ai.ext.add.name")} onChange={(event) => form.setName(event.target.value)} data-testid="ai-ext-add-name" />
        <p className="m-hint">{t("ai.ext.add.nameHint")}</p>
        <TextInput
          value={form.url}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          inputMode="url"
          placeholder={t("ai.ext.add.address")}
          aria-label={t("ai.ext.add.address")}
          onChange={(event) => form.setUrl(event.target.value)}
          data-testid="ai-ext-add-url"
        />
        <p className="m-hint">{form.addressHint ?? t("ai.ext.add.addressHint")}</p>
        <TextInput
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={form.token}
          placeholder={t("ai.ext.add.token")}
          aria-label={t("ai.ext.add.token")}
          onChange={(event) => form.setToken(event.target.value)}
          data-testid="ai-ext-add-token"
        />
        <p className="m-hint">{t("ai.ext.add.tokenHint")}</p>
        {form.problem && <Banner kind="error">{form.problem}</Banner>}
        <p className="m-hint">{t("ai.ext.add.confirmNoteAddress")}</p>
        <Button variant="primary" disabled={!form.ready || form.busy} onClick={submit} data-testid="ai-ext-add-submit">
          {t("ai.ext.add.submit")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

/** The review of one server: the shared body, then "Approve" for exactly what was shown — or "Save" for this vault's choices. */
export function ExternalReviewSheet({ vault, serverId, onClose }: { vault: MobileVault; serverId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const session = getMobileAiSession();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const review = useExternalReview(session, state.mcp.servers, serverId, t);
  const [vaultFolders, setVaultFolders] = useState<string[]>([]);
  useEffect(() => {
    if (!vault.queryService) return;
    let alive = true;
    void vault.queryService
      .getAllFolders()
      .catch(() => [] as string[])
      .then((all) => {
        if (alive) setVaultFolders(externalTopFolders(all));
      });
    return () => {
      alive = false;
    };
  }, [vault]);

  const { server } = review;
  if (!server) return null;
  const save = () => {
    void review.save().then((done) => {
      if (done) onClose();
      else toast.error(t("ai.ext.review.notApproved"));
    });
  };
  const remove = () => {
    void mConfirm({ title: t("ai.ext.review.removeConfirm", { server: server.label }), message: t("ai.ext.review.removeBody"), danger: true, confirmLabel: t("ai.ext.review.remove") }).then((yes) => {
      if (yes) void session.mcp.remove(server.id).then(onClose);
    });
  };
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(event) => event.stopPropagation()} data-testid="ai-ext-review">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{server.label}</p>
        <p className="m-hint">{externalStatusText(t, server)}</p>
        <AiExternalReview review={review} vaultFolders={vaultFolders} />
        {review.needsApproval ? (
          <Button variant="primary" disabled={!review.canApprove || review.busy} onClick={save} data-testid="ai-ext-approve">
            {t("ai.ext.review.approve")}
          </Button>
        ) : (
          <Button variant="primary" disabled={!review.dirty || review.busy} onClick={save} data-testid="ai-ext-save">
            {t("common.save")}
          </Button>
        )}
        <Button variant="danger-soft" onClick={remove} data-testid="ai-ext-remove">
          {t("ai.ext.review.remove")}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t("common.close")}
        </Button>
      </div>
    </div>
  );
}
