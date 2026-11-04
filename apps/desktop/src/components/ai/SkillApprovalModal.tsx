import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CodeXml, Eye, Plug, ScrollText, X } from "lucide-react";
import { approvalSeen } from "@plainva/core";
import {
  approvalContextOf,
  approvalFacts,
  Banner,
  Button,
  findWorkshopEntry,
  ICON,
  LineCompare,
  Modal,
  scriptCheckLine,
  ScriptCode,
  ServerSaid,
  serverSkillLines,
  serverSkillTextProblem,
  useAiSession,
  useAiState,
  useScriptCheck,
  useServerSkillText,
} from "@plainva/ui";

/**
 * One source before it may run on this device (plan KI-Harness P3-5, §14.3):
 * what it may do in words, what changed since the approved version, its
 * instructions, its files and where it lies. "Approve" binds exactly the
 * files shown; when they changed while the dialog was open, nothing is
 * approved and it says so. For the app's own skills the same view, without
 * an approval: they come with the app.
 *
 * A script (plan P5.5, mockup chapter 21) is shown the same way, with what a
 * program adds: its limits, the inputs it asks for, and its code in full —
 * read by the engine first, so code that is no JavaScript is not approved.
 * Its approval is this device's signature; where the keychain gives no key
 * to sign with, the dialog says that nothing was approved.
 *
 * A skill a connected server serves (plan P9-4b, mockup chapter 28): where it
 * comes from, what the server writes about it as the server's quote, every
 * file of its manifest with size and digest, what it may use and — where it
 * changed since its approval — what changed. Nothing of it was read; "Show
 * instructions" reads its SKILL.md and every file a model may read of it now,
 * checked, for exactly the version the dialog shows; and "Approve" keeps the
 * instructions that were read with the approval, so that a later version can
 * be held against them.
 */
export function SkillApprovalModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useAiSession();
  const state = useAiState();
  const [refusal, setRefusal] = useState<"changed" | "no-key" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const found = state ? findWorkshopEntry(state.skills, id) : null;
  const entry = found?.entry ?? null;
  const script = entry?.source.kind === "script";
  const check = useScriptCheck(session, script ? (entry?.source.code ?? null) : null);
  const instructions = useServerSkillText(session, entry?.source.origin === "server" ? id : null, entry?.source.origin === "server" ? approvalSeen(entry.source) : null);
  if (!session || !entry || !state) return null;
  const facts = approvalFacts(t, entry, i18n.language, approvalContextOf(state.skills, found?.group ?? null));
  const server = facts.server;
  const checked = check ? scriptCheckLine(t, check, facts.codeSize) : null;
  const changed = facts.status === "changed";
  // Code the engine does not read is not approved: there would be nothing to run.
  const canApprove = facts.canApprove && !(check && !check.ok);
  const approve = async () => {
    setBusy(true);
    // What was read of a server's skill goes with its approval — for exactly the version the dialog shows.
    const refused = await session.approveSource(id, facts.seen, instructions.result?.ok ? instructions.result.text : undefined);
    setBusy(false);
    if (refused === null) onClose();
    else setRefusal(refused);
  };
  return (
    <Modal
      title={server && facts.canApprove ? t("ai.workshop.server.reviewTitle", { server: server.label }) : facts.title}
      icon={server ? <Plug size={ICON.ui} /> : script ? <CodeXml size={ICON.ui} /> : <ScrollText size={ICON.ui} />}
      headerNote={t(`ai.workshop.status.${facts.status}`)}
      size="lg"
      onClose={onClose}
      testId="ai-skill-approval"
      footer={
        canApprove ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t("ai.workshop.notNow")}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void approve()} data-testid="ai-skill-approve">
              {t("ai.workshop.approve")}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )
      }
    >
      {refusal && (
        <Banner kind={refusal === "changed" ? "warning" : "error"} rounded testId="ai-skill-refusal">
          {refusal === "changed" ? t("ai.workshop.changedMeanwhile") : refusal === "no-key" ? t("ai.scripts.noKey") : server ? t("ai.workshop.server.cannotApprove") : t("ai.scripts.cannotApprove")}
        </Banner>
      )}
      <dl className="pv-skill-facts" data-testid={server ? "ai-server-skill-facts" : undefined}>
        {server && (
          <>
            <dt>{t("ai.workshop.server.serverLabel")}</dt>
            <dd>
              <span>
                <b>{server.label}</b>
                {server.place ? ` · ${server.place}` : ""}
              </span>
            </dd>
            <dt>{t("ai.workshop.server.name")}</dt>
            <dd>
              <span>{facts.title}</span>
              <span className="pv-skill-key">{t("ai.workshop.server.key", { key: server.key })}</span>
            </dd>
            {server.said && (
              <>
                <dt>{t("ai.workshop.server.description")}</dt>
                <dd>
                  <ServerSaid server={server.label} text={server.said} testId="ai-server-skill-said" />
                </dd>
              </>
            )}
          </>
        )}
        {facts.may.length > 0 && (
          <>
            <dt>{script ? t("ai.scripts.may") : t("ai.workshop.may")}</dt>
            <dd>
              {facts.may.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {facts.limits && (
          <>
            <dt>{t("ai.scripts.limits")}</dt>
            <dd>
              <span data-testid="ai-script-limits">{facts.limits}</span>
            </dd>
          </>
        )}
        {facts.inputs && (
          <>
            <dt>{t("ai.scripts.input")}</dt>
            <dd>
              {facts.inputs.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {facts.rights && (
          <>
            <dt>{t("ai.workshop.rights.title")}</dt>
            <dd data-testid="ai-skill-rights">
              {facts.rights.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {changed && !server && (
          <>
            <dt>{t("ai.workshop.changes")}</dt>
            <dd>{facts.changes ? <LineCompare lines={facts.changes} testId="ai-skill-changes" /> : <span>{t("ai.workshop.noChanges")}</span>}</dd>
          </>
        )}
        {server && facts.serverChanges && (
          <>
            <dt>{t("ai.workshop.changes")}</dt>
            <dd data-testid="ai-server-skill-changes">
              {facts.serverChanges.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </dd>
          </>
        )}
        {facts.text !== null && !(changed && facts.changes) && (
          <>
            <dt>{t("ai.workshop.instructions")}</dt>
            <dd>
              <LineCompare lines={null} fallback={facts.text} testId="ai-skill-text" />
            </dd>
          </>
        )}
        {/* A server's skill (plan P9-4b): its instructions are read only on the click, checked like a load. */}
        {server && !entry.source.tooLarge && entry.source.skill && (
          <>
            <dt>{t("ai.workshop.instructions")}</dt>
            <dd>
              {instructions.result?.ok ? (
                <>
                  <LineCompare lines={serverSkillLines(facts.approvedText, instructions.result.text)} fallback={instructions.result.text} testId="ai-skill-text" />
                  {instructions.result.files.map((file) => (
                    <span key={file.path} className="pv-skill-file" data-testid="ai-server-skill-file">
                      <code>{file.path}</code>
                      {file.text !== null ? <LineCompare lines={null} fallback={file.text} /> : <span className="pv-skill-key">{t(`ai.workshop.server.file.${file.problem ?? "digest"}`)}</span>}
                    </span>
                  ))}
                  {instructions.result.invisible > 0 && (
                    <Banner kind="warning" rounded testId="ai-server-skill-invisible">
                      {t("ai.workshop.invisible", { count: instructions.result.invisible })}
                    </Banner>
                  )}
                </>
              ) : (
                <span>
                  <Button size="sm" variant="ghost" icon={<Eye size={ICON.ui} />} disabled={instructions.reading} onClick={instructions.read} data-testid="ai-server-skill-view">
                    {instructions.reading ? t("ai.workshop.server.viewing") : t("ai.workshop.server.view")}
                  </Button>
                </span>
              )}
              {instructions.result && !instructions.result.ok && (
                <Banner kind="warning" rounded testId="ai-server-skill-view-problem">
                  {serverSkillTextProblem(t, instructions.result.reason)}
                </Banner>
              )}
            </dd>
          </>
        )}
        {typeof facts.code === "string" && (
          <>
            <dt>{t("ai.scripts.code")}</dt>
            <dd>
              <ScriptCode code={facts.code} testId="ai-script-code" />
              {checked ? (
                <span className="pv-skill-test-line" data-mark={checked.mark} data-testid="ai-script-check">
                  {checked.mark === "pass" ? <Check size={ICON.meta} aria-hidden="true" /> : <X size={ICON.meta} aria-hidden="true" />}
                  <span>{checked.text}</span>
                </span>
              ) : (
                facts.codeSize && <span>{facts.codeSize}</span>
              )}
            </dd>
          </>
        )}
        <dt>{t("ai.workshop.files")}</dt>
        <dd data-testid="ai-skill-files">
          {facts.files.map((file) => (
            <span key={file.path}>
              <code>{file.path}</code> · {file.size}
              {file.digest ? <> · <code>{file.digest}</code></> : null}
            </span>
          ))}
        </dd>
        <dt>{t("ai.workshop.origin")}</dt>
        <dd>
          {facts.origin.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </dd>
      </dl>
      {facts.widened && (
        <Banner kind="warning" rounded testId="ai-skill-wider">
          {t("ai.workshop.rights.widened")}
        </Banner>
      )}
      {facts.warnings.map((warning) => (
        <Banner key={warning} kind="warning" rounded>
          {warning}
        </Banner>
      ))}
      {facts.problems.length > 0 && (
        <Banner kind="error" rounded>
          {facts.problems.join(" ")}
        </Banner>
      )}
      {canApprove && <p className="pv-modal-hint">{server ? t("ai.workshop.server.approvalHint") : script ? t("ai.scripts.approvalHint") : t("ai.workshop.approvalHint")}</p>}
    </Modal>
  );
}
