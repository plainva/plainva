import { useState, useEffect } from "react";
import { hasCloudService } from "@plainva/ui";
import { refreshCloudAccounts } from "../services/cloudAccounts";

export interface CloudServicesState {
  calendar: boolean;
  mail: boolean;
}

/**
 * Custom hook to monitor and reconcile PIM cloud service capabilities
 * (calendar, mail) based on configured accounts.
 */
export function useCloudServices(
  vaultPath: string | null,
  pimRuntime: any
): CloudServicesState {
  const [cloudServices, setCloudServices] = useState<CloudServicesState>({
    calendar: false,
    mail: false,
  });

  useEffect(() => {
    if (!vaultPath) {
      setCloudServices({ calendar: false, mail: false });
      return;
    }
    let alive = true;
    const refresh = () => {
      refreshCloudAccounts(vaultPath, pimRuntime ?? null)
        .then((records) => {
          if (!alive) return;
          setCloudServices({
            calendar: hasCloudService(records, "calendar"),
            mail: hasCloudService(records, "mail"),
          });
        })
        .catch(() => undefined);
    };

    refresh();
    window.addEventListener("plainva-cloud-accounts-changed", refresh);
    window.addEventListener("plainva-credentials-saved", refresh);
    return () => {
      alive = false;
      window.removeEventListener("plainva-cloud-accounts-changed", refresh);
      window.removeEventListener("plainva-credentials-saved", refresh);
    };
  }, [vaultPath, pimRuntime]);

  return cloudServices;
}
