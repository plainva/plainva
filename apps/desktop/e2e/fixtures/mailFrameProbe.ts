import { readableBody } from "../../../../packages/ui/src/ai/quarantineText";
import { applyFrameFit } from "../../../../packages/ui/src/mail/frameFit";
import { buildMailFrameDoc, sanitizeEmailHtml } from "../../../../packages/ui/src/mail/mailSanitize";
import { mailBodyView } from "../../../../packages/ui/src/mail/messageText";
import { runMailFrames, type MailFrameCase, type MailFrameResult } from "./mailFrameRun";

/** The probe page of `mailFrameEquality.spec.ts`: the mail code of this checkout, run in the browser of the test. */
export interface MailFrameProbeWindow extends Window {
  mailFrameProbe: { run(cases: MailFrameCase[], width: number): Promise<MailFrameResult[]> };
}

(window as unknown as MailFrameProbeWindow).mailFrameProbe = {
  run: (cases, width) => runMailFrames({ mailBodyView, sanitizeEmailHtml, buildMailFrameDoc, applyFrameFit, readableBody }, cases, width),
};
