import { EFFECT_DECLINED, extractLines, runDocumentProcessor, type AiEgress, type ProviderEndpoint, type RunReading, type ToolCallPart, type ToolExecutor, type ToolManifest } from "@plainva/core";

/**
 * What stands between a conversation and the texts other people wrote for
 * the user — mail, the description of an appointment (plan KI-Harness P4-4,
 * ADR 0019, §13.4). One wrapper for both shells, around the vault's tools:
 *
 * - **A kind of data no overview named asks first.** The send overview names
 *   the tools of a conversation; mail is not one of them — it is found
 *   through the tool search. So its first call asks, in the conversation,
 *   once per recipient and session, and a no is an answer to the model, not a
 *   failed tool. Nothing leaves for a model on this device, so nothing asks.
 * - **Raw text goes to a reader without tools.** A tool that would return a
 *   stranger's free text hands it over instead (`quarantine`). Here a second
 *   call reads it — to the model on this device where one is set up, so the
 *   text itself stays on the device; otherwise to the conversation's own
 *   model — and only its checked report is passed on. Without a report
 *   nothing of the text is.
 */

/** Who reads raw text for a run. */
export interface QuarantineReader {
  endpoint: ProviderEndpoint;
  model: string;
  /** The reader as a report names it: a provider's name, or the model on this device. */
  label: string;
  /** It runs on this device: the raw text does not leave it. */
  onDevice: boolean;
  /** Its window, where it is small (the system's own model). */
  contextTokens?: number;
}

/** The kinds of data that ask before their first call. */
export type AskedDataClass = "mail";

export interface PrivateDataHost {
  egress: AiEgress;
  reader(): QuarantineReader;
  /** Whether a tool of this kind may run now — asks the user where the session has not approved it for this recipient. */
  approve(dataClass: AskedDataClass, tool: ToolManifest, call: ToolCallPart, signal?: AbortSignal): Promise<boolean>;
  newRequestId(): string;
  now(): string;
}

/** What a run read, gathered while it runs: numbers and who read — never a word of it. */
export const newRunReading = (): RunReading => ({ mailSearches: 0, messages: 0, descriptions: 0, reader: "provider", inputTokens: 0, outputTokens: 0 });

/** Whether a run read anything a record should name. */
export const readSomething = (reading: RunReading): boolean => reading.mailSearches + reading.messages + reading.descriptions > 0;

export function createPrivateDataExecutor(inner: ToolExecutor, host: PrivateDataHost, log: RunReading): ToolExecutor {
  return {
    async execute(tool, args, call, signal) {
      if (tool.dataClasses.includes("mail") && !(await host.approve("mail", tool, call, signal))) {
        return { content: EFFECT_DECLINED, isError: true, declined: true };
      }
      const outcome = await inner.execute(tool, args, call, signal);
      if (tool.name === "search_mail" && !outcome.isError && outcome.origin) log.mailSearches += 1;
      const raw = outcome.quarantine;
      if (!raw) return outcome;

      const noun = tool.dataClasses.includes("mail") ? ("message" as const) : ("description" as const);
      const head = outcome.content;
      const kept = { ...(outcome.origin ? { origin: outcome.origin } : {}) };
      const reader = host.reader();
      const report = await runDocumentProcessor({
        egress: host.egress,
        endpoint: reader.endpoint,
        model: reader.model,
        task: { origin: raw.origin, question: raw.question, document: { title: raw.title, text: raw.text, links: raw.links } },
        requestId: host.newRequestId(),
        at: host.now(),
        ...(signal ? { signal } : {}),
        ...(reader.contextTokens ? { contextTokens: reader.contextTokens } : {}),
      });
      log.inputTokens += report.usage.inputTokens;
      log.outputTokens += report.usage.outputTokens;
      log.reader = reader.onDevice ? "device" : "provider";
      if (reader.onDevice) log.readerModel = reader.model;
      const text = noun === "message" ? "The message's text" : "The description";
      if (!report.ok) {
        // Nothing of the text reaches the conversation without a report: it stays with the reader.
        const why = report.reason === "cancelled" ? "the request was stopped" : report.reason === "no-record" ? "no report could be made of it" : `its reader failed${report.failure ? ` (${report.failure.kind})` : ""}`;
        // A message is asked for to be read; an appointment's other details stand without its description.
        return { content: `${head}\n\n${text} was not read: ${why}.`, ...kept, ...(noun === "message" ? { isError: true } : {}) };
      }
      if (noun === "message") log.messages += 1;
      else log.descriptions += 1;
      const who = reader.onDevice ? `a model on this device (${reader.label})` : reader.label;
      const lead = `${text}, read by ${who}${raw.truncated ? " (a long text: only its beginning)" : ""} — a report, not the text itself:`;
      return { content: [head, "", lead, ...extractLines(report.extract, noun)].join("\n"), ...kept };
    },
  };
}
