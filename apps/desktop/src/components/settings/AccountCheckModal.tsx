import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, CircleAlert, Clock } from "lucide-react";
import {
  Button,
  ICON,
  Modal,
  SettingCard,
  SettingCardNote,
  accountCheckDiagnostic,
  accountServices,
  checkAccountConnection,
  hasStoredAccountGrant,
  logDiagnostic,
  checkRowActionKey,
  checkRowActions,
  serviceCheckText,
  ServiceCheckError,
  type CloudAccountRecord,
  type ServiceCheck,
} from "@plainva/ui";
import { checkMailbox, listMailAccounts } from "@plainva/ui/mail";
import { getAccountToken } from "../../services/accountBroker";
import { syncTargetFromSlots } from "../../services/cloudAccountsActions";
import { oauthErrorText } from "../../services/oauthLoopback";
import type { PimRuntime } from "../../services/pim/pimRuntime";
import { serviceLabel } from "./cloudAccountsShared";

/**
 * "Check connection" on the desktop (account sign-in plan E6, mockup view 5):
 * each service of the card reads something small with what this device holds
 * and says whether it works, or why not, with the action that helps. The
 * result is one line in the diagnostics; nothing is changed.
 */
export const AccountCheckModal: React.FC<{
  vaultPath: string;
  record: CloudAccountRecord;
  runtime: PimRuntime | null;
  /** This desktop uses an own client and the build carries the standard one. */
  standardAvailable?: boolean;
  onUseStandard?: () => void;
  onSignInAgain: () => void;
  /** Gmail through an app password, where Google refuses it (E7). */
  onAppPassword?: () => void;
  /** The result, for the line of section 4 on the account page. */
  onChecked?: (rows: ServiceCheck[]) => void;
  onClose: () => void;
}> = ({ vaultPath, record, runtime, standardAvailable = false, onUseStandard, onSignInAgain, onAppPassword, onChecked, onClose }) => {
  const { t } = useTranslation();
  const [results, setResults] = useState<ServiceCheck[] | null>(null);
  const onCheckedRef = useRef(onChecked);
  useEffect(() => { onCheckedRef.current = onChecked; }, [onChecked]);
  const family = record.family === "google" || record.family === "microsoft" ? record.family : null;

  useEffect(() => {
    let alive = true;
    void (async () => {
      const mailboxes = record.services.mail ? await listMailAccounts(vaultPath) : [];
      const mailbox = mailboxes.find((entry) => entry.id === record.services.mail?.mailAccountId);
      const checked = await checkAccountConnection({
        services: accountServices(record),
        // A card signed out on this device says so for every service (plan "Verbinden", V0).
        cardSignedIn: async () => (family ? hasStoredAccountGrant(await getAccountToken(vaultPath, record.id).catch(() => null)) : null),
        covered: async (service) => {
          if (!family) return null;
          if (service === "mail" && family === "google" && mailbox?.kind !== "gmail") return null;
          return !!(await getAccountToken(vaultPath, record.id, service, family).catch(() => null));
        },
        probe: async (service) => {
          if (service === "files") {
            await (await syncTargetFromSlots(vaultPath, record.services.files!.provider)).listFolders("");
          } else if (service === "calendar") {
            if (!runtime) throw new ServiceCheckError("failed", "pim.openVaultFirst");
            // The same id the account page shows: on the desktop the card IS the registry record.
            const row = (await runtime.cache.listAccounts()).find((entry) => entry.id === record.services.calendar!.pimAccountId);
            if (!row) throw new ServiceCheckError("failed", "connection.notConnected");
            const target = await runtime.buildTarget(row);
            // No sign-in for it on this device: said in words, with "Sign in" beside it.
            if (!target) throw new ServiceCheckError("signin");
            await target.listCalendars();
          } else {
            if (!mailbox) throw new ServiceCheckError("failed", "connection.notConnected");
            await checkMailbox(vaultPath, mailbox);
          }
        },
        describe: (error) => oauthErrorText(error),
      });
      logDiagnostic("accounts", accountCheckDiagnostic(record.family, checked));
      if (alive) {
        setResults(checked);
        onCheckedRef.current?.(checked);
      }
    })();
    return () => { alive = false; };
  }, [family, record, runtime, t, vaultPath]);

  return (
    <Modal
      title={t("cloudAccounts.checkConnection")}
      headerNote={record.label}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("common.close")}</Button>
        </>
      }
    >
      <div data-testid="cloudacct-check">
      <SettingCard>
        {(results ?? accountServices(record).map((service) => ({ service, state: "pending" as const }))).map((row) => {
          const kind = row.state === "ok" ? "ok" : row.state === "pending" ? "wait" : "err";
          const Icon = kind === "ok" ? Check : kind === "err" ? CircleAlert : Clock;
          // Every row that does not work carries the action that helps (plan "Verbinden",
          // V0/V2); signing in again on the desktop repairs every kind of account.
          const actions = row.state === "pending" ? [] : checkRowActions(row as ServiceCheck, {
            family: record.family,
            canSignIn: true,
            standardAvailable: standardAvailable && !!onUseStandard,
          }).filter((action) => action !== "appPassword" || !!onAppPassword);
          return (
            <div key={row.service} className={`pv-svcstat pv-svcstat--${kind}`} data-testid={`cloudacct-check-${row.service}`} data-state={row.state}>
              <span className="pv-svcstat-icon"><Icon size={ICON.ui} /></span>
              <div className="pv-svcstat-main">
                <div className="pv-svcstat-label">{serviceLabel(row.service)}</div>
                <div className="pv-svcstat-sub">
                  {row.state === "pending" ? t("cloudAccounts.checkRunning") : serviceCheckText(row as ServiceCheck, (key) => t(key))}
                </div>
              </div>
              {actions.map((action) => (
                <Button
                  key={action}
                  variant="secondary"
                  size="sm"
                  data-testid={`cloudacct-check-action-${row.service}-${action}`}
                  onClick={() => {
                    onClose();
                    if (action === "useStandard") onUseStandard?.();
                    else if (action === "appPassword") onAppPassword?.();
                    else onSignInAgain();
                  }}
                >
                  {t(checkRowActionKey(action))}
                </Button>
              ))}
            </div>
          );
        })}
        {results && <SettingCardNote>{t("cloudAccounts.checkNoted")}</SettingCardNote>}
      </SettingCard>
      </div>
    </Modal>
  );
};
