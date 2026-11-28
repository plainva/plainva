import { readableBody, readableBodyInEngine } from "../../../../packages/ui/src/ai/quarantineText";
import { applyFrameFit } from "../../../../packages/ui/src/mail/frameFit";
import { buildMailFrameDoc, forgetCheckedMail, sanitizeEmailHtml } from "../../../../packages/ui/src/mail/mailSanitize";
import { enginePasses, lastPassSteps, noteMailReaderWidth, passTrace, resetPassTrace, setEngineBudgetForTests, setWordWiseForTests } from "../../../../packages/ui/src/mail/engineVisibility";
import { mailBodyView } from "../../../../packages/ui/src/mail/messageText";
import { frameScroll, markedFrame, openMarked, runMailCorpus, runMailFrames, type MailCorpusResult, type MailFrameCase, type MailFrameResult, type MarkedFrameResult } from "./mailFrameRun";

/** The probe page of `mailFrameEquality.spec.ts`: the mail code of this checkout, run in the browser of the test. */
export interface MailFrameProbeWindow extends Window {
  mailFrameProbe: {
    run(cases: MailFrameCase[], width: number): Promise<MailFrameResult[]>;
    corpus(cases: MailFrameCase[], width: number, pictures: boolean, mainDocs: Record<string, string>): Promise<MailCorpusResult[]>;
    scroll(html: string, width: number): ReturnType<typeof frameScroll>;
    open(html: string, width: number, only?: string[], pictures?: boolean): Promise<MarkedFrameResult>;
    marked: typeof markedFrame;
    /** The reader of this device shows mails at `width` (B7, review S2): the engine measures there too. */
    readerWidth(width: number): void;
    /** What the assistant reads of a mail, and nothing of the judge's work: the product's way alone. */
    read(html: string): Promise<{ text: string }>;
    /** A budget for the gate's case past it (`setEngineBudgetForTests`); null for the app's own. */
    limit(ms: number | null): void;
    /** How many engine passes ran so far. */
    passes(): number;
    /** How many texts each condition of the pass decided since `resetTrace`. */
    trace(): Record<string, number>;
    resetTrace(): void;
    /** Every word asked of the engine point by point, as before the cheaper measurement — to compare both. */
    wordWise(on: boolean): void;
    /** Forgets the kept answers of the check. */
    forget(): void;
    /** Lays a mail out once in a frame as the reader opens it, without an engine pass; its height. */
    layoutOnly(html: string, width: number): Promise<number>;
    /** Reads a mail and stops the reading after `afterMs`: whether it ended with the stop, and the pass's steps then and 500 ms later. */
    readStopped(html: string, afterMs: number): Promise<{ threw: boolean; atStop: number; later: number }>;
  };
}

(window as unknown as MailFrameProbeWindow).mailFrameProbe = {
  run: (cases, width) => runMailFrames({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, cases, width),
  scroll: (html, width) => frameScroll({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, html, width),
  open: (html, width, only, pictures) => openMarked({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, html, width, only, pictures),
  marked: markedFrame,
  readerWidth: (width) => noteMailReaderWidth(width),
  read: async (html) => ({ text: (await readableBodyInEngine({ html }, 100_000)).text }),
  limit: (ms) => setEngineBudgetForTests(ms),
  passes: () => enginePasses(),
  trace: () => ({ ...passTrace }),
  wordWise: (on) => setWordWiseForTests(on),
  forget: () => forgetCheckedMail(),
  resetTrace: () => resetPassTrace(),
  // The reader alone, as it opens a mail: the frame document laid out once at a width, no engine pass (review B7-7).
  layoutOnly: async (html, width) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:600px;opacity:0;pointer-events:none`;
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.srcdoc = buildMailFrameDoc(sanitizeEmailHtml(html).html, { canvas: null });
    const loaded = new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
    document.body.appendChild(frame);
    await loaded;
    const height = frame.contentDocument!.body.getBoundingClientRect().height;
    frame.remove();
    return height;
  },
  readStopped: async (html, afterMs) => {
    const stop = new AbortController();
    const reading = readableBodyInEngine({ html }, 100_000, undefined, stop.signal).then(
      () => false,
      () => true,
    );
    await new Promise((resolve) => setTimeout(resolve, afterMs));
    stop.abort();
    const threw = await reading;
    const atStop = lastPassSteps();
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { threw, atStop, later: lastPassSteps() };
  },
  corpus: (cases, width, pictures, mainDocs) => runMailCorpus({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, cases, width, pictures, mainDocs),
};
