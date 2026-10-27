import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, GroupCard, Row, RowList, accountServices, checkRowActionKey, checkRowActions, serviceCheckText, type CloudAccountRecord, type CloudProviderFamily, type CloudServiceId, type ServiceCheck } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";
import { checkMobileAccount, type CheckedCard } from "../services/accountCheck";

/**
 * "Check connection" on the phone (account sign-in plan E6, mockup view 5):
 * the same rows as the desktop's dialog, as a sheet.
 *
 * Every row that does not work carries the action that helps (plan
 * "Verbinden", V0/V2): sign in, sign in again, grant the permission, use the
 * standard sign-in, and for Gmail that Google refuses an app password (E7).
 */
export function AccountCheckSheet({
  vaultId,
  record,
  card,
  canSignIn,
  standardAvailable = false,
  onUseStandard,
  serviceLabel,
  onSignInAgain,
  onAppPassword,
  onOpenService,
  onChecked,
  onClose,
}: {
  vaultId: string;
  /** The registry record; a card without one is checked as what it shows. */
  record?: CloudAccountRecord;
  /** What the account page shows - the calendar row it names, its services. */
  card: CheckedCard & { family: CloudProviderFamily; label: string };
  canSignIn: boolean;
  /** This phone uses an own client and the build carries the standard one. */
  standardAvailable?: boolean;
  onUseStandard?: () => void;
  serviceLabel: (service: CloudServiceId) => string;
  onSignInAgain: () => void;
  onAppPassword?: () => void;
  onOpenService: (service: CloudServiceId) => void;
  onChecked?: (rows: ServiceCheck[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [results, setResults] = useState<ServiceCheck[] | null>(null);
  const checked = useRef(onChecked);
  useEffect(() => { checked.current = onChecked; }, [onChecked]);
  // A card without a registry record is checked as the record it would be.
  const subject = useMemo<CloudAccountRecord>(() => record ?? {
    id: "",
    family: card.family,
    label: card.label,
    services: {
      ...(card.pimAccountId ? { calendar: { pimAccountId: card.pimAccountId } } : {}),
      ...(card.mailAccountId ? { mail: { mailAccountId: card.mailAccountId } } : {}),
    },
  }, [record, card.family, card.label, card.pimAccountId, card.mailAccountId]);
  useEffect(() => {
    let alive = true;
    void checkMobileAccount(vaultId, subject, card).then((rows) => {
      if (!alive) return;
      setResults(rows);
      checked.current?.(rows);
    });
    return () => { alive = false; };
  }, [vaultId, subject, card]);
  const shown = (["files", "calendar", "mail"] as const).filter((service) => card.services?.includes(service) || accountServices(subject).includes(service));
  const pending = shown.map((service) => ({ service, state: "pending" as const }));
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="cloudacct-check">
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("cloudAccounts.checkConnection")}</p>
        <p className="m-hint">{card.label}</p>
        <GroupCard>
          <RowList>
            {(results ?? pending).map((row) => {
              const actions = row.state === "pending" ? [] : checkRowActions(row, { family: card.family, canSignIn, standardAvailable: standardAvailable && !!onUseStandard })
                .filter((action) => action !== "appPassword" || !!onAppPassword);
              return (
                <Row
                  key={row.service}
                  data-testid={`cloudacct-check-${row.service}`}
                  data-state={row.state}
                  title={serviceLabel(row.service)}
                  subtitle={row.state === "pending" ? t("cloudAccounts.checkRunning") : serviceCheckText(row, (key) => t(key))}
                  wrap
                  controls
                  end={actions.length > 0 && (
                    <>
                      {actions.map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant="tonal"
                          data-testid={`cloudacct-check-action-${row.service}-${action}`}
                          onClick={() => {
                            if (action === "openService") onOpenService(row.service);
                            else if (action === "useStandard") onUseStandard?.();
                            else if (action === "appPassword") onAppPassword?.();
                            else { onClose(); onSignInAgain(); }
                          }}
                        >
                          {t(checkRowActionKey(action))}
                        </Button>
                      ))}
                    </>
                  )}
                />
              );
            })}
          </RowList>
        </GroupCard>
        {results && <p className="m-hint">{t("cloudAccounts.checkNoted")}</p>}
      </div>
    </div>
  );
}
