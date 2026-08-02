import { useSyncExternalStore } from "react";
import { AlertTriangle, Cloud } from "lucide-react";
import { ICON } from "@plainva/ui";
import { getSyncStatus, subscribeSyncStatus } from "../services/syncService";

/** Passive sync cloud for app bars (hidden while no provider is configured). */
export function SyncIndicator() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  if (status.status === "off") return null;
  return (
    <span className="m-headicon">
      {status.status === "error" ? (
        <AlertTriangle className="m-error" size={ICON.ui} />
      ) : (
        <Cloud className={status.status === "syncing" ? "m-chevron" : "m-accent"} size={ICON.ui} />
      )}
    </span>
  );
}
