import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plug } from "lucide-react";
import { LineCompare } from "../components/LineCompare";
import { Button } from "../components/ui/Button";
import { TextInput } from "../components/ui/Field";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import type { ExternalPrompt } from "./externalTools";
import type { McpPromptReview } from "./mcpSession";

/**
 * A prompt of a foreign server on its way into a conversation (plan
 * KI-Harness P4.5): the values it asks for, and — the first time an expansion
 * is used — the text the server answered with, shown in full before it goes.
 * A prompt becomes the user's message, so the user reads it first; from then
 * on that same text goes without asking, and another text blocks the server.
 *
 * Asked where the send overview is asked, above the composer, in its dress.
 */
export interface AiExternalPromptProps {
  prompt: ExternalPrompt;
  /** The expansion that waits to be read; null while the values are still asked for. */
  review: McpPromptReview | null;
  busy: boolean;
  onStart: (args: Record<string, string>) => void;
  onSend: () => void;
  onCancel: () => void;
  touch?: boolean;
}

export function AiExternalPrompt({ prompt, review, busy, onStart, onSend, onCancel, touch }: AiExternalPromptProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const title = `${prompt.server} · ${prompt.title}`;
  const missing = prompt.args.some((arg) => arg.required && !(values[arg.name] ?? "").trim());
  const start = () => {
    const args: Record<string, string> = {};
    for (const arg of prompt.args) {
      const value = (values[arg.name] ?? "").trim();
      if (value) args[arg.name] = value;
    }
    onStart(args);
  };
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-ext-prompt">
      <h4 className="pv-ai-overview-head">
        <Plug size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      {review ? (
        <>
          <LineCompare lines={null} fallback={review.text} testId="ai-ext-prompt-text" />
          {review.truncated && <span className="pv-ai-overview-hint">{t("ai.ext.prompt.truncated")}</span>}
          {review.dropped > 0 && <span className="pv-ai-overview-hint">{t("ai.ext.prompt.dropped", { n: review.dropped })}</span>}
          <span className="pv-ai-overview-hint">{t("ai.ext.prompt.reviewNote", { server: review.server })}</span>
        </>
      ) : (
        <>
          {prompt.description && <span className="pv-ai-overview-hint">{prompt.description}</span>}
          <dl className="pv-ai-overview-list">
            {prompt.args.map((arg) => (
              <Fragment key={arg.name}>
                <dt>
                  <label htmlFor={`pv-ext-arg-${arg.name}`}>{arg.required ? arg.name : t("ai.ext.prompt.optional", { name: arg.name })}</label>
                </dt>
                <dd>
                  <TextInput
                    id={`pv-ext-arg-${arg.name}`}
                    value={values[arg.name] ?? ""}
                    placeholder={arg.description}
                    onChange={(event) => setValues((before) => ({ ...before, [arg.name]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !missing && !busy) start();
                    }}
                    data-testid="ai-ext-prompt-arg"
                  />
                </dd>
              </Fragment>
            ))}
          </dl>
        </>
      )}
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={onCancel} data-testid="ai-ext-prompt-cancel">
          {t("common.cancel")}
        </Button>
        {review ? (
          <Button variant="primary" disabled={busy} onClick={onSend} data-testid="ai-ext-prompt-send">
            {t("ai.ext.prompt.send")}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || missing} onClick={start} data-testid="ai-ext-prompt-start">
            {t("ai.ext.prompt.start")}
          </Button>
        )}
      </div>
    </section>
  );
}
