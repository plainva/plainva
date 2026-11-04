/**
 * Sensitivity hints (plan KI-Harness P2b-6): local patterns that suggest a
 * text had better stay on this device — account and card numbers, passwords
 * and keys, ID numbers, health matters. A hint, never a verdict and never a
 * block: "View context" and the send overview name what they saw and suggest
 * keeping the note on this device, or redacting what they found for the rest
 * of the conversation. Nothing here is sent anywhere; the patterns run where
 * the notes are.
 *
 * Every pattern is checked before it counts, so everyday text stays quiet:
 * an IBAN by its mod-97 check, a card number by Luhn (and never a phone
 * number written with "+"), a password or a PIN only behind its label, an ID
 * number only behind its label and with digits in it, a health matter only
 * where two of its words meet ("diagnose the build" is not one).
 */

export type SensitiveKind = "credential" | "account" | "card" | "id" | "health";

/** Every kind, in the order a hint names them. */
export const SENSITIVE_KINDS: readonly SensitiveKind[] = ["credential", "account", "card", "id", "health"];

export interface SensitiveFinding {
  kind: SensitiveKind;
  from: number;
  to: number;
}

/** Kinds whose findings are spans worth redacting; a health matter is a topic, not a number to hide. */
export const REDACTABLE: ReadonlySet<SensitiveKind> = new Set(["credential", "account", "card", "id"]);

/**
 * The pseudo-source of what goes with every message besides the notes: due
 * tasks, appointments, and the open note's selection and properties when that
 * note sends no text of its own. Never a vault path — those are relative.
 */
export const SITUATION_SOURCE = "/situation";

export function isSensitiveKind(value: unknown): value is SensitiveKind {
  return typeof value === "string" && (SENSITIVE_KINDS as readonly string[]).includes(value);
}

const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g;
/** Card numbers start with 2–6 (the networks); a timestamp rarely does, and a number after "+" is a phone's. */
const CARD = /(?<![+\d])\b[2-6]\d(?:[ -]?\d){11,17}\b/g;
const IBAN_HEAD = /[A-Z]{2}\d{2} ?$/;
const PASSWORD_LABEL = /(?<![\p{L}\p{M}])(?:password|passwort|kennwort|passwd|pwd|mot de passe|contraseña|contrasena|senha|wachtwoord|hasło|haslo|passcode|パスワード|密码)\s*[:=]\s*(\S{3,})/giu;
/** A password is not a word of prose: it has a digit or a sign in it, or it ends its line ("app password: switch on …" is an instruction). */
function passwordValue(text: string, value: string, end: number): boolean {
  // The sentence's own punctuation is not part of the value (a loop: a regex here backtracks on long runs).
  let cut = value.length;
  while (cut > 0 && ".,;:!?)".includes(value[cut - 1]!)) cut--;
  return /[^\p{L}]/u.test(value.slice(0, cut)) || /^[ \t]*(?:\r?\n|$)/.test(text.slice(end));
}
const CODE_LABEL = /(?<![\p{L}\p{M}])(?:pin|tan|puk)\s*[:=]\s*\d{4,8}\b/giu;
const API_KEY = /\b(?:sk|pk|rk)[-_](?:live|test|proj)?[-_]?[A-Za-z0-9]{20,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}\b/g;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
/** The label of an ID number; what follows it is checked on its own (`idValue`). */
const ID_LABEL =
  /(?<![\p{L}\p{M}])(?:passport|id card|identity card|driver'?s licen[cs]e|social security|ssn|tax id|personalausweis|ausweis|reisepass|führerschein|steuer-id|steuernummer|steueridentifikationsnummer|sozialversicherungsnummer|passeport|carte d'identité|numéro fiscal|sécurité sociale|pasaporte|dni|documento de identidad|passaporto|carta d'identità|codice fiscale|passaporte|cpf|rg|paspoort|identiteitskaart|bsn|burgerservicenummer|paszport|dowód osobisty|pesel|nip)(?:[ \t]*(?:nr\.?|no\.?|number|nummer|n°|nº|numero|número))?(?:[ \t]*[:#])?[ \t]*/giu;
/** An ID number: capitals and digits, at least four digits, in groups at most. Case-sensitive on purpose — a sentence goes on in small letters. */
const ID_VALUE = /^[A-Z0-9]{2,}(?:[ .-][A-Z0-9]+){0,6}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID_LABEL_CJK = /(?:パスポート|旅券|マイナンバー|护照|身份证)(?:番号|号码|号)?(?:[ \t]*[:：])?[ \t]*[A-Z0-9]{6,18}/gu;

/**
 * Words of health matters in the app's ten languages, with the inflections
 * Polish needs. A word alone says little — "diagnose the build", the Great
 * Depression —, so a health matter is where two different ones meet and at
 * least one of them is unmistakable (a doctor, a prescription, a sick note).
 */
const HEALTH_STRONG = [
  "doctor", "therapist", "medication", "prescription", "chemotherapy", "anxiety disorder", "sick leave", "blood test",
  "arzt", "ärztin", "arztbrief", "befund", "krankschreibung", "medikament", "medikamente", "blutbild", "therapeut", "therapeutin",
  "médecin", "ordonnance", "médicament", "arrêt maladie",
  "médico", "medicamento", "receta médica", "baja médica",
  "medico", "farmaco", "ricetta medica", "certificato medico",
  "remédio", "receita médica", "atestado médico",
  "huisarts", "medicijn", "medicatie", "ziekmelding",
  "lekarz", "lekarza", "lekarzem", "recepta", "recepty", "zwolnienie lekarskie",
  "医師", "処方箋", "服薬", "うつ病", "医生", "处方", "病假", "抑郁症",
];
const HEALTH_WEAK = [
  "diagnosis", "diagnosed", "therapy", "symptoms", "depression", "hospital",
  "diagnose", "diagnostiziert", "therapie", "symptome", "krankenhaus", "klinik",
  "diagnostic", "thérapie", "symptômes", "hôpital",
  "diagnóstico", "terapia", "síntomas",
  "diagnosi", "sintomi", "ospedale",
  "sintomas",
  "symptomen", "ziekenhuis",
  "diagnoza", "diagnozy", "diagnozę", "terapii", "terapię", "objawy", "objawów", "szpital", "szpitala", "szpitalu",
  "診断", "治療中", "症状", "病院", "诊断", "治疗", "医院",
];
const STRONG = new Set(HEALTH_STRONG);
const CJK = /[぀-ヿ一-鿿]/;
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const healthWords = [...new Set([...HEALTH_STRONG, ...HEALTH_WEAK])];
/** Words in letters end where letters end; words in CJK scripts stand in running text. */
const HEALTH = new RegExp(`(?<![\\p{L}\\p{M}])(?:${healthWords.filter((w) => !CJK.test(w)).map(escape).join("|")})(?![\\p{L}\\p{M}])`, "giu");
const HEALTH_CJK = new RegExp(healthWords.filter((w) => CJK.test(w)).map(escape).join("|"), "gu");

function ibanOk(raw: string): boolean {
  const iban = raw.replace(/ /g, "");
  if (iban.length < 15 || iban.length > 34) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function luhnOk(raw: string): boolean {
  const digits = raw.replace(/[ -]/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The ID number right after a label, if what follows is one. */
function idValue(text: string, at: number): number | null {
  const m = ID_VALUE.exec(text.slice(at, at + 40));
  if (!m) return null;
  const value = m[0];
  const digits = value.replace(/\D/g, "").length;
  // A date after a label ("passport 2026-10-01 to collect") is when, not which.
  return digits >= 4 && value.length >= 6 && !DATE.test(value) ? at + value.length : null;
}

/** What the patterns saw in a text, in order; overlapping findings keep the first. */
export function sensitiveFindings(text: string): SensitiveFinding[] {
  const found: SensitiveFinding[] = [];
  const add = (kind: SensitiveKind, from: number, to: number) => {
    if (found.some((f) => from < f.to && to > f.from)) return;
    found.push({ kind, from, to });
  };
  for (const m of text.matchAll(PRIVATE_KEY)) add("credential", m.index, m.index + m[0].length);
  for (const m of text.matchAll(API_KEY)) add("credential", m.index, m.index + m[0].length);
  for (const m of text.matchAll(PASSWORD_LABEL)) if (passwordValue(text, m[1]!, m.index + m[0].length)) add("credential", m.index, m.index + m[0].length);
  for (const m of text.matchAll(CODE_LABEL)) add("credential", m.index, m.index + m[0].length);
  for (const m of text.matchAll(IBAN)) if (ibanOk(m[0])) add("account", m.index, m.index + m[0].length);
  // Not the tail of an IBAN that failed its own check: its digits are an account, not a card.
  for (const m of text.matchAll(CARD)) if (luhnOk(m[0]) && !IBAN_HEAD.test(text.slice(Math.max(0, m.index - 5), m.index))) add("card", m.index, m.index + m[0].length);
  for (const m of text.matchAll(SSN)) add("id", m.index, m.index + m[0].length);
  for (const m of text.matchAll(ID_LABEL)) {
    const end = idValue(text, m.index + m[0].length);
    if (end !== null) add("id", m.index, end);
  }
  for (const m of text.matchAll(ID_LABEL_CJK)) add("id", m.index, m.index + m[0].length);
  const health = [...text.matchAll(HEALTH), ...text.matchAll(HEALTH_CJK)];
  const words = new Set(health.map((m) => m[0].toLowerCase()));
  if (words.size >= 2 && [...words].some((word) => STRONG.has(word))) for (const m of health) add("health", m.index, m.index + m[0].length);
  return found.sort((a, b) => a.from - b.from);
}

/** The kinds a text raises, each once, in a fixed order. */
export function sensitiveKinds(findings: readonly SensitiveFinding[]): SensitiveKind[] {
  return SENSITIVE_KINDS.filter((kind) => findings.some((f) => f.kind === kind));
}

/** The kinds that still go once a source is redacted: health words stay, the numbers and secrets do not. */
export function goingKinds(kinds: readonly SensitiveKind[], redacted: boolean): SensitiveKind[] {
  return redacted ? kinds.filter((kind) => !REDACTABLE.has(kind)) : [...kinds];
}

/** Replaces what can be redacted with a placeholder naming its kind; health words stay — the topic is the note's. */
export function redactSensitive(text: string, findings: readonly SensitiveFinding[]): { text: string; redacted: number } {
  let out = "";
  let at = 0;
  let redacted = 0;
  for (const f of findings) {
    if (!REDACTABLE.has(f.kind) || f.from < at) continue;
    out += `${text.slice(at, f.from)}⟦withheld ${f.kind}⟧`;
    at = f.to;
    redacted++;
  }
  return { text: out + text.slice(at), redacted };
}
