import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug } from "lucide-react";
import {
  AiExternalReview,
  Banner,
  Button,
  Checkbox,
  externalStatusText,
  externalTopFolders,
  ICON,
  Modal,
  Segmented,
  TextArea,
  TextInput,
  toast,
  useExternalAdd,
  useExternalReview,
  type AiMcpServer,
  type AiSession,
  type ExternalKind,
} from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";

/**
 * The two dialogs of "External tools (MCP)" on the desktop (plan KI-Harness
 * P4.5): adding a server, and the review of one. Their state is the shared
 * model (`useExternalAdd`, `useExternalReview`), and the review's body is the
 * shared `AiExternalReview`; the phone dresses the same as sheets.
 */

/** Add a server: an address, or — on a computer — a program. The native side shows what was typed once more and asks. */
export function ExternalAddDialog({ session, programs, onClose, onAdded }: { session: AiSession; programs: boolean; onClose: () => void; onAdded: (id: string) => void }) {
  const { t } = useTranslation();
  const form = useExternalAdd(session, t, programs);
  const submit = () => {
    void form.submit().then((id) => {
      if (id) onAdded(id);
    });
  };
  return (
    <Modal
      title={t("ai.ext.add.title")}
      icon={<Plug size={ICON.ui} />}
      size="md"
      onClose={onClose}
      testId="ai-ext-add"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!form.ready || form.busy} onClick={submit} data-testid="ai-ext-add-submit">
            {t("ai.ext.add.submit")}
          </Button>
        </>
      }
    >
      <label className="pv-modal-label" htmlFor="pv-ext-name">
        {t("ai.ext.add.name")}
      </label>
      <TextInput id="pv-ext-name" value={form.name} maxLength={60} onChange={(event) => form.setName(event.target.value)} data-testid="ai-ext-add-name" />
      <p className="pv-modal-hint">{t("ai.ext.add.nameHint")}</p>
      {programs && (
        <Segmented<ExternalKind>
          ariaLabel={t("ai.ext.add.kind")}
          value={form.kind}
          onChange={form.setKind}
          options={[
            { value: "address", label: t("ai.ext.add.address"), testId: "ai-ext-add-kind-address" },
            { value: "program", label: t("ai.ext.add.kindProgram"), testId: "ai-ext-add-kind-program" },
          ]}
        />
      )}
      {form.kind === "address" ? (
        <>
          <label className="pv-modal-label" htmlFor="pv-ext-url">
            {t("ai.ext.add.address")}
          </label>
          <TextInput id="pv-ext-url" value={form.url} spellCheck={false} autoComplete="off" placeholder="https://…" onChange={(event) => form.setUrl(event.target.value)} data-testid="ai-ext-add-url" />
          <p className="pv-modal-hint">{form.addressHint ?? t("ai.ext.add.addressHint")}</p>
          <label className="pv-modal-label" htmlFor="pv-ext-token">
            {t("ai.ext.add.token")}
          </label>
          <TextInput id="pv-ext-token" type="password" autoComplete="off" spellCheck={false} value={form.token} onChange={(event) => form.setToken(event.target.value)} data-testid="ai-ext-add-token" />
          <p className="pv-modal-hint">{t("ai.ext.add.tokenHint")}</p>
        </>
      ) : (
        <>
          <label className="pv-modal-label" htmlFor="pv-ext-program">
            {t("ai.ext.add.program")}
          </label>
          <TextInput id="pv-ext-program" value={form.program} spellCheck={false} autoComplete="off" onChange={(event) => form.setProgram(event.target.value)} data-testid="ai-ext-add-program" />
          <p className="pv-modal-hint">{t("ai.ext.add.programHint")}</p>
          <label className="pv-modal-label" htmlFor="pv-ext-args">
            {t("ai.ext.add.args")}
          </label>
          <TextArea id="pv-ext-args" rows={3} value={form.args} spellCheck={false} onChange={(event) => form.setArgs(event.target.value)} data-testid="ai-ext-add-args" />
          <label className="pv-modal-label" htmlFor="pv-ext-env">
            {t("ai.ext.add.env")}
          </label>
          <TextArea id="pv-ext-env" rows={2} value={form.env} spellCheck={false} onChange={(event) => form.setEnv(event.target.value)} data-testid="ai-ext-add-env" />
          <p className="pv-modal-hint">{form.envProblem ?? t("ai.ext.add.envHint")}</p>
          <Checkbox checked={form.sandbox} disabled={!form.sandboxInfo?.works} onChange={(event) => form.setSandbox(event.target.checked)} data-testid="ai-ext-add-sandbox">
            {t("ai.ext.add.sandbox")}
          </Checkbox>
          <p className="pv-modal-hint">{t(form.sandboxInfo?.works ? "ai.ext.add.sandboxDesc" : "ai.ext.add.sandboxNone")}</p>
        </>
      )}
      {form.risky && (
        <Banner kind="warning" rounded>
          {t("ai.ext.add.risky")}
        </Banner>
      )}
      {form.problem && (
        <Banner kind="error" rounded>
          {form.problem}
        </Banner>
      )}
      <p className="pv-modal-hint">{t(form.kind === "address" ? "ai.ext.add.confirmNoteAddress" : "ai.ext.add.confirmNoteProgram")}</p>
    </Modal>
  );
}

/**
 * The review of one server. "Approve" binds exactly the texts shown; for a
 * server that is approved already the same button stores this vault's
 * choices.
 */
export function ExternalReviewDialog({ session, servers, serverId, onClose }: { session: AiSession; servers: readonly AiMcpServer[]; serverId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { queryService } = useVault();
  const review = useExternalReview(session, servers, serverId, t);
  const [vaultFolders, setVaultFolders] = useState<string[]>([]);
  useEffect(() => {
    if (!queryService) return;
    let alive = true;
    void queryService
      .getAllFolders()
      .catch(() => [] as string[])
      .then((all) => {
        if (alive) setVaultFolders(externalTopFolders(all));
      });
    return () => {
      alive = false;
    };
  }, [queryService]);

  const { server } = review;
  if (!server) return null;
  const save = () => {
    void review.save().then((done) => {
      if (done) onClose();
      else toast.error(t("ai.ext.review.notApproved"));
    });
  };
  const remove = () => {
    void appConfirm({ title: t("ai.ext.review.removeConfirm", { server: server.label }), message: t("ai.ext.review.removeBody"), confirmLabel: t("ai.ext.review.remove") }).then((yes) => {
      if (yes) void session.mcp.remove(server.id).then(onClose);
    });
  };
  return (
    <Modal
      title={server.label}
      icon={<Plug size={ICON.ui} />}
      headerNote={externalStatusText(t, server)}
      size="lg"
      onClose={onClose}
      testId="ai-ext-review"
      footer={
        <>
          <Button variant="danger-soft" onClick={remove} data-testid="ai-ext-remove">
            {t("ai.ext.review.remove")}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {review.needsApproval ? (
            <Button variant="primary" disabled={!review.canApprove || review.busy} onClick={save} data-testid="ai-ext-approve">
              {t("ai.ext.review.approve")}
            </Button>
          ) : (
            <Button variant="primary" disabled={!review.dirty || review.busy} onClick={save} data-testid="ai-ext-save">
              {t("common.save")}
            </Button>
          )}
        </>
      }
    >
      <AiExternalReview review={review} vaultFolders={vaultFolders} />
    </Modal>
  );
}
