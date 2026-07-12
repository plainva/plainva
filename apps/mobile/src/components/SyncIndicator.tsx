import { useSyncExternalStore } from "react";
import { AlertTriangle, Cloud } from "lucide-react";
import { getSyncStatus, subscribeSyncStatus } from "../services/syncService";

/** Passive sync cloud for app bars (hidden while no provider is configured). */
export function SyncIndicator() {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  if (status.status === "off") return null;
  return (
    <span className="m-headicon">
      {status.status === "error" ? (
        <AlertTriangle className="m-error" size={16} />
      ) : (
        <Cloud className={status.status === "syncing" ? "m-chevron" : "m-accent"} size={16} />
      )}
    </span>
  );
}
