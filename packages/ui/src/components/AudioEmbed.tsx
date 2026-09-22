import { useEffect, useRef } from "react";
import { mountAudioPlayer, type AudioPlayerHandle } from "./audioPlayer";

/**
 * A sound embed for the React surfaces — reading mode, cards, journal lines
 * (plan Journal-Erweiterungen, X3).
 *
 * The player itself is `audioPlayer.ts`, plain DOM, because the fourth surface
 * is a CodeMirror widget with no React around it. This is the wrapper, so all
 * four draw the same controls and a change to them is one change.
 */
export function AudioEmbed({ url, label, compact }: {
  /** Blob or asset URL of the sound; `null` once it is clear there is none to play, `undefined` while the file is being read. */
  url: string | null | undefined;
  /** What the file is called — shown beside the controls and read to a screen reader. */
  label: string;
  /** One line, for a journal row or a card: controls and time, no name. */
  compact?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<AudioPlayerHandle | null>(null);

  // The player is rebuilt when the LABEL or the shape changes, not when the
  // URL does: a rebuild would drop a sound that is playing, and the url
  // arrives after the file has been read.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const player = mountAudioPlayer(host, { label, compact });
    playerRef.current = player;
    return () => {
      playerRef.current = null;
      player.destroy();
    };
  }, [label, compact]);

  useEffect(() => {
    // `undefined` means "still reading"; the controls stand disabled until the
    // answer is a URL or a definite nothing.
    if (url !== undefined) playerRef.current?.setUrl(url);
  }, [url]);

  return <span ref={hostRef} className="pv-audio-host" />;
}
