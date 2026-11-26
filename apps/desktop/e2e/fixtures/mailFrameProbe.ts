import { readableBody, readableBodyInEngine } from "../../../../packages/ui/src/ai/quarantineText";
import { applyFrameFit } from "../../../../packages/ui/src/mail/frameFit";
import { buildMailFrameDoc, sanitizeEmailHtml } from "../../../../packages/ui/src/mail/mailSanitize";
import { noteMailReaderWidth } from "../../../../packages/ui/src/mail/engineVisibility";
import { mailBodyView } from "../../../../packages/ui/src/mail/messageText";
import { frameScroll, markedFrame, openMarked, runMailCorpus, runMailFrames, type MailCorpusResult, type MailFrameCase, type MailFrameResult, type MarkedFrameResult } from "./mailFrameRun";

/** The probe page of `mailFrameEquality.spec.ts`: the mail code of this checkout, run in the browser of the test. */
export interface MailFrameProbeWindow extends Window {
  mailFrameProbe: {
    run(cases: MailFrameCase[], width: number): Promise<MailFrameResult[]>;
    corpus(cases: MailFrameCase[], width: number, pictures: boolean, mainDocs: Record<string, string>): Promise<MailCorpusResult[]>;
    scroll(html: string, width: number): ReturnType<typeof frameScroll>;
    open(html: string, width: number, only?: string[]): Promise<MarkedFrameResult>;
    marked: typeof markedFrame;
    /** The reader of this device shows mails at `width` (B7, review S2): the engine measures there too. */
    readerWidth(width: number): void;
  };
}

(window as unknown as MailFrameProbeWindow).mailFrameProbe = {
  run: (cases, width) => runMailFrames({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, cases, width),
  scroll: (html, width) => frameScroll({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, html, width),
  open: (html, width, only) => openMarked({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, html, width, only),
  marked: markedFrame,
  readerWidth: (width) => noteMailReaderWidth(width),
  corpus: (cases, width, pictures, mainDocs) => runMailCorpus({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody: readableBodyInEngine, readableModel: readableBody }, cases, width, pictures, mainDocs),
};
