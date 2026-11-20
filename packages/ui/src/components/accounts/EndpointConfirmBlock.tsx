import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { confirmEndpointsIn, unconfirmedEndpointsOf, type UnconfirmedEndpoint } from "../../lib/endpointConfirmation";
import { Banner } from "../ui/Banner";
import { Button } from "../ui/Button";

/** An address a form or a page would send a stored or typed password to, with the vault whose list it goes in. */
export interface EndpointConfirmEntry {
  vaultKey: string;
  endpoint: string | null;
}

export interface EndpointConfirmation {
  /** The addresses still to confirm on this device; null while they are being read. */
  unconfirmed: UnconfirmedEndpoint[] | null;
  /** Every address is confirmed (or needs no confirmation): the password may go there. */
  allConfirmed: boolean;
  /** **Confirm**: exactly this address, nothing sent. */
  confirm(entry: UnconfirmedEndpoint): Promise<void>;
}

/**
 * The addresses of a form or page that this device has not confirmed (review
 * of F57, O3): the one question before any password goes there. A form shows
 * `EndpointConfirmBlock` first and its password field only once
 * `allConfirmed` — one way, never a sign-in offer beside a confirmation.
 */
export function useEndpointConfirmation(entries: ReadonlyArray<EndpointConfirmEntry>, onConfirmed?: (entry: UnconfirmedEndpoint) => void | Promise<void>): EndpointConfirmation {
  const key = JSON.stringify(entries.map((e) => [e.vaultKey, e.endpoint]));
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedEndpoint[] | null>(null);
  const [revision, setRevision] = useState(0);
  // The entries are read by value: a caller that builds the list on every render does not loop.
  const stable = useMemo(() => JSON.parse(key) as Array<[string, string | null]>, [key]);
  useEffect(() => {
    let alive = true;
    setUnconfirmed(null);
    void unconfirmedEndpointsOf(stable.map(([vaultKey, endpoint]) => ({ vaultKey, endpoint }))).then((list) => {
      if (alive) setUnconfirmed(list);
    });
    return () => {
      alive = false;
    };
  }, [stable, revision]);
  const confirm = useCallback(async (entry: UnconfirmedEndpoint) => {
    await confirmEndpointsIn(entry.vaultKey, [entry.endpoint]);
    setRevision((n) => n + 1);
    await onConfirmed?.(entry);
  }, [onConfirmed]);
  return { unconfirmed, allConfirmed: unconfirmed !== null && unconfirmed.length === 0, confirm };
}

/**
 * One row per address still to confirm: the address as the card names it
 * (scheme, host, port), why it is asked, and **Confirm**, which confirms exactly
 * that address and sends nothing. Renders nothing once all are confirmed.
 */
export function EndpointConfirmBlock({ confirmation, testId = "endpoint-confirm" }: { confirmation: EndpointConfirmation; testId?: string }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string | null>(null);
  if (!confirmation.unconfirmed?.length) return null;
  return (
    <>
      {confirmation.unconfirmed.map((entry) => (
        <Banner
          key={`${entry.vaultKey} ${entry.endpoint}`}
          kind="warning"
          rounded
          testId={testId}
          actions={
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              data-testid={`${testId}-action`}
              onClick={() => {
                setBusy(entry.endpoint);
                void confirmation.confirm(entry).finally(() => setBusy(null));
              }}
            >
              {t("cloudAccounts.confirmAddressAction")}
            </Button>
          }
        >
          <strong>{t("cloudAccounts.confirmAddress", { address: entry.endpoint })}</strong>
          <br />
          {t("cloudAccounts.confirmAddressHint")}
        </Banner>
      ))}
    </>
  );
}
