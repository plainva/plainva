import { ICON } from "../lib/iconSizes";
import i18n from "../i18n";

/**
 * What a sound embed looks like, in one place (plan Journal-Erweiterungen, X3).
 *
 * Before this, `![[memo.m4a]]` was read as TEXT and appeared as character
 * salad: the embed renderer asked "is it a picture?", and everything else went
 * down the note path.
 *
 * Plain DOM rather than a component, because one of the four places a sound
 * can stand is a CodeMirror widget, which has no React around it. The React
 * surfaces get `AudioEmbed`, which mounts this — so the editor's live preview,
 * the reading mode, a card and a journal line all draw the same controls, and
 * a change to them is one change.
 *
 * Plainva's own controls, not the platform's `<audio controls>`: that one
 * looks like a different application in each shell and ignores every theme.
 *
 * `preload="metadata"` so the duration is there before anyone presses play,
 * and nothing streams until they do — a day of voice memos would otherwise
 * fetch every one of them the moment the stream scrolls into view.
 */

export interface AudioPlayerOptions {
  /** What the file is called — shown beside the controls and read to a screen reader. */
  label: string;
  /** One line, for a journal row or a card: controls and time, no name. */
  compact?: boolean;
}

export interface AudioPlayerHandle {
  /** The sound to play: a URL, or `null` for "could not be found". */
  setUrl(url: string | null): void;
  destroy(): void;
}

/** `m:ss`, or `h:mm:ss` for a recording that ran long. */
export function clock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const two = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours > 0 ? `${hours}:${two(minutes)}:${two(whole % 60)}` : `${minutes}:${two(whole % 60)}`;
}

const PLAY_PATH = "M6 3.5v17l14-8.5z";
const PAUSE_PATH = "M7 4h4v16H7zM13 4h4v16h-4z";

function glyph(path: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(ICON.ui));
  svg.setAttribute("height", String(ICON.ui));
  svg.setAttribute("aria-hidden", "true");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "currentColor");
  svg.appendChild(shape);
  return svg;
}

/**
 * Builds the player inside `container` and answers with a handle. The sound
 * itself arrives later through `setUrl` — a vault file has to be read first,
 * and the controls stand (disabled) while that happens rather than popping in.
 */
export function mountAudioPlayer(container: HTMLElement, options: AudioPlayerOptions): AudioPlayerHandle {
  const t = (key: string, vars?: Record<string, unknown>) => i18n.t(key, vars) as string;
  const root = document.createElement("span");
  root.className = options.compact ? "pv-audio pv-audio--compact" : "pv-audio";
  root.dataset.testid = "audio-embed";

  const audio = document.createElement("audio");
  audio.preload = "metadata";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "pv-iconbtn pv-iconbtn--sm";
  button.dataset.testid = "audio-play";
  button.disabled = true;
  button.appendChild(glyph(PLAY_PATH));

  const seek = document.createElement("input");
  seek.type = "range";
  seek.className = "pv-audio-seek";
  seek.min = "0";
  seek.max = "1";
  seek.step = "0.1";
  seek.value = "0";
  seek.disabled = true;
  seek.setAttribute("aria-label", t("audio.position"));

  const time = document.createElement("span");
  time.className = "pv-audio-time";
  time.textContent = clock(0);

  root.append(audio, button, seek, time);
  if (!options.compact) {
    const name = document.createElement("span");
    name.className = "pv-audio-name";
    name.title = options.label;
    name.textContent = options.label;
    root.appendChild(name);
  }
  container.appendChild(root);

  const total = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);

  const paint = () => {
    const seconds = total();
    seek.disabled = seconds === 0;
    seek.max = String(seconds || 1);
    seek.value = String(Math.min(audio.currentTime, seconds));
    time.textContent = seconds > 0 ? `${clock(audio.currentTime)} / ${clock(seconds)}` : clock(audio.currentTime);
  };

  const setIcon = () => {
    const playing = !audio.paused && !audio.ended;
    button.replaceChildren(glyph(playing ? PAUSE_PATH : PLAY_PATH));
    const label = playing ? t("audio.pause") : t("audio.play", { name: options.label });
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tip", label);
  };

  const onPlayState = () => { setIcon(); paint(); };
  audio.addEventListener("durationchange", paint);
  audio.addEventListener("timeupdate", paint);
  audio.addEventListener("play", onPlayState);
  audio.addEventListener("pause", onPlayState);
  audio.addEventListener("ended", onPlayState);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    // `play()` answers with a promise in a browser and with nothing at all in
    // jsdom, where it is not implemented — wrapping it keeps a refused play
    // (autoplay policy, a missing codec) from becoming an unhandled rejection.
    if (audio.paused) void Promise.resolve(audio.play()).catch(setIcon);
    else audio.pause();
  });
  seek.addEventListener("input", () => {
    if (total() === 0) return;
    audio.currentTime = Number(seek.value);
    paint();
  });
  // A journal line and a card are clickable; pressing play must not open them.
  root.addEventListener("click", (event) => event.stopPropagation());
  setIcon();

  return {
    setUrl(url) {
      if (url === null) {
        audio.removeAttribute("src");
        button.disabled = true;
        root.classList.add("pv-audio--missing");
        root.setAttribute("role", "status");
        time.textContent = t("audio.missing", { name: options.label });
        seek.hidden = true;
        return;
      }
      root.classList.remove("pv-audio--missing");
      root.removeAttribute("role");
      seek.hidden = false;
      button.disabled = false;
      audio.src = url;
      paint();
    },
    destroy() {
      audio.pause();
      audio.removeAttribute("src");
      root.remove();
    },
  };
}
