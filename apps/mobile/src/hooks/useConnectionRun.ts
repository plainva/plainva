import { useEffect, useState } from "react";
import { CONNECT_RUN_EVENT, loadConnectQueue, type ConnectQueue } from "../services/connectQueue";

export function useConnectionRun(): ConnectQueue | null {
  const [run, setRun] = useState<ConnectQueue | null>(null);
  useEffect(() => {
    let alive = true;
    const read = () => { void loadConnectQueue().then(q => { if (alive) setRun(q); }).catch(() => { if (alive) setRun(null); }); };
    read();
    window.addEventListener(CONNECT_RUN_EVENT, read);
    return () => { alive = false; window.removeEventListener(CONNECT_RUN_EVENT, read); };
  }, []);
  return run;
}
