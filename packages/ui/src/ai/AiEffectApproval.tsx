import { useTranslation } from "react-i18next";
import { FolderInput, Globe, Mail, PencilLine, Plug, ShieldCheck, ShieldOff, TriangleAlert, Users } from "lucide-react";
import { LineCompare } from "../components/LineCompare";
import { Button } from "../components/ui/Button";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import type { EffectAnswer, EffectRequest } from "./aiSession";

/**
 * The approval of ONE request to the internet (plan KI-Harness P4, the Rule
 * of Two): while notes are in a conversation, every page the model wants to
 * read and every search it wants to make waits here. It shows the whole
 * address or query — that is everything that leaves the device for it — and
 * says where the address came from: one the model put together itself is the
 * one that could carry something out of the notes.
 *
 * And the approval of a kind of data no send overview named (plan P4-4):
 * mail, which the assistant reaches through its tool search. Asked at its
 * first call, once for a recipient, and it says who reads a message's text —
 * a model on this device, or the provider.
 *
 * And the approval of one call to a tool of a foreign server (plan P4.5):
 * the server, the tool and the arguments in full, every time.
 *
 * Built from the send overview's parts: it is the same kind of question, asked
 * at the same place, above the composer.
 */
export interface AiEffectApprovalProps {
  request: EffectRequest;
  onAnswer: (answer: EffectAnswer) => void;
  touch?: boolean;
}

function AiDataApproval({ request, onAnswer, touch }: { request: Extract<EffectRequest, { kind: "data" }>; onAnswer: (answer: EffectAnswer) => void; touch?: boolean }) {
  const { t } = useTranslation();
  const title = t("ai.mail.ask.title");
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-effect" data-kind="mail">
      <h4 className="pv-ai-overview-head">
        <Mail size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <dl className="pv-ai-overview-list">
        <dt>{t("ai.overview.goesTo")}</dt>
        <dd data-testid="ai-effect-recipient">{request.provider}</dd>
        <dt>{t("ai.mail.ask.what")}</dt>
        <dd>{t("ai.mail.ask.heads")}</dd>
        <dt>{t("ai.mail.ask.text")}</dt>
        <dd data-testid="ai-effect-reader">
          {request.reader === "device" ? t("ai.mail.ask.textDevice", { reader: request.readerLabel, provider: request.provider }) : t("ai.mail.ask.textProvider", { provider: request.provider })}
        </dd>
      </dl>
      <span className="pv-ai-overview-hint">{t("ai.mail.ask.scope", { provider: request.provider })}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer("deny")} data-testid="ai-effect-deny">
          {t("ai.mail.ask.deny")}
        </Button>
        <Button variant="primary" onClick={() => onAnswer("always")} data-testid="ai-effect-allow">
          {t("ai.mail.ask.allow")}
        </Button>
      </div>
    </section>
  );
}

/**
 * A note about to be written where other people read it (plan P4-6, §12.1):
 * an answer kept as a note inside a shared workspace. The same card, asked
 * each time — a yes for one note says nothing about the next.
 */
function AiWriteApproval({ request, onAnswer, touch }: { request: Extract<EffectRequest, { kind: "write" }>; onAnswer: (answer: EffectAnswer) => void; touch?: boolean }) {
  const { t } = useTranslation();
  const title = t("ai.capture.shared.title");
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-effect" data-kind="write">
      <h4 className="pv-ai-overview-head">
        <Users size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <dl className="pv-ai-overview-list">
        <dt>{t("ai.capture.shared.note")}</dt>
        <dd data-testid="ai-effect-note">{request.title}</dd>
        <dt>{t("ai.capture.shared.folder")}</dt>
        <dd>{request.folder || "/"}</dd>
      </dl>
      <span className="pv-ai-overview-hint">{t("ai.capture.shared.hint")}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer("deny")} data-testid="ai-effect-deny">
          {t("ai.capture.shared.deny")}
        </Button>
        <Button variant="primary" onClick={() => onAnswer("once")} data-testid="ai-effect-allow">
          {t("ai.capture.action")}
        </Button>
      </div>
    </section>
  );
}

/**
 * One call to a tool of a foreign server (plan P4.5, §17.2): the server by
 * the user's own name for it, the tool, and the arguments in full — exactly
 * what would leave. Asked for every call; there is no "from now on".
 */
function AiExternalCallApproval({ request, onAnswer, touch }: { request: Extract<EffectRequest, { kind: "mcp" }>; onAnswer: (answer: EffectAnswer) => void; touch?: boolean }) {
  const { t } = useTranslation();
  const title = t("ai.ext.ask.title", { server: request.server });
  const empty = request.args.trim() === "{}";
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-effect" data-kind="mcp">
      <h4 className="pv-ai-overview-head">
        <Plug size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <dl className="pv-ai-overview-list">
        <dt>{t("ai.overview.goesTo")}</dt>
        <dd data-testid="ai-effect-recipient">{request.server}</dd>
        <dt>{t("ai.ext.ask.tool")}</dt>
        <dd data-testid="ai-effect-tool">{request.title === request.tool ? request.tool : `${request.title} (${request.tool})`}</dd>
        <dt>{t("ai.ext.ask.data")}</dt>
        <dd>{empty ? t("ai.ext.ask.nothing") : <LineCompare lines={null} fallback={request.args} testId="ai-effect-args" />}</dd>
      </dl>
      <span className="pv-ai-overview-hint">{t("ai.ext.ask.hint", { server: request.server })}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer("deny")} data-testid="ai-effect-deny">
          {t("ai.ext.ask.deny")}
        </Button>
        <Button variant="primary" onClick={() => onAnswer("once")} data-testid="ai-effect-once">
          {t("ai.ext.ask.send")}
        </Button>
      </div>
    </section>
  );
}

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** The notes a rename's card names; the rest is a count. */
const PLAN_FILES_SHOWN = 6;

/** The words of each plan: its question, the line that says who does it, and its two buttons. */
const PLAN_WORDS = {
  rename: { title: "ai.write.plan.renameTitle", hint: "ai.write.plan.renameHint", deny: "ai.write.plan.noRename", go: "ai.write.plan.rename" },
  move: { title: "ai.write.plan.moveTitle", hint: "ai.write.plan.moveHint", deny: "ai.write.plan.noMove", go: "ai.write.plan.move" },
  delete: { title: "ai.write.plan.deleteTitle", hint: "ai.write.plan.deleteHint", deny: "ai.write.plan.noDelete", go: "ai.write.plan.openDelete" },
  rule: { title: "ai.write.plan.ruleTitle", hint: "ai.write.plan.ruleHint", deny: "ai.write.plan.noRule", go: "ai.write.plan.setRule" },
} as const;

/**
 * A plan (plan KI-Harness P5, ADR 0019 §2): what cannot be reviewed part by
 * part — a rename, a move, a deletion —, and what must never wait in a margin
 * where "accept all" could take it along: one of the note's own AI rules
 * (P5-3). The run waits here, above the composer, and the card shows what
 * would happen: the new name with every note whose links change, the folder,
 * the note that would go, or the rule and whether it is written or taken
 * out. A yes lets the app's own operation do it; for a deletion it opens the
 * app's delete dialog, and nothing is gone before the user confirms there.
 * Taking a rule out lets the note go where it could not, so that card warns
 * and its button is not the one the eye lands on.
 *
 * Everything on the card is for the user: the model is told the outcome and
 * nothing else — not which notes link here, not which rule a folder has.
 */
function AiPlanApproval({ request, onAnswer, touch }: { request: Extract<EffectRequest, { kind: "plan" }>; onAnswer: (answer: EffectAnswer) => void; touch?: boolean }) {
  const { t } = useTranslation();
  const question = request.question;
  const words = PLAN_WORDS[question.plan];
  const title = t(words.title);
  const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
  // Taking a rule out lets the note go where it could not: like a deletion, that is no step this card makes look like the obvious one.
  const loosening = question.plan === "rule" && !question.set;
  const Icon = question.plan === "rename" ? PencilLine : question.plan === "move" ? FolderInput : question.plan === "rule" ? (question.set ? ShieldCheck : ShieldOff) : TriangleAlert;
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-effect" data-kind="plan" data-plan={question.plan}>
      <h4 className="pv-ai-overview-head">
        <Icon size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <dl className="pv-ai-overview-list">
        <dt>{t("ai.write.plan.note")}</dt>
        <dd data-testid="ai-effect-note">
          {noteName(question.path)}
          {folderOf(question.path) ? ` · ${folderOf(question.path)}` : ""}
        </dd>
        {question.plan === "rename" && (
          <>
            <dt>{t("ai.write.plan.newName")}</dt>
            <dd data-testid="ai-effect-target">{question.title}</dd>
            <dt>{t("ai.write.plan.links")}</dt>
            <dd data-testid="ai-effect-links">
              {question.links === 0
                ? t("ai.write.plan.linksNone")
                : t("ai.write.plan.linksIn", { links: t("ai.write.plan.linkCount", { count: question.links }), notes: t("ai.write.plan.noteCount", { count: question.files.length }) })}
            </dd>
          </>
        )}
        {question.plan === "move" && (
          <>
            <dt>{t("ai.write.plan.folder")}</dt>
            <dd data-testid="ai-effect-target">{question.folder || t("ai.write.plan.vaultRoot")}</dd>
          </>
        )}
        {question.plan === "rule" && (
          <>
            <dt>{t("ai.write.plan.ruleRow")}</dt>
            <dd data-testid="ai-effect-rule">{t(`ai.write.plan.rule.${question.rule}`)}</dd>
            <dt>{t("ai.write.plan.ruleChange")}</dt>
            <dd data-testid="ai-effect-change">{t(question.set ? "ai.write.plan.ruleSet" : "ai.write.plan.ruleRemove")}</dd>
          </>
        )}
      </dl>
      {question.plan === "rename" && question.files.length > 0 && (
        <ul className="pv-ai-overview-sources" data-testid="ai-effect-files">
          {question.files.slice(0, PLAN_FILES_SHOWN).map((file) => (
            <li key={file.path}>
              <span className="pv-ai-overview-note">{file.path.replace(/\.md$/i, "")}</span>
              <span className="pv-ai-overview-form">{t("ai.write.plan.linkCount", { count: file.links })}</span>
            </li>
          ))}
          {question.files.length > PLAN_FILES_SHOWN && (
            <li>
              <span className="pv-ai-overview-form">{t("ai.write.plan.moreNotes", { count: question.files.length - PLAN_FILES_SHOWN })}</span>
            </li>
          )}
        </ul>
      )}
      {question.plan === "move" && question.loosens.length > 0 && (
        <span className="pv-ai-effect-warn" data-testid="ai-effect-loosens">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t("ai.write.plan.loosens", { rules: question.loosens.map((rule) => t(`ai.write.plan.rule.${rule}`)).join(" · ") })}</span>
        </span>
      )}
      {loosening && (
        <span className="pv-ai-effect-warn" data-testid="ai-effect-loosens">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t(question.rule === "cloud" ? "ai.write.plan.ruleLoosensCloud" : "ai.write.plan.ruleLoosensWeb")}</span>
        </span>
      )}
      <span className="pv-ai-overview-hint">{t(words.hint)}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer("deny")} data-testid="ai-effect-deny">
          {t(words.deny)}
        </Button>
        {/* A deletion is not this card's to carry out: the button opens the app's own dialog. */}
        <Button variant={question.plan === "delete" || loosening ? "secondary" : "primary"} onClick={() => onAnswer("once")} data-testid="ai-effect-once">
          {t(loosening ? "ai.write.plan.removeRule" : words.go)}
        </Button>
      </div>
    </section>
  );
}

export function AiEffectApproval({ request, onAnswer, touch }: AiEffectApprovalProps) {
  const { t } = useTranslation();
  if (request.kind === "data") return <AiDataApproval request={request} onAnswer={onAnswer} touch={touch} />;
  if (request.kind === "write") return <AiWriteApproval request={request} onAnswer={onAnswer} touch={touch} />;
  if (request.kind === "mcp") return <AiExternalCallApproval request={request} onAnswer={onAnswer} touch={touch} />;
  if (request.kind === "plan") return <AiPlanApproval request={request} onAnswer={onAnswer} touch={touch} />;
  const fetch = request.kind === "fetch";
  const title = fetch ? t("ai.web.ask.fetchTitle") : t("ai.web.ask.searchTitle");
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-effect">
      <h4 className="pv-ai-overview-head">
        <Globe size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      {fetch ? (
        <dl className="pv-ai-overview-list">
          <dt>{t("ai.web.ask.address")}</dt>
          <dd data-testid="ai-effect-address">{request.url}</dd>
          {request.question && (
            <>
              <dt>{t("ai.web.ask.lookingFor")}</dt>
              <dd>{request.question}</dd>
            </>
          )}
        </dl>
      ) : (
        <dl className="pv-ai-overview-list">
          <dt>{t("ai.web.ask.query")}</dt>
          <dd data-testid="ai-effect-query">{request.query}</dd>
          <dt>{t("ai.web.ask.through")}</dt>
          <dd>{request.provider}</dd>
        </dl>
      )}
      {fetch && request.origin === "model" ? (
        <span className="pv-ai-effect-warn" data-testid="ai-effect-built">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t("ai.web.ask.originModel")}</span>
        </span>
      ) : (
        fetch && <span className="pv-ai-overview-hint">{t(request.origin === "user" ? "ai.web.ask.originUser" : "ai.web.ask.originSource")}</span>
      )}
      <span className="pv-ai-overview-hint">{fetch ? t("ai.web.ask.fetchHint", { host: request.host }) : t("ai.web.ask.searchHint", { provider: request.provider })}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer("deny")} data-testid="ai-effect-deny">
          {fetch ? t("ai.web.ask.denyFetch") : t("ai.web.ask.denySearch")}
        </Button>
        {/* A standing approval never covers an address the model composed, so it is not offered for one. */}
        {fetch && request.origin !== "model" && (
          <Button variant="secondary" onClick={() => onAnswer("always")} data-testid="ai-effect-always">
            {t("ai.web.ask.always", { host: request.host })}
          </Button>
        )}
        <Button variant="primary" onClick={() => onAnswer("once")} data-testid="ai-effect-once">
          {fetch ? t("ai.web.ask.fetch") : t("ai.web.ask.search")}
        </Button>
      </div>
    </section>
  );
}
