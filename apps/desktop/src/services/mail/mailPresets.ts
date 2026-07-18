/**
 * Provider presets for the mail account form (mail-client E2). CASA-free path:
 * every provider is reached with IMAP + SMTP submission and an app password
 * (the maintainer's decision 2026-07-18 — no OAuth/CASA for Gmail). A preset
 * only pre-fills the host/port fields; the user still enters user + app
 * password. Pure + unit-tested.
 */

export interface MailPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  smtpHost: string;
  smtpPort: number;
  /** email-domain suffixes that map to this preset */
  domains: string[];
}

export const MAIL_PRESETS: MailPreset[] = [
  { id: "gmail", label: "Gmail", host: "imap.gmail.com", port: 993, smtpHost: "smtp.gmail.com", smtpPort: 587, domains: ["gmail.com", "googlemail.com"] },
  { id: "outlook", label: "Outlook / Microsoft 365", host: "outlook.office365.com", port: 993, smtpHost: "smtp.office365.com", smtpPort: 587, domains: ["outlook.com", "hotmail.com", "live.com", "msn.com", "office365.com"] },
  { id: "yahoo", label: "Yahoo", host: "imap.mail.yahoo.com", port: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, domains: ["yahoo.com", "yahoo.de", "ymail.com"] },
  { id: "icloud", label: "iCloud", host: "imap.mail.me.com", port: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587, domains: ["icloud.com", "me.com", "mac.com"] },
  { id: "fastmail", label: "Fastmail", host: "imap.fastmail.com", port: 993, smtpHost: "smtp.fastmail.com", smtpPort: 465, domains: ["fastmail.com", "fastmail.fm"] },
];

/** Preset for a preset id, or null. */
export function presetById(id: string): MailPreset | null {
  return MAIL_PRESETS.find((p) => p.id === id) ?? null;
}

/** Best-guess preset from an email address' domain (case-insensitive), or null
 * for an unknown/custom domain (the user fills the fields manually). */
export function presetForEmail(email: string): MailPreset | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return null;
  return MAIL_PRESETS.find((p) => p.domains.some((d) => domain === d || domain.endsWith("." + d))) ?? null;
}
