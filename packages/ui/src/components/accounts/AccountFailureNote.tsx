import type { ReactNode } from "react";
import { Banner } from "../ui/Banner";
import { InfoTip } from "../ui/InfoTip";
import type { PimAccountFailureView } from "../../lib/pimAccountFailure";

/**
 * A calendar account's failure inside its group (finding 2026-10-30), in both
 * shells: the sender in bold first, then the sentence (with its background
 * behind an info button where there is one), then the failure's own words
 * small — the parts `pimAccountFailure` gives — and the actions that help.
 * The error banner carries the colour and every theme; this only orders the
 * parts (`.pv-acctfail-text`).
 */
export function AccountFailureNote({ failure, name, actions, testId }: {
  failure: PimAccountFailureView;
  /** The account, for the info button's name. */
  name: string;
  actions?: ReactNode;
  testId?: string;
}) {
  return (
    <Banner kind="error" rounded actions={actions}>
      <span className="pv-acctfail-text" data-testid={testId}>
        {failure.title && <strong>{failure.title}</strong>}
        <span>
          {failure.text}
          {failure.info && <InfoTip label={name} info={failure.info} />}
        </span>
        <code className="pv-svcstat-raw">{failure.raw}</code>
      </span>
    </Banner>
  );
}
