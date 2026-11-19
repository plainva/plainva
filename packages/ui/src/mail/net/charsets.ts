/**
 * The charsets a mail names, and how its bytes become text — ONE place for
 * both shells (Fehlerliste 0.9.0 F22).
 *
 * The desktop read a subject with its Rust parser (mail-parser 1.0.1), which
 * knows names the platform's `TextDecoder` does not: `cp936` for GBK, `cp949`
 * and `ks_c_5601-1987` for Korean, `latin-9`, names written with `_` for `-`
 * or with a year (`iso-8859-1:1987`), and two charsets no browser decodes,
 * UTF-7 and the DOS code page 850. Since both shells read a subject here, a
 * Chinese subject in `cp936` came out as replacement characters. The names
 * are read the way mail-parser reads them (its list holds the test,
 * `charsetLabels.fixtures.txt`), and the two missing charsets are decoded here.
 */

/** Decodes the bytes of one charset. */
export interface CharsetDecoder {
  decode(bytes: Uint8Array): string;
}

/** Names mail-parser knows that no spelling of a `TextDecoder` label reaches, by their spelling with `-`. */
const ALIASES: Readonly<Record<string, string>> = {
  "850": "ibm850", cp850: "ibm850", ibm850: "ibm850", cspc850multilingual: "ibm850",
  // GB 2312 as the larger GB 18030 reads it, as mail-parser does: a sender who writes it mostly means GBK or more.
  gb2312: "gb18030",
  cp936: "gbk", ms936: "gbk", "windows-936": "gbk", csgbk: "gbk",
  cp949: "euc-kr", uhc: "euc-kr", "x-windows-949": "euc-kr", "ks-c-5601-1987": "euc-kr", "ks-c-5601-1989": "euc-kr",
  csgb18030: "gb18030",
  csiso885913: "iso-8859-13", csiso885914: "iso-8859-14", csiso885915: "iso-8859-15", csiso885916: "iso-8859-16",
  cskoi8u: "koi8-u", cstis620: "windows-874", cswindows874: "windows-874",
  csutf16: "utf-16le", csutf16le: "utf-16le", csutf16be: "utf-16be", csutf7: "utf-7",
  "extended-unix-code-packed-format-for-japanese": "euc-jp",
  "iso-celtic": "iso-8859-14", "iso-ir-199": "iso-8859-14", l8: "iso-8859-14", latin8: "iso-8859-14",
  "iso-ir-226": "iso-8859-16", l10: "iso-8859-16", latin10: "iso-8859-16",
  "latin-9": "iso-8859-15",
};
for (let n = 1250; n <= 1258; n++) (ALIASES as Record<string, string>)[`cswindows${n}`] = `windows-${n}`;

/** The upper half of code page 850 (0x80 to 0xFF), as code points. */
const IBM850 = (
  "00c7 00fc 00e9 00e2 00e4 00e0 00e5 00e7 00ea 00eb 00e8 00ef 00ee 00ec 00c4 00c5 00c9 00e6 00c6 00f4 00f6 00f2 00fb 00f9 00ff 00d6 00dc 00f8 00a3 00d8 00d7 0192 " +
  "00e1 00ed 00f3 00fa 00f1 00d1 00aa 00ba 00bf 00ae 00ac 00bd 00bc 00a1 00ab 00bb 2591 2592 2593 2502 2524 00c1 00c2 00c0 00a9 2563 2551 2557 255d 00a2 00a5 2510 " +
  "2514 2534 252c 251c 2500 253c 00e3 00c3 255a 2554 2569 2566 2560 2550 256c 00a4 00f0 00d0 00ca 00cb 00c8 0131 00cd 00ce 00cf 2518 250c 2588 2584 00a6 00cc 2580 " +
  "00d3 00df 00d4 00d2 00f5 00d5 00b5 00fe 00de 00da 00db 00d9 00fd 00dd 00af 00b4 00ad 00b1 2017 00be 00b6 00a7 00f7 00b8 00b0 00a8 00b7 00b9 00b3 00b2 25a0 00a0"
)
  .split(" ")
  .map((hex) => String.fromCharCode(parseInt(hex, 16)));

const ibm850: CharsetDecoder = {
  decode: (bytes) => Array.from(bytes, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : IBM850[byte - 0x80])).join(""),
};

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-7 (RFC 2152): ASCII as it stands, the rest in base64 of UTF-16 between `+` and the first other character. */
const utf7: CharsetDecoder = {
  decode: (bytes) => {
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    let out = "";
    for (let at = 0; at < text.length; ) {
      const c = text[at];
      if (c !== "+") {
        out += bytes[at] < 0x80 ? c : "�";
        at++;
        continue;
      }
      let end = at + 1;
      while (end < text.length && BASE64.includes(text[end])) end++;
      if (end === at + 1) {
        // "+-" is a plus; a "+" before anything else is nothing.
        if (text[end] === "-") out += "+";
        at = text[end] === "-" ? end + 1 : end;
        continue;
      }
      let bits = 0;
      let count = 0;
      const units: number[] = [];
      for (let index = at + 1; index < end; index++) {
        bits = (bits << 6) | BASE64.indexOf(text[index]);
        count += 6;
        if (count >= 16) {
          count -= 16;
          units.push((bits >> count) & 0xffff);
        }
      }
      for (const unit of units) out += String.fromCharCode(unit);
      at = text[end] === "-" ? end + 1 : end;
    }
    return out;
  },
};

/** ISO-8859-16 from 0xA0 on, as code points; below that it is Latin-1 (control codes and ASCII). */
const ISO_8859_16 = (
  "00a0 0104 0105 0141 20ac 201e 0160 00a7 0161 00a9 0218 00ab 0179 00ad 017a 017b 00b0 00b1 010c 0142 017d 201d 00b6 00b7 017e 010d 0219 00bb 0152 0153 0178 017c " +
  "00c0 00c1 00c2 0102 00c4 0106 00c6 00c7 00c8 00c9 00ca 00cb 00cc 00cd 00ce 00cf 0110 0143 00d2 00d3 00d4 0150 00d6 015a 0170 00d9 00da 00db 00dc 0118 021a 00df " +
  "00e0 00e1 00e2 0103 00e4 0107 00e6 00e7 00e8 00e9 00ea 00eb 00ec 00ed 00ee 00ef 0111 0144 00f2 00f3 00f4 0151 00f6 015b 0171 00f9 00fa 00fb 00fc 0119 021b 00ff"
)
  .split(" ")
  .map((hex) => String.fromCharCode(parseInt(hex, 16)));

const iso885916: CharsetDecoder = {
  decode: (bytes) => Array.from(bytes, (byte) => (byte < 0xa0 ? String.fromCharCode(byte) : ISO_8859_16[byte - 0xa0])).join(""),
};

/** x-user-defined (WHATWG): ASCII, and each byte above it a code point of its own in the private use area. */
const xUserDefined: CharsetDecoder = {
  decode: (bytes) => Array.from(bytes, (byte) => String.fromCharCode(byte < 0x80 ? byte : 0xf780 + byte - 0x80)).join(""),
};

/**
 * Charsets decoded here rather than by the platform: the two no browser has,
 * and two that not every platform's `TextDecoder` has (Node's smaller ICU
 * lacks ISO-8859-16 and x-user-defined), so that a mail reads the same on
 * every device.
 */
const OWN: Readonly<Record<string, CharsetDecoder>> = { ibm850, "utf-7": utf7, "iso-8859-16": iso885916, "x-user-defined": xUserDefined };

const DECODERS = new Map<string, CharsetDecoder>();

function textDecoder(label: string): CharsetDecoder | null {
  try {
    return new TextDecoder(label, { fatal: false });
  } catch {
    return null;
  }
}

/**
 * The decoder of a charset as a mail names it, `null` for a name nobody knows.
 * A name is read as mail-parser reads it: in any case, with `_` for `-`, with
 * the year of its standard after a colon.
 */
export function charsetDecoder(label: string): CharsetDecoder | null {
  const lower = label.trim().toLowerCase().replace(/:\d+$/, "");
  const known = DECODERS.get(lower);
  if (known) return known;
  const dashed = lower.replace(/_/g, "-");
  const alias = Object.prototype.hasOwnProperty.call(ALIASES, dashed) ? ALIASES[dashed] : undefined;
  const platform =
    textDecoder(alias ?? lower) ?? textDecoder(dashed) ?? textDecoder(lower.replace(/-/g, "_")) ?? textDecoder(dashed.replace(/-(\d)/, "_$1")) ?? textDecoder(dashed.replace(/^(ms|x|iso|ks|ansi)-/, "$1_"));
  // The platform's name for it where it knows it, else the name as written: one of the charsets decoded here.
  const own = OWN[alias ?? (platform instanceof TextDecoder ? platform.encoding : dashed)] ?? (platform ? undefined : ownByName(dashed));
  const decoder = own ?? platform;
  if (decoder) DECODERS.set(lower, decoder);
  return decoder;
}

/** One of the charsets decoded here, by a name the platform may not know at all. */
function ownByName(dashed: string): CharsetDecoder | undefined {
  if (dashed === "utf-7") return utf7;
  if (/^(?:iso-?8859-16|iso-ir-226|latin10|l10|csiso885916)$/.test(dashed)) return iso885916;
  if (dashed === "x-user-defined") return xUserDefined;
  return undefined;
}

/** The decoder of a charset, UTF-8 for a name nobody knows. */
export function decoderOrUtf8(label: string): CharsetDecoder {
  return charsetDecoder(label) ?? charsetDecoder("utf-8")!;
}
