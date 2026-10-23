import { useTranslation } from "react-i18next";

/**
 * A sentence that shows the device's link look as it is right now (Appearance
 * -> Links, linkStyle.ts). It draws with the same classes as the reading view,
 * so what it shows is what a note shows - nothing is simulated.
 *
 * The sentence is one translatable text with three marked runs -
 * `<note>…</note>`, `<web>…</web>` and `<missing>…</missing>` - so every
 * language puts them where its word order wants them.
 */
export function LinkStylePreview({ className }: { className?: string }) {
  const { t } = useTranslation();
  const text = t("settings.linkPreviewSentence");
  const parts: { kind: "text" | "note" | "web" | "missing"; value: string }[] = [];
  const pattern = /<(note|web|missing)>(.*?)<\/\1>/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push({ kind: "text", value: text.slice(last, match.index) });
    parts.push({ kind: match[1] as "note" | "web" | "missing", value: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return (
    <p className={className} data-testid="link-style-preview" aria-label={t("settings.linkPreview")}>
      {parts.map((part, index) => {
        if (part.kind === "note") return <span key={index} className="pv-wiki-link">{part.value}</span>;
        if (part.kind === "missing") return <span key={index} className="pv-wiki-link pv-wiki-link--unresolved">{part.value}</span>;
        if (part.kind === "web") return <span key={index} className="pv-web-link">{part.value}</span>;
        return <span key={index}>{part.value}</span>;
      })}
    </p>
  );
}
