import { stripInvisible } from "../trust.js";

/**
 * A question of a foreign MCP server to the user (plan KI-Harness P9-4a;
 * MCP 2026-07-28 "Elicitation", asked in the multi round-trip pattern): what
 * the server asks, read so that a client can show it without trusting a word
 * of it — and what the user answers, checked against what was asked before
 * it goes back. The answer goes to the server that asked and to nobody else:
 * no model is given the question or the answer.
 *
 * Two kinds. A **form**: a flat object of primitive fields — text (with the
 * formats email, uri, date and date-time), a number, a whole number, yes or
 * no, a choice of one or of several — or no field at all, which asks the user
 * to confirm. And an **address**: a page the server wants the user to open in
 * their own browser, for what must not pass through the client — a sign-in
 * at a third service, a payment.
 *
 * Plainva answers no question for a secret. A server must not ask for a
 * password, a key, a token or payment data in a form (the protocol's MUST
 * NOT); a form with a field the user would type such a thing into is refused
 * and not shown.
 */

export const MCP_ELICIT_LIMITS = {
  message: 1_000,
  title: 120,
  description: 400,
  fields: 20,
  choices: 50,
  choiceText: 120,
  /** The longest text the user may answer in one field. */
  text: 2_000,
  url: 2_048,
  /** Questions in one round of one request; a server that asks more at once is not followed. */
  perRound: 5,
} as const;

export type McpElicitMode = "form" | "url";

/** What a client that shows both kinds declares. */
export const MCP_ELICIT_MODES: readonly McpElicitMode[] = ["form", "url"];

export type McpElicitChoice = { value: string; label: string };

export type McpElicitField =
  | { kind: "text"; name: string; title: string; description: string; required: boolean; format?: "email" | "uri" | "date" | "date-time"; minLength?: number; maxLength?: number; default?: string }
  | { kind: "number"; name: string; title: string; description: string; required: boolean; integer: boolean; minimum?: number; maximum?: number; default?: number }
  | { kind: "boolean"; name: string; title: string; description: string; required: boolean; default?: boolean }
  | { kind: "choice"; name: string; title: string; description: string; required: boolean; choices: McpElicitChoice[]; default?: string }
  | { kind: "choices"; name: string; title: string; description: string; required: boolean; choices: McpElicitChoice[]; minItems?: number; maxItems?: number; default?: string[] };

export type McpElicitRefusal =
  /** The form asks for a secret — a password, a key, a token, payment data — where the user would type it. */
  | "secret"
  /** The form is not one Plainva shows: nested, an unknown type or format, too many fields or choices, a mode it did not offer. */
  | "shape"
  /** The page is not one Plainva opens: no https (http only on this device, for a server on this device), or an address with a sign-in of its own. */
  | "address";

export type McpElicitation =
  /** `fields` may be empty: then the server asks the user to confirm. */
  | { kind: "form"; message: string; fields: McpElicitField[] }
  /**
   * `url` is the whole address as it will open. `prefix`, `host` and `rest`
   * are the same address in three pieces, so that the host can be shown
   * apart; `punycode` where a label of the host is written in the form other
   * scripts take in an address, `ip` where the host is a bare IP address.
   */
  | { kind: "url"; message: string; url: string; prefix: string; host: string; rest: string; punycode: boolean; ip: boolean }
  /** Not shown, answered with `decline`: why — and, where one field asked for a secret, that field in the server's words. */
  | { kind: "refused"; reason: McpElicitRefusal; message: string; field?: string };

export type McpElicitResult = { action: "accept"; content?: Record<string, unknown> } | { action: "decline" } | { action: "cancel" };

export type McpElicitOutcome = "answered" | "declined" | "cancelled" | "refused";

/**
 * Where a client lets a server ask (plan P9-4a): the kinds it can show, and
 * the user, asked one question at a time. `ask` is called for every question
 * the user is to see, a refused one included — so that the user hears of
 * it —, and what it returns for a refused one does not count: the server gets
 * `decline`. `replied` hears every answer that goes to the server, the ones
 * nobody was asked included. `local`: the server runs on this device — only
 * then may a page it asks to open lie on this device too.
 */
export interface McpQuestions {
  modes: readonly McpElicitMode[];
  local?: boolean;
  ask(question: McpElicitation, signal?: AbortSignal): Promise<McpElicitResult>;
  replied?(reply: McpElicitResult): void;
}

/** What a client declares in a request where it lets the server ask. */
export function mcpElicitCapabilities(modes: readonly McpElicitMode[]): Record<string, unknown> {
  return { elicitation: Object.fromEntries(MCP_ELICIT_MODES.filter((mode) => modes.includes(mode)).map((mode) => [mode, {}])) };
}

/** How an answer went, for the record of a run: never what was answered. */
export function mcpElicitOutcome(question: McpElicitation, result: McpElicitResult): McpElicitOutcome {
  if (question.kind === "refused") return "refused";
  return result.action === "accept" ? "answered" : result.action === "decline" ? "declined" : "cancelled";
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const own = (record: Readonly<Record<string, unknown>>, key: string): unknown => (Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined);

/** A stranger's text as a person may read it: invisible characters out, white space folded, cut — never inside a character. */
function said(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const folded = stripInvisible(value).text.replace(/\s+/g, " ").trim();
  const chars = Array.from(folded);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : folded;
}

/**
 * Roots of words that name a secret, found inside a longer word too — the
 * way German and Dutch join words ("Einmalpasswort", "Kreditkartennummer")
 * and Polish bends them ("hasłem"). Looked for in every text of a form that
 * has a field to type into.
 */
const SECRET_ROOTS = [
  "password",
  "passwort",
  "passwd",
  "kennwort",
  "wachtwoord",
  "passphrase",
  "passcode",
  "contraseña",
  "hasł",
  "zugangsdaten",
  "anmeldedaten",
  "zugangscode",
  "sicherheitscode",
  "bestätigungscode",
  "zugangstoken",
  "kreditkarte",
  "kartennummer",
  "kontonummer",
];

/**
 * Phrases that name a secret beyond doubt — a key, a token, a code that signs
 * one in, payment data —, as whole words, in the app's languages; an English
 * one counts in the plural too. Looked for in every text of a form that has a
 * field to type into: the question, each field's name, title and
 * description, the labels of its choices.
 */
const SECRET_PHRASES = [
  "mot de passe",
  "senha",
  "identifiants",
  "credenciales",
  "credenziali",
  "dane logowania",
  "パスワード",
  "暗証番号",
  "認証コード",
  "秘密鍵",
  "カード番号",
  "密码",
  "口令",
  "密钥",
  "私钥",
  "验证码",
  "认证码",
  "信用卡",
  "卡号",
  "api key",
  "apikey",
  "api schlüssel",
  "api sleutel",
  "clé api",
  "clé d api",
  "clave api",
  "clave de api",
  "chiave api",
  "chave api",
  "chave de api",
  "klucz api",
  "apiキー",
  "access key",
  "secret key",
  "private key",
  "privater schlüssel",
  "geheimer schlüssel",
  "zugangsschlüssel",
  "ssh key",
  "client secret",
  "access token",
  "api token",
  "auth token",
  "personal access token",
  "refresh token",
  "oauth token",
  "bearer token",
  "session cookie",
  "credentials",
  "seed phrase",
  "recovery phrase",
  "recovery code",
  "backup code",
  "one time code",
  "verification code",
  "security code",
  "auth code",
  "authentication code",
  "authenticator code",
  "2fa code",
  "mfa code",
  "otp code",
  "sms code",
  "login code",
  "pin code",
  "tan code",
  "código de verificación",
  "código de verificação",
  "code de vérification",
  "codice di verifica",
  "kod weryfikacyjny",
  "verificatiecode",
  "credit card",
  "card number",
  "bank account",
  "account number",
  "routing number",
  "iban",
  "cvv",
  "cvc",
];

/**
 * Words that may name a secret — or something else: a colour, a map pin, a
 * budget of tokens, a working directory. Looked for where they say what the
 * user is to type: the question, and the name, title and description of a
 * field to type into. In doubt a form is refused — a server that asks this
 * way could as well be after the thing itself.
 */
const SECRET_WORDS = ["secret", "geheimnis", "token", "jeton", "トークン", "令牌", "credential", "pin", "tan", "pwd", "otp", "2fa", "mfa", "cookie", "bearer", "jwt", "mnemonic"];

/**
 * A text as words: compatibility forms folded (full-width letters, decomposed
 * accents), words written together split where a capital or a digit starts
 * one (`accessToken`, `APIKey`, `cvv2`), lower case, everything that is no
 * letter or digit a space.
 */
function words(text: string): string {
  const split = text
    .normalize("NFKC")
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2")
    .replace(/(\p{L})(\p{N})/gu, "$1 $2")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2");
  return ` ${split.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
}

/** Scripts that write words without spaces: there a word is found inside the text, elsewhere only as a word of its own. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
/** Whole words as keys — with an English plural beside each phrase that ends in a Latin letter. */
const keysOf = (list: readonly string[], plurals: boolean) =>
  list.flatMap((word) => {
    if (UNSPACED.test(word)) return [words(word).trim()];
    const key = words(word);
    return plurals && /[a-z]$/.test(word) && !word.endsWith("s") ? [key, `${key.slice(0, -1)}s `] : [key];
  });
const ROOT_KEYS = SECRET_ROOTS.map((root) => words(root).trim());
const PHRASE_KEYS = keysOf(SECRET_PHRASES, true);
const WORD_KEYS = keysOf(SECRET_WORDS, false);

/**
 * True where the texts name a secret: by a root or a phrase anywhere — and,
 * `where` they say what the user types, by one of the words that may name one.
 */
export function namesSecret(texts: readonly string[], where: "typed" | "around" = "typed"): boolean {
  const hay = words(texts.join(" "));
  return ROOT_KEYS.some((key) => hay.includes(key)) || PHRASE_KEYS.some((key) => hay.includes(key)) || (where === "typed" && WORD_KEYS.some((key) => hay.includes(key)));
}

const FORMATS = new Set(["email", "uri", "date", "date-time"]);
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const whole = (value: unknown): number | undefined => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const only = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> => (value === undefined ? {} : ({ [key]: value } as Record<K, V>));

/**
 * One list of choices: a plain `enum` (with `enumNames` as labels where
 * given), or `oneOf`/`anyOf` of `{const, title}`. Null where it is anything
 * else — and where it could not be shown as asked: more choices than a card
 * holds, a value twice, an empty value, a label that is nothing once cleaned.
 */
function choicesOf(schema: Record<string, unknown>, key: "oneOf" | "anyOf"): McpElicitChoice[] | null {
  let pairs: { value: unknown; label: unknown }[];
  if (Array.isArray(schema.enum)) {
    const names = Array.isArray(schema.enumNames) && schema.enumNames.length === schema.enum.length ? schema.enumNames : null;
    pairs = schema.enum.map((value, index) => ({ value, label: names ? names[index] : value }));
  } else if (Array.isArray(schema[key])) {
    pairs = (schema[key] as unknown[]).map((entry) => (isRecord(entry) ? { value: entry.const, label: entry.title ?? entry.const } : { value: undefined, label: undefined }));
  } else return null;
  if (pairs.length === 0 || pairs.length > MCP_ELICIT_LIMITS.choices) return null;
  const out: McpElicitChoice[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    if (typeof pair.value !== "string" || pair.value.trim() === "" || seen.has(pair.value)) return null;
    const label = said(typeof pair.label === "string" ? pair.label : pair.value, MCP_ELICIT_LIMITS.choiceText) || said(pair.value, MCP_ELICIT_LIMITS.choiceText);
    if (!label) return null;
    seen.add(pair.value);
    out.push({ value: pair.value, label });
  }
  return out;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MOMENT = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?([Zz]|[+-]\d{2}:\d{2})?$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,253}$/;

/** A calendar day that exists: 2026-02-30 is none, whatever an engine would make of it. */
function realDay(year: number, month: number, day: number): boolean {
  // Set by its parts: `Date.UTC` would read the years 0 to 99 as 1900 to 1999.
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

export type McpElicitProblem = "required" | "short" | "long" | "format" | "range" | "count";

/** One text answer for a field, checked — and in the form it goes: an address made whole, a moment with its zone. */
function textAnswer(field: Extract<McpElicitField, { kind: "text" }>, value: string): { ok: true; value: string } | { ok: false; problem: McpElicitProblem } {
  if (field.minLength !== undefined && value.length < field.minLength) return { ok: false, problem: "short" };
  if (value.length > Math.min(field.maxLength ?? MCP_ELICIT_LIMITS.text, MCP_ELICIT_LIMITS.text)) return { ok: false, problem: "long" };
  switch (field.format) {
    case "email":
      return EMAIL.test(value) ? { ok: true, value } : { ok: false, problem: "format" };
    case "uri":
      try {
        return { ok: true, value: new URL(value).href };
      } catch {
        return { ok: false, problem: "format" };
      }
    case "date": {
      const m = DAY.exec(value);
      return m && realDay(Number(m[1]), Number(m[2]), Number(m[3])) ? { ok: true, value } : { ok: false, problem: "format" };
    }
    case "date-time": {
      // A time without a zone is the device's own time; what goes is the same moment with its offset spelled out.
      const m = MOMENT.exec(value);
      if (!m || !realDay(Number(m[1]), Number(m[2]), Number(m[3])) || Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6] ?? 0) > 59) return { ok: false, problem: "format" };
      const at = Date.parse(value.toUpperCase());
      return Number.isNaN(at) ? { ok: false, problem: "format" } : { ok: true, value: new Date(at).toISOString() };
    }
    default:
      return { ok: true, value };
  }
}

/** A name the answer can carry as a key of its own: not one every object has already. */
const fieldName = (name: string): boolean => name.length > 0 && name.length <= 128 && !(name in Object.prototype);

function fieldOf(name: string, schema: unknown, required: boolean): McpElicitField | null {
  if (!isRecord(schema)) return null;
  const title = said(schema.title, MCP_ELICIT_LIMITS.title) || said(name, MCP_ELICIT_LIMITS.title);
  if (!title) return null;
  const description = said(schema.description, MCP_ELICIT_LIMITS.description);
  const base = { name, title, description, required };
  switch (schema.type) {
    case "string": {
      if (schema.enum !== undefined || schema.oneOf !== undefined) {
        const choices = choicesOf(schema, "oneOf");
        if (!choices) return null;
        const fallback = typeof schema.default === "string" && choices.some((choice) => choice.value === schema.default) ? schema.default : undefined;
        return { kind: "choice", ...base, choices, ...only("default", fallback) };
      }
      if (schema.format !== undefined && !(typeof schema.format === "string" && FORMATS.has(schema.format))) return null;
      const field: Extract<McpElicitField, { kind: "text" }> = {
        kind: "text",
        ...base,
        ...only("format", typeof schema.format === "string" ? (schema.format as "email" | "uri" | "date" | "date-time") : undefined),
        ...only("minLength", whole(schema.minLength)),
        ...only("maxLength", whole(schema.maxLength)),
      };
      // A default that would not pass as an answer is no default: the field starts empty.
      const fallback = typeof schema.default === "string" ? textAnswer(field, schema.default) : null;
      return fallback?.ok ? { ...field, default: fallback.value } : field;
    }
    case "number":
    case "integer": {
      const integer = schema.type === "integer";
      const minimum = finite(schema.minimum);
      const maximum = finite(schema.maximum);
      const fallback = finite(schema.default);
      const fits = fallback !== undefined && (!integer || Number.isInteger(fallback)) && (minimum === undefined || fallback >= minimum) && (maximum === undefined || fallback <= maximum);
      return { kind: "number", ...base, integer, ...only("minimum", minimum), ...only("maximum", maximum), ...only("default", fits ? fallback : undefined) };
    }
    case "boolean":
      return { kind: "boolean", ...base, ...only("default", typeof schema.default === "boolean" ? schema.default : undefined) };
    case "array": {
      if (!isRecord(schema.items)) return null;
      const choices = choicesOf(schema.items, "anyOf");
      if (!choices) return null;
      const known = new Set(choices.map((choice) => choice.value));
      const fallback = Array.isArray(schema.default) && schema.default.every((value) => typeof value === "string" && known.has(value)) ? [...new Set(schema.default as string[])] : undefined;
      return { kind: "choices", ...base, choices, ...only("minItems", whole(schema.minItems)), ...only("maxItems", whole(schema.maxItems)), ...only("default", fallback) };
    }
    default:
      return null;
  }
}

/** A host on this device: `localhost`, a name under it, or a loopback address — as a URL's `hostname` writes it. */
export function mcpOnDeviceHost(host: string): boolean {
  // A name may end in a dot; an address of "this host" (0.0.0.0, ::) and a loopback written as IPv6 are this device too.
  const name = host.toLowerCase().replace(/\.$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name === "localhost.localdomain" ||
    name === "[::1]" ||
    name === "[::]" ||
    name === "0.0.0.0" ||
    /^127(?:\.\d{1,3}){3}$/.test(name) ||
    /^\[::ffff:(?:7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/.test(name)
  );
}
/** A host that is a bare address: an IPv4 address or an IPv6 one in brackets. */
const bareAddress = (host: string): boolean => host.startsWith("[") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

/** A field the user types into: only there can a secret go. */
const typed = (field: McpElicitField): boolean => field.kind === "text" || field.kind === "number";

export interface McpElicitReadOptions {
  /** The kinds this client declared; a question of another kind is refused. */
  modes?: readonly McpElicitMode[];
  /** The server runs on this device: only then may a page it asks to open be on this device. */
  local?: boolean;
}

/**
 * What a server's `elicitation/create` asks, as Plainva will show it — or
 * why it will not be shown. `params` is the server's, unchecked.
 */
export function readMcpElicitation(params: unknown, options: McpElicitReadOptions = {}): McpElicitation {
  const modes = options.modes ?? MCP_ELICIT_MODES;
  if (!isRecord(params)) return { kind: "refused", reason: "shape", message: "" };
  const message = said(params.message, MCP_ELICIT_LIMITS.message);
  const mode = params.mode ?? "form";
  if ((mode !== "form" && mode !== "url") || !modes.includes(mode)) return { kind: "refused", reason: "shape", message };
  if (mode === "url") {
    const raw = typeof params.url === "string" ? params.url : "";
    let url: URL | null;
    try {
      url = raw.length > 0 && raw.length <= MCP_ELICIT_LIMITS.url ? new URL(raw) : null;
    } catch {
      url = null;
    }
    const refused: McpElicitation = { kind: "refused", reason: "address", message };
    if (!url || url.username || url.password) return refused;
    const host = url.host.toLowerCase();
    const onDevice = mcpOnDeviceHost(url.hostname);
    // A page is https; one on this device only for a server on this device — and there http as well.
    if (onDevice ? !options.local || !(url.protocol === "https:" || url.protocol === "http:") : url.protocol !== "https:") return refused;
    const prefix = `${url.protocol}//`;
    if (!url.href.toLowerCase().startsWith(`${prefix}${host}`)) return refused;
    return {
      kind: "url",
      message,
      url: url.href,
      prefix,
      host,
      rest: url.href.slice(prefix.length + host.length),
      punycode: url.hostname.split(".").some((label) => label.toLowerCase().startsWith("xn--")),
      ip: bareAddress(url.hostname),
    };
  }
  const schema = params.requestedSchema;
  if (!isRecord(schema) || schema.type !== "object" || (schema.properties !== undefined && !isRecord(schema.properties))) return { kind: "refused", reason: "shape", message };
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === "string") : []);
  const entries = Object.entries(isRecord(schema.properties) ? schema.properties : {});
  if (entries.length > MCP_ELICIT_LIMITS.fields) return { kind: "refused", reason: "shape", message };
  const fields: McpElicitField[] = [];
  for (const [name, property] of entries) {
    const field = fieldName(name) ? fieldOf(name, property, required.has(name)) : null;
    if (!field) return { kind: "refused", reason: "shape", message };
    fields.push(field);
  }
  if (fields.some(typed)) {
    // What a field to type into is called says what goes into it: every word that may name a secret counts there.
    const named = fields.find((field) => typed(field) && namesSecret([field.name, field.title], "typed"));
    if (named) return { kind: "refused", reason: "secret", message, field: named.title };
    // So does what tells the user what to type: the question, and the description of such a field.
    if (namesSecret([message, ...fields.filter(typed).map((field) => field.description)], "typed")) return { kind: "refused", reason: "secret", message };
    // Everything else around it — a neighbour, a choice — may say so too, but only in so many words.
    const around = fields.flatMap((field) => [field.name, field.title, field.description, ...(field.kind === "choice" || field.kind === "choices" ? field.choices.map((choice) => choice.label) : [])]);
    if (namesSecret(around, "around")) return { kind: "refused", reason: "secret", message };
  }
  return { kind: "form", message, fields };
}

/**
 * A number as a person writes it: digits, one decimal separator, an exponent.
 * `decimal` is the separator of the user's language; the other one counts as
 * a decimal separator too — unless three digits follow it, where it could
 * as well separate thousands: "1,000" is no number to guess.
 */
export function parseMcpNumber(text: string, decimal: "." | "," = "."): number {
  // Full-width digits, as an input method writes them, are digits; a number may begin with its separator.
  const m = /^([+-]?)(\d*)(?:([.,])(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text.normalize("NFKC").trim());
  if (!m || (!m[2] && !m[4])) return Number.NaN;
  const [, sign, int, separator, fraction, exponent] = m;
  // Ambiguous only where it could be a group: one to three digits before it, not starting with a zero.
  if (separator && separator !== decimal && fraction!.length === 3 && /^[1-9]\d{0,2}$/.test(int!)) return Number.NaN;
  return Number(`${sign}${int || "0"}${fraction ? `.${fraction}` : ""}${exponent ? `e${exponent}` : ""}`);
}

export interface McpElicitCheckOptions {
  /** The decimal separator of the user's language. */
  decimal?: "." | ",";
}

/**
 * What the user filled in, checked against what was asked: the content that
 * goes to the server, or the fields that are not right yet (by name, with
 * what is wrong). An empty field that is not required is left out; a field
 * the form does not have is never sent.
 */
export function checkMcpElicitAnswer(
  form: Extract<McpElicitation, { kind: "form" }>,
  values: Readonly<Record<string, unknown>>,
  options: McpElicitCheckOptions = {},
): { ok: true; content: Record<string, unknown> } | { ok: false; problems: Record<string, McpElicitProblem> } {
  const content: [string, unknown][] = [];
  const problems: [string, McpElicitProblem][] = [];
  for (const field of form.fields) {
    const value = own(values, field.name);
    const empty = value === undefined || value === null || (field.kind === "text" && typeof value === "string" && value.trim() === "") || (field.kind === "number" && typeof value === "string" && value.trim() === "") || (field.kind === "choice" && value === "") || (Array.isArray(value) && value.length === 0);
    if (empty) {
      // A box nobody ticked is a "no", not a gap; a choice of several that may stay empty goes as none.
      if (field.kind === "boolean" && field.required) content.push([field.name, false]);
      else if (field.kind === "choices" && field.required && field.minItems === 0) content.push([field.name, []]);
      else if (field.required) problems.push([field.name, "required"]);
      continue;
    }
    switch (field.kind) {
      case "text": {
        const checked = typeof value === "string" ? textAnswer(field, value.trim()) : ({ ok: false, problem: "format" } as const);
        if (checked.ok) content.push([field.name, checked.value]);
        else problems.push([field.name, checked.problem]);
        break;
      }
      case "number": {
        const number = typeof value === "number" ? value : typeof value === "string" ? parseMcpNumber(value, options.decimal) : Number.NaN;
        if (!Number.isFinite(number) || (field.integer && !Number.isInteger(number))) problems.push([field.name, "format"]);
        else if ((field.minimum !== undefined && number < field.minimum) || (field.maximum !== undefined && number > field.maximum)) problems.push([field.name, "range"]);
        else content.push([field.name, number]);
        break;
      }
      case "boolean":
        content.push([field.name, value === true]);
        break;
      case "choice":
        if (typeof value === "string" && field.choices.some((choice) => choice.value === value)) content.push([field.name, value]);
        else problems.push([field.name, "format"]);
        break;
      case "choices": {
        const picked = Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string"))] : [];
        const known = new Set(field.choices.map((choice) => choice.value));
        if (picked.length === 0 || picked.some((entry) => !known.has(entry))) problems.push([field.name, "format"]);
        else if ((field.minItems !== undefined && picked.length < field.minItems) || (field.maxItems !== undefined && picked.length > field.maxItems)) problems.push([field.name, "count"]);
        else content.push([field.name, picked]);
        break;
      }
    }
  }
  return problems.length ? { ok: false, problems: Object.fromEntries(problems) } : { ok: true, content: Object.fromEntries(content) };
}

/** The values a form starts with: each field's default, where the server gave one that passes. */
export function mcpElicitDefaults(form: Extract<McpElicitation, { kind: "form" }>): Record<string, unknown> {
  return Object.fromEntries(form.fields.flatMap((field) => (field.default !== undefined ? [[field.name, field.default] as const] : [])));
}

/**
 * The answer that goes to the server, whatever the asking side returned:
 * `decline` for a question that was refused; for a form, an accepted answer
 * only with content that passes the check again — anything else is a
 * `decline`; for a page, an accept carries nothing.
 */
export function mcpElicitReply(question: McpElicitation, result: McpElicitResult): McpElicitResult {
  if (question.kind === "refused") return { action: "decline" };
  if (result.action !== "accept") return result.action === "cancel" ? { action: "cancel" } : { action: "decline" };
  if (question.kind === "url") return { action: "accept" };
  const checked = checkMcpElicitAnswer(question, isRecord(result.content) ? result.content : {});
  return checked.ok ? { action: "accept", content: checked.content } : { action: "decline" };
}
