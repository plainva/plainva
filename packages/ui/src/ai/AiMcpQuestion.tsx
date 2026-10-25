import { useId, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Globe, Plug, ShieldOff, TriangleAlert } from "lucide-react";
import { checkMcpElicitAnswer, mcpElicitDefaults, type McpElicitation, type McpElicitField, type McpElicitProblem, type McpElicitResult } from "@plainva/core";
import { Button } from "../components/ui/Button";
import { Checkbox } from "../components/ui/Checkbox";
import { TextInput } from "../components/ui/Field";
import { Select } from "../components/ui/Select";
import { cx } from "../components/ui/cx";
import { ICON } from "../lib/iconSizes";
import type { McpQuestionRequest } from "./aiSession";

/**
 * A question of a foreign MCP server to the user (plan KI-Harness P9-4a),
 * above the composer, in the dress of the question about a call: Plainva's
 * card, in Plainva's words — the title, the buttons, the hints. What the
 * server wrote — its message, the names and descriptions of its fields, the
 * texts of its choices — stands inside it as the server's quote, framed and
 * attributed, never as a title or a button: a server cannot ask anything
 * that looks as if Plainva asked it.
 *
 * Three forms. A form to fill in, checked before it goes — or a question
 * with no field, which asks the user to confirm. A page to open,
 * shown whole with its host apart, opened only on the user's click in the
 * system's browser. And a question Plainva refused — one that asked for a
 * password, a key or payment data, or one it cannot show — which says so and
 * is closed. The answer goes to the server and to nobody else.
 */
export interface AiMcpQuestionProps {
  request: McpQuestionRequest;
  onAnswer: (answer: McpElicitResult) => void;
  onOpenPage: () => void;
  touch?: boolean;
}

/** The server's words, framed and attributed: a quote inside Plainva's card. */
function ServerSaid({ server, text }: { server: string; text: string }) {
  const { t } = useTranslation();
  return (
    <blockquote className="pv-ai-said" data-testid="ai-question-said">
      <span className="pv-ai-said-by">{t("ai.ext.question.writes", { server })}</span>
      <span>{text}</span>
    </blockquote>
  );
}

/** Where the question comes from: the call of a tool, or a prompt the user started. */
function During({ request }: { request: McpQuestionRequest }) {
  const { t } = useTranslation();
  const during = request.during;
  return (
    <dl className="pv-ai-overview-list">
      <dt>{t("ai.ext.question.during")}</dt>
      <dd data-testid="ai-question-during">
        {during.kind === "tool" ? (during.title === during.tool ? during.tool : `${during.title} (${during.tool})`) : t("ai.ext.question.prompt", { name: during.name })}
      </dd>
    </dl>
  );
}

function problemText(t: ReturnType<typeof useTranslation>["t"], problem: McpElicitProblem): string {
  switch (problem) {
    case "required":
      return t("ai.ext.question.problem.required");
    case "short":
      return t("ai.ext.question.problem.short");
    case "long":
      return t("ai.ext.question.problem.long");
    case "format":
      return t("ai.ext.question.problem.format");
    case "range":
      return t("ai.ext.question.problem.range");
    case "count":
      return t("ai.ext.question.problem.count");
  }
}

/** A number's bounds in Plainva's words; empty where the server gave none. */
function rangeText(t: ReturnType<typeof useTranslation>["t"], field: Extract<McpElicitField, { kind: "number" }>): string {
  if (field.minimum !== undefined && field.maximum !== undefined) return t("ai.ext.question.range", { min: field.minimum, max: field.maximum });
  if (field.minimum !== undefined) return t("ai.ext.question.rangeMin", { min: field.minimum });
  if (field.maximum !== undefined) return t("ai.ext.question.rangeMax", { max: field.maximum });
  return "";
}

/** The decimal separator of a language, as the user writes numbers in it. */
function decimalOf(language: string): "." | "," {
  try {
    return new Intl.NumberFormat(language).formatToParts(1.5).find((part) => part.type === "decimal")?.value === "," ? "," : ".";
  } catch {
    return ".";
  }
}

/** A moment as the device's time field shows it: `YYYY-MM-DDTHH:mm`, or nothing where it is none. */
function localMoment(value: unknown): string {
  if (typeof value !== "string") return "";
  const at = Date.parse(value);
  if (Number.isNaN(at)) return "";
  const d = new Date(at);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

function startValues(question: Extract<McpElicitation, { kind: "form" }>): Record<string, unknown> {
  const values = mcpElicitDefaults(question);
  for (const field of question.fields) if (field.kind === "text" && field.format === "date-time" && values[field.name] !== undefined) values[field.name] = localMoment(values[field.name]);
  return values;
}

const INPUT_TYPE: Record<string, string> = { email: "email", uri: "url", date: "date", "date-time": "datetime-local" };

function QuestionForm({ request, question, onAnswer, touch }: { request: McpQuestionRequest; question: Extract<McpElicitation, { kind: "form" }>; onAnswer: (answer: McpElicitResult) => void; touch?: boolean }) {
  const { t, i18n } = useTranslation();
  const formId = useId();
  const decimal = useMemo(() => decimalOf(i18n.language), [i18n.language]);
  const [values, setValues] = useState<Record<string, unknown>>(() => startValues(question));
  const [problems, setProblems] = useState<Partial<Record<string, McpElicitProblem>>>({});
  const set = (name: string, value: unknown) => {
    setValues((before) => ({ ...before, [name]: value }));
    setProblems((before) => {
      if (!(name in before)) return before;
      const next = { ...before };
      delete next[name];
      return next;
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = checkMcpElicitAnswer(question, values, { decimal });
    if (!checked.ok) {
      setProblems(checked.problems);
      return;
    }
    onAnswer({ action: "accept", content: checked.content });
  };
  const title = t("ai.ext.question.title", { server: request.server });
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-question" data-kind="form">
      <h4 className="pv-ai-overview-head">
        <Plug size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <During request={request} />
      {question.message && <ServerSaid server={request.server} text={question.message} />}
      {/* No field: the server asks the user to confirm, and the card is the question and its buttons. */}
      <form id={formId} className={question.fields.length ? "pv-ai-question-fields" : undefined} onSubmit={submit} noValidate>
        {question.fields.map((field) => {
          const id = `${formId}-${field.name}`;
          const problem = problems[field.name];
          const label = (
            <>
              <span className="pv-ai-question-label">{field.title}</span>
              {!field.required && field.kind !== "boolean" && <span className="pv-ai-question-optional"> · {t("ai.ext.question.optional")}</span>}
            </>
          );
          const extra = field.kind === "number" ? rangeText(t, field) : "";
          return (
            <div key={field.name} className="pv-ai-question-field" data-testid="ai-question-field" data-name={field.name} data-field={field.kind}>
              {field.kind === "boolean" ? (
                <Checkbox checked={values[field.name] === true} onChange={(event) => set(field.name, event.target.checked)} data-testid="ai-question-input">
                  {label}
                </Checkbox>
              ) : field.kind === "choices" ? (
                <fieldset className="pv-ai-question-choices">
                  <legend>{label}</legend>
                  {field.choices.map((choice) => {
                    const picked = Array.isArray(values[field.name]) ? (values[field.name] as string[]) : [];
                    return (
                      <Checkbox
                        key={choice.value}
                        checked={picked.includes(choice.value)}
                        onChange={(event) => set(field.name, event.target.checked ? [...picked, choice.value] : picked.filter((value) => value !== choice.value))}
                        data-testid="ai-question-choice"
                      >
                        <span className="pv-ai-question-label">{choice.label}</span>
                      </Checkbox>
                    );
                  })}
                </fieldset>
              ) : (
                <>
                  {field.kind === "choice" ? <span className="pv-ai-question-name">{label}</span> : <label htmlFor={id}>{label}</label>}
                  {field.kind === "choice" ? (
                    <Select
                      value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
                      // A choice that is not required can be taken back: the dash is "none".
                      options={[...(field.required ? [] : [{ value: "", label: "—" }]), ...field.choices.map((choice) => ({ value: choice.value, label: choice.label }))]}
                      onChange={(value) => set(field.name, value)}
                      ariaLabel={field.title}
                      placeholder={t("ai.ext.question.choose")}
                      minWidth="100%"
                      data-testid="ai-question-input"
                    />
                  ) : (
                    <TextInput
                      id={id}
                      type={field.kind === "text" && field.format ? INPUT_TYPE[field.format] : "text"}
                      // A keypad has no minus: where the number may be negative, the whole keyboard comes up.
                      inputMode={field.kind === "number" ? (field.minimum !== undefined && field.minimum >= 0 ? (field.integer ? "numeric" : "decimal") : "text") : undefined}
                      purpose={field.kind === "number" || field.format === "date" || field.format === "date-time" ? "number" : field.format ? "address" : "prose"}
                      value={typeof values[field.name] === "string" || typeof values[field.name] === "number" ? String(values[field.name]) : ""}
                      maxLength={field.kind === "text" ? field.maxLength : undefined}
                      aria-invalid={problem ? true : undefined}
                      onChange={(event) => set(field.name, event.target.value)}
                      data-testid="ai-question-input"
                    />
                  )}
                </>
              )}
              {(field.description || extra) && <span className="pv-ai-question-desc">{[field.description, extra].filter(Boolean).join(" · ")}</span>}
              {problem && (
                <span className="pv-ai-question-problem" role="alert" data-testid="ai-question-problem">
                  {problemText(t, problem)}
                </span>
              )}
            </div>
          );
        })}
      </form>
      <span className="pv-ai-overview-hint">{t("ai.ext.question.hint", { server: request.server })}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer({ action: "cancel" })} data-testid="ai-question-cancel">
          {t("common.cancel")}
        </Button>
        <Button variant="secondary" onClick={() => onAnswer({ action: "decline" })} data-testid="ai-question-decline">
          {t("ai.ext.question.decline")}
        </Button>
        <Button variant="primary" type="submit" form={formId} data-testid="ai-question-answer">
          {question.fields.length ? t("ai.ext.question.answer") : t("ai.ext.question.confirm")}
        </Button>
      </div>
    </section>
  );
}

function QuestionPage({ request, question, onAnswer, onOpenPage, touch }: { request: McpQuestionRequest; question: Extract<McpElicitation, { kind: "url" }>; onAnswer: (answer: McpElicitResult) => void; onOpenPage: () => void; touch?: boolean }) {
  const { t } = useTranslation();
  const title = t("ai.ext.question.pageTitle", { server: request.server });
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-question" data-kind="url" data-opened={request.opened ? "true" : "false"}>
      <h4 className="pv-ai-overview-head">
        <Globe size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <During request={request} />
      {question.message && <ServerSaid server={request.server} text={question.message} />}
      <div className="pv-ai-question-url" data-testid="ai-question-url">
        <span className="pv-ai-question-host" data-testid="ai-question-host">
          {question.host}
        </span>
        <span className="pv-ai-question-address">
          {question.prefix}
          <b>{question.host}</b>
          {question.rest}
        </span>
      </div>
      {question.punycode && (
        <span className="pv-ai-effect-warn" data-testid="ai-question-punycode">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t("ai.ext.question.punycode")}</span>
        </span>
      )}
      {question.ip && (
        <span className="pv-ai-effect-warn" data-testid="ai-question-ip">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t("ai.ext.question.ipAddress")}</span>
        </span>
      )}
      {request.openFailed && (
        <span className="pv-ai-effect-warn" data-testid="ai-question-open-failed">
          <TriangleAlert size={ICON.meta} aria-hidden="true" />
          <span>{t("ai.ext.question.openFailed")}</span>
        </span>
      )}
      <span className="pv-ai-overview-hint">{t(request.opened ? "ai.ext.question.pageOpened" : "ai.ext.question.pageHint", { server: request.server })}</span>
      <div className="pv-ai-overview-actions">
        <Button variant="ghost" onClick={() => onAnswer({ action: "cancel" })} data-testid="ai-question-cancel">
          {t("common.cancel")}
        </Button>
        {request.opened ? (
          <Button variant="primary" onClick={() => onAnswer({ action: "accept" })} data-testid="ai-question-continue">
            {t("ai.ext.question.continue")}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onAnswer({ action: "decline" })} data-testid="ai-question-decline">
              {t("ai.ext.question.decline")}
            </Button>
            <Button variant="primary" onClick={onOpenPage} disabled={request.opening === true} data-testid="ai-question-open">
              {t("ai.ext.question.open")}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}

function QuestionRefused({ request, question, onAnswer, touch }: { request: McpQuestionRequest; question: Extract<McpElicitation, { kind: "refused" }>; onAnswer: (answer: McpElicitResult) => void; touch?: boolean }) {
  const { t } = useTranslation();
  const title = t("ai.ext.question.refusedTitle", { server: request.server });
  const why =
    question.reason === "secret"
      ? question.field
        ? t("ai.ext.question.refused.secret", { field: question.field })
        : t("ai.ext.question.refused.secretAsked")
      : question.reason === "address"
        ? t("ai.ext.question.refused.address")
        : t("ai.ext.question.refused.shape");
  return (
    <section className={cx("pv-ai-overview", "pv-ai-overview--asking", touch && "pv-ai-overview--touch")} aria-label={title} data-testid="ai-question" data-kind="refused" data-reason={question.reason}>
      <h4 className="pv-ai-overview-head">
        <ShieldOff size={ICON.ui} aria-hidden="true" />
        <span>{title}</span>
      </h4>
      <During request={request} />
      <p className="pv-ai-question-why" data-testid="ai-question-why">
        {why}
      </p>
      <div className="pv-ai-overview-actions">
        <Button variant="primary" onClick={() => onAnswer({ action: "decline" })} data-testid="ai-question-close">
          {t("common.close")}
        </Button>
      </div>
    </section>
  );
}

export function AiMcpQuestion({ request, onAnswer, onOpenPage, touch }: AiMcpQuestionProps) {
  const question = request.question;
  // A new question is a new card: what was typed for the last one does not carry over.
  if (question.kind === "form") return <QuestionForm key={request.id} request={request} question={question} onAnswer={onAnswer} touch={touch} />;
  if (question.kind === "url") return <QuestionPage request={request} question={question} onAnswer={onAnswer} onOpenPage={onOpenPage} touch={touch} />;
  return <QuestionRefused request={request} question={question} onAnswer={onAnswer} touch={touch} />;
}
