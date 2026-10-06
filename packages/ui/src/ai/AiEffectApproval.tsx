import { useTranslation } from "react-i18next";
import { Globe, Mail, TriangleAlert } from "lucide-react";
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

export function AiEffectApproval({ request, onAnswer, touch }: AiEffectApprovalProps) {
  const { t } = useTranslation();
  if (request.kind === "data") return <AiDataApproval request={request} onAnswer={onAnswer} touch={touch} />;
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
