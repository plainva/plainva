import type { WritingPurpose } from "./spellcheck";

/**
 * Text a machine reads: an address, a host, a bucket, a key.
 *
 * A keyboard set to Japanese, Chinese or Korean types such text in FULL-WIDTH
 * forms unless the field tells it otherwise: `ｈｔｔｐｓ：／／ｃｌｏｕｄ．ｅｘａｍｐｌｅ．ｃｏｍ`
 * looks like an address and is none - no server answers to it, and the
 * message that comes back ("could not connect") says nothing about the cause.
 * Plainva's connection forms were plain text fields, so that is what such a
 * keyboard produced in them, with autocapitalisation and autocorrection on top
 * (Play feedback 2026-09-30: S3 and WebDAV could not be set up on a phone with
 * a Japanese keyboard. Not reproduced on a device; this is the defect that
 * follows from the forms as they were).
 *
 * Two halves, both here:
 *  - `machineFieldProps` - what a field for such text asks of the keyboard;
 *    the `TextInput` primitive applies it from the field's declared purpose.
 *  - `foldMachineText` - what the form does with the value before it is used:
 *    full-width forms become the ASCII they stand for, whatever keyboard or
 *    paste they came from.
 */

/** Purposes whose text is never a word of a language. */
export function isMachinePurpose(purpose: WritingPurpose): boolean {
  return purpose === "address" || purpose === "secret" || purpose === "code";
}

/**
 * Keyboard hints for a field of that purpose: no capital first letter, no
 * correction. Undefined for prose, names, search and numbers - those keep the
 * platform's behaviour.
 */
export function machineFieldProps(purpose: WritingPurpose): { autoCapitalize?: "none"; autoCorrect?: "off" } {
  return isMachinePurpose(purpose) ? { autoCapitalize: "none", autoCorrect: "off" } : {};
}

const FULLWIDTH_FIRST = 0xff01; // ！
const FULLWIDTH_LAST = 0xff5e; // ～
const FULLWIDTH_OFFSET = 0xfee0;
const IDEOGRAPHIC_SPACE = 0x3000;
const IDEOGRAPHIC_FULL_STOP = 0x3002; // 。 - what a Japanese keyboard types for "."

/**
 * Full-width ASCII, the ideographic space and the ideographic full stop become
 * their ASCII counterparts; the result is trimmed. Everything else - including
 * real CJK characters, which a folder or a user name may contain - is kept.
 * Use it for addresses, hosts, bucket names and key ids; never for passwords.
 */
export function foldMachineText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= FULLWIDTH_FIRST && code <= FULLWIDTH_LAST) out += String.fromCodePoint(code - FULLWIDTH_OFFSET);
    else if (code === IDEOGRAPHIC_SPACE) out += " ";
    else if (code === IDEOGRAPHIC_FULL_STOP) out += ".";
    else out += ch;
  }
  return out.trim();
}
