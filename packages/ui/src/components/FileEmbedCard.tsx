import { useEffect, useRef } from "react";
import { mountFileEmbedCard } from "./fileEmbedMount";

/**
 * A file embed for the React surfaces (plan Rückmeldungen 05.11., P4). The
 * card itself is `fileEmbedMount.ts`, plain DOM, because the phone's editor
 * draws it in a CodeMirror widget; this wrapper mounts the same card.
 */
export function FileEmbedCard({ path, size, onOpen }: {
  path: string;
  size: number | null;
  onOpen: (path: string) => void;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; }, [onOpen]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return mountFileEmbedCard(host, { path, size, onOpen: (p) => openRef.current(p) });
  }, [path, size]);

  return <span ref={hostRef} className="pv-filecard-host" />;
}
