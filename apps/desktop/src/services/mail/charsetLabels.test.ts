import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { charsetDecoder, decodeWords } from "@plainva/ui/mail";

/**
 * The charset names a mail may carry, as the desktop's Rust parser
 * (mail-parser 1.0.1) knows them: each label with the charset it reads it as
 * (`charsetLabels.fixtures.txt`). Both shells now read a subject with the
 * shared decoder, and a name only Rust knew made a Chinese subject
 * replacement characters (Fehlerliste 0.9.0 F22).
 */
const LABELS = readFileSync(fileURLToPath(new URL("../../../../../packages/ui/src/mail/net/charsetLabels.fixtures.txt", import.meta.url)), "utf8")
  .trim()
  .split("\n")
  .map((line) => line.split(" ") as [string, string]);

/** mail-parser's charset as the platform names it; the two the platform does not decode are decoded in `charsets.ts`. */
const PLATFORM: Record<string, string> = {
  Utf8: "utf-8", Utf16: "utf-16le", Utf16Le: "utf-16le", Utf16Be: "utf-16be", Ibm866: "ibm866", Koi8R: "koi8-r", Koi8U: "koi8-u",
  Macintosh: "macintosh", Windows874: "windows-874", Big5: "big5", EucJp: "euc-jp", Iso2022Jp: "iso-2022-jp", ShiftJis: "shift_jis",
  EucKr: "euc-kr", Gbk: "gbk", Gb18030: "gb18030", XMacCyrillic: "x-mac-cyrillic", XUserDefined: "x-user-defined",
};
const platformName = (charset: string): string =>
  PLATFORM[charset] ?? (/^Windows(\d+)$/.exec(charset) ? `windows-${charset.slice(7)}` : /^Iso8859_(\d+)$/.test(charset) ? `iso-8859-${charset.slice(8)}` : charset);

describe("the charsets a mail names", () => {
  it("knows every name the desktop's parser knew, as the same charset", () => {
    expect(LABELS.length).toBeGreaterThan(600);
    const wrong: string[] = [];
    for (const [label, charset] of LABELS) {
      if (charset === "Replacement") continue;
      const decoder = charsetDecoder(label);
      if (charset === "Ibm850" || charset === "Utf7") {
        if (!decoder || decoder instanceof TextDecoder) wrong.push(`${label}: ${charset}`);
      } else if (!(decoder instanceof TextDecoder) || (decoder.encoding !== platformName(charset) && !(charset === "Iso8859_8" && decoder.encoding === "iso-8859-8-i"))) {
        // ISO-8859-8-I is ISO-8859-8 in logical order: the same characters for the same bytes.
        wrong.push(`${label}: ${charset}, read as ${decoder instanceof TextDecoder ? decoder.encoding : String(decoder)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("reads a subject in the names only the desktop knew", () => {
    // 中文邮件 in GBK, 한국어 in EUC-KR, Grüße in code page 850 and in UTF-7, 5€ in Latin-9.
    expect(decodeWords("=?cp936?B?1tDOxNPKvP4=?=")).toBe("中文邮件");
    expect(decodeWords("=?ks_c_5601-1987?B?x9Gxub7u?=")).toBe("한국어");
    expect(decodeWords("=?cp850?Q?Gr=81=E1e?=")).toBe("Grüße");
    expect(decodeWords("=?utf-7?Q?=A31_Gr+APwA3w-e?=")).toBe("�1 Grüße");
    expect(decodeWords("=?utf-7?Q?+AKM-1_Gr+APwA3w-e?=")).toBe("£1 Grüße");
    expect(decodeWords("=?latin-9?Q?Preis_5=A4?=")).toBe("Preis 5€");
    expect(decodeWords("=?ISO-8859-1:1987?Q?caf=E9?=")).toBe("café");
  });
});
