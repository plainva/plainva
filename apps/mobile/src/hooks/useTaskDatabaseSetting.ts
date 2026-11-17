import { useEffect, useState } from "react";
import { getMobileSettings } from "../services/mobileSettings";

/**
 * The standard task database as set right now (trimmed, "" for none), read
 * again on every settings change (`m-settings-changed`): a database picked in
 * the settings while the Tasks tab or an account page is open ends the "create
 * one" hint at once, or a tap on it made a second database over the one just
 * chosen (review of issue 172).
 */
export function useTaskDatabaseSetting(): string {
  const [path, setPath] = useState(() => getMobileSettings().taskDatabase.trim());
  useEffect(() => {
    const read = () => setPath(getMobileSettings().taskDatabase.trim());
    window.addEventListener("m-settings-changed", read);
    return () => window.removeEventListener("m-settings-changed", read);
  }, []);
  return path;
}
