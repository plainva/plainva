/**
 * Provider catalog (cloud accounts, stage A+ 2026-07-20): the DATA behind the
 * wizard tiles and the international IMAP presets. A new provider is a catalog
 * entry, not a code branch — tiles, endpoint prefills, auth hints and the
 * family detection for migrated subsystem entries all read from here.
 *
 * Every endpoint below was verified against the provider's official help pages
 * (research 2026-07-20); the source URL sits next to each entry. Providers
 * whose endpoints could only be found on aggregator sites were deliberately
 * left out (maintainer decision E7) — a preset that silently fails is worse
 * than none.
 *
 * Pure and platform-neutral (shared with mobile).
 */

import type { CloudProviderFamily, CloudServiceId } from "./cloudAccounts";

/**
 * How the user authenticates at this provider. This is a UI hint, not a code
 * path — everything is username+secret over IMAP/CalDAV/WebDAV; the hint tells
 * the user WHICH secret the provider expects:
 *  - "password":      the normal account password
 *  - "app-password":  a generated app-specific password (account password rejected)
 *  - "auth-code":     Chinese providers' "authorization code" (授权码)
 *  - "mail-password": a separate mail-only password, distinct from the account login
 */
export type ProviderAuthMode = "password" | "app-password" | "auth-code" | "mail-password";

/** Coarse region tags for grouping/searching the preset dropdown. */
export type ProviderRegion =
  | "global"
  | "dach"
  | "fr"
  | "it"
  | "benelux"
  | "pl"
  | "cz"
  | "na"
  | "cn"
  | "kr"
  | "jp"
  | "ru"
  | "au";

export interface MailPreset {
  id: string;
  label: string;
  host: string;
  port: number;
  smtpHost: string;
  smtpPort: number;
  /** email-domain suffixes that map to this preset */
  domains: string[];
  authMode: ProviderAuthMode;
  /** Official provider page explaining the required password/code. */
  helpUrl?: string;
  /** IMAP must first be enabled in the provider's own settings. */
  enableHint?: boolean;
  regions: ProviderRegion[];
  /**
   * Dead-end preset: selecting it must NOT connect but point to the named
   * wizard tile instead (Microsoft killed IMAP basic auth for outlook.com).
   */
  useTileInstead?: CloudProviderFamily;
  /** Proton: needs the locally running (paid) Proton Mail Bridge. */
  bridge?: boolean;
}

export const MAIL_PRESETS: MailPreset[] = [
  // ---- Global -------------------------------------------------------------
  // support.google.com/mail/answer/185833 (app passwords) + /answer/7126229 (servers)
  { id: "gmail", label: "Gmail", host: "imap.gmail.com", port: 993, smtpHost: "smtp.gmail.com", smtpPort: 587, domains: ["gmail.com", "googlemail.com"], authMode: "app-password", helpUrl: "https://support.google.com/mail/answer/185833", regions: ["global"] },
  // Microsoft shut down IMAP basic auth for consumer accounts — the preset
  // stays visible (people WILL look for it) but routes to the Microsoft tile.
  { id: "outlook", label: "Outlook / Microsoft 365", host: "outlook.office365.com", port: 993, smtpHost: "smtp.office365.com", smtpPort: 587, domains: ["outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com"], authMode: "password", regions: ["global"], useTileInstead: "microsoft" },
  // help.yahoo.com/kb/SLN4075 (servers) + /kb/SLN15241 (app passwords)
  { id: "yahoo", label: "Yahoo Mail", host: "imap.mail.yahoo.com", port: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, domains: ["yahoo.com", "yahoo.de", "yahoo.fr", "yahoo.it", "yahoo.es", "yahoo.co.uk", "yahoo.ca", "yahoo.com.br", "yahoo.com.au", "ymail.com", "rocketmail.com"], authMode: "app-password", helpUrl: "https://help.yahoo.com/kb/SLN15241.html", regions: ["global"] },
  // help.aol.com "Create and manage app passwords" + IMAP settings article
  { id: "aol", label: "AOL Mail", host: "imap.aol.com", port: 993, smtpHost: "smtp.aol.com", smtpPort: 465, domains: ["aol.com", "aol.de", "aim.com"], authMode: "app-password", helpUrl: "https://help.aol.com/articles/Create-and-manage-app-password", regions: ["global", "na"] },
  // support.apple.com/en-us/102525 (servers) + /102654 (app-specific passwords)
  { id: "icloud", label: "iCloud Mail", host: "imap.mail.me.com", port: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587, domains: ["icloud.com", "me.com", "mac.com"], authMode: "app-password", helpUrl: "https://support.apple.com/102654", regions: ["global"] },
  // fastmail.help articles 1500000278342 (servers) + 360058752854 (app passwords)
  { id: "fastmail", label: "Fastmail", host: "imap.fastmail.com", port: 993, smtpHost: "smtp.fastmail.com", smtpPort: 465, domains: ["fastmail.com", "fastmail.fm", "fastmail.de", "sent.com"], authMode: "app-password", helpUrl: "https://www.fastmail.help/hc/en-us/articles/360058752854", regions: ["global"] },
  // zoho.com/mail/help/imap-access.html (imappro hosts serve custom domains)
  { id: "zoho", label: "Zoho Mail", host: "imap.zoho.com", port: 993, smtpHost: "smtp.zoho.com", smtpPort: 465, domains: ["zoho.com", "zohomail.com", "zohomail.eu"], authMode: "app-password", helpUrl: "https://www.zoho.com/mail/help/imap-access.html", regions: ["global"] },
  // proton.me/mail/bridge — IMAP only through the local paid Bridge relay
  { id: "protonbridge", label: "Proton Mail (Bridge)", host: "127.0.0.1", port: 1143, smtpHost: "127.0.0.1", smtpPort: 1025, domains: ["proton.me", "protonmail.com", "pm.me"], authMode: "password", helpUrl: "https://proton.me/mail/bridge", regions: ["global"], bridge: true },

  // ---- DACH ---------------------------------------------------------------
  // hilfe.web.de/pop-imap/imap/imap-serverdaten.html
  { id: "webde", label: "WEB.DE", host: "imap.web.de", port: 993, smtpHost: "smtp.web.de", smtpPort: 587, domains: ["web.de"], authMode: "password", helpUrl: "https://hilfe.web.de/pop-imap/imap/imap-serverdaten.html", regions: ["dach"] },
  // hilfe.gmx.net/pop-imap/imap/imap-serverdaten.html — gmx.net/de/at/ch ONLY
  { id: "gmx", label: "GMX", host: "imap.gmx.net", port: 993, smtpHost: "mail.gmx.net", smtpPort: 587, domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch"], authMode: "password", helpUrl: "https://hilfe.gmx.net/pop-imap/imap/imap-serverdaten.html", regions: ["dach"] },
  // support.gmx.com/pop-imap/imap/server.html — the INTERNATIONAL gmx.com
  // mailboxes use different hosts than gmx.net (research finding B1).
  { id: "gmxcom", label: "GMX.com (International)", host: "imap.gmx.com", port: 993, smtpHost: "mail.gmx.com", smtpPort: 587, domains: ["gmx.com", "gmx.us", "gmx.co.uk", "gmx.fr", "gmx.es"], authMode: "password", helpUrl: "https://support.gmx.com/pop-imap/imap/server.html", regions: ["global"] },
  // telekom.de/hilfe/apps-dienste/e-mail/posteingang-postausgang-server —
  // needs the separate "Passwort für E-Mail-Programme", NOT the Telekom login.
  { id: "tonline", label: "T-Online", host: "secureimap.t-online.de", port: 993, smtpHost: "securesmtp.t-online.de", smtpPort: 465, domains: ["t-online.de", "magenta.de"], authMode: "mail-password", helpUrl: "https://www.telekom.de/hilfe/apps-dienste/e-mail/posteingang-postausgang-server", regions: ["dach"] },
  // kb.mailbox.org/en/private/e-mail/e-mail-configuration/
  { id: "mailboxorg", label: "mailbox.org", host: "imap.mailbox.org", port: 993, smtpHost: "smtp.mailbox.org", smtpPort: 465, domains: ["mailbox.org"], authMode: "password", helpUrl: "https://kb.mailbox.org/en/private/e-mail/e-mail-configuration/", regions: ["dach"] },
  // posteo.de/en/help (IMAP setup article)
  { id: "posteo", label: "Posteo", host: "posteo.de", port: 993, smtpHost: "posteo.de", smtpPort: 465, domains: ["posteo.de", "posteo.net", "posteo.at", "posteo.ch", "posteo.eu", "posteo.org"], authMode: "password", helpUrl: "https://posteo.de/en/help/how-do-i-set-up-posteo-in-an-email-client-pop3-imap-and-smtp", regions: ["dach"] },
  // strato-hosting.co.uk/faq (mail server article); hosting mailboxes = custom domains
  { id: "strato", label: "Strato", host: "imap.strato.de", port: 993, smtpHost: "smtp.strato.de", smtpPort: 465, domains: [], authMode: "password", helpUrl: "https://www.strato.de/faq/mail/", regions: ["dach"] },
  // ionos.com/help/email/general-topics/settings-for-your-email-programs-imap-pop3/
  { id: "ionos", label: "IONOS", host: "imap.ionos.com", port: 993, smtpHost: "smtp.ionos.com", smtpPort: 587, domains: [], authMode: "password", helpUrl: "https://www.ionos.com/help/email/general-topics/settings-for-your-email-programs-imap-pop3/", regions: ["dach"] },
  // swisscom.ch/de/privatkunden/hilfe/e-mail/einrichten/swisscom-server-information.html
  { id: "bluewin", label: "Bluewin (Swisscom)", host: "imaps.bluewin.ch", port: 993, smtpHost: "smtpauths.bluewin.ch", smtpPort: 465, domains: ["bluewin.ch", "bluemail.ch"], authMode: "password", helpUrl: "https://www.swisscom.ch/de/privatkunden/hilfe/e-mail/einrichten/swisscom-server-information.html", regions: ["dach"] },
  // a1.net/faq/webmail/e-mail-einrichten/a1-e-mail-servereinstellungen
  { id: "a1", label: "A1.net", host: "securemail.a1.net", port: 993, smtpHost: "securemail.a1.net", smtpPort: 587, domains: ["a1.net", "aon.at"], authMode: "password", helpUrl: "https://www.a1.net/faq/webmail/e-mail-einrichten/a1-e-mail-servereinstellungen", regions: ["dach"] },
  // magenta.at/faq (Einrichtungshilfen E-Mail externe Programme)
  { id: "magenta", label: "Magenta.at", host: "mail.mymagenta.at", port: 993, smtpHost: "mail.mymagenta.at", smtpPort: 465, domains: ["mymagenta.at", "chello.at", "inode.at"], authMode: "password", helpUrl: "https://www.magenta.at/faq", regions: ["dach"] },

  // ---- France -------------------------------------------------------------
  // assistance.orange.fr — dedicated app password for external mail apps
  { id: "orange", label: "Orange", host: "imap.orange.fr", port: 993, smtpHost: "smtp.orange.fr", smtpPort: 465, domains: ["orange.fr", "wanadoo.fr"], authMode: "app-password", helpUrl: "https://assistance.orange.fr/ordinateurs-peripheriques/installer-et-utiliser/l-utilisation-du-mail-et-services-associes/mail-orange/parametrer-la-boite-mail", regions: ["fr"] },
  // assistance.free.fr/articles/609
  { id: "free", label: "Free", host: "imap.free.fr", port: 993, smtpHost: "smtp.free.fr", smtpPort: 587, domains: ["free.fr"], authMode: "password", helpUrl: "https://assistance.free.fr/articles/609", regions: ["fr"] },
  // aide.laposte.net (mail client configuration article)
  { id: "laposte", label: "La Poste", host: "imap.laposte.net", port: 993, smtpHost: "smtp.laposte.net", smtpPort: 587, domains: ["laposte.net"], authMode: "password", helpUrl: "https://aide.laposte.net/contents/comment-parametrer-un-logiciel-de-messagerie-pour-envoyer-et-recevoir-mes-courriers-electroniques", regions: ["fr"] },

  // ---- Italy --------------------------------------------------------------
  // aiuto.libero.it — "Password Sicura" app password once 2FA is on
  { id: "libero", label: "Libero", host: "imapmail.libero.it", port: 993, smtpHost: "smtp.libero.it", smtpPort: 465, domains: ["libero.it", "iol.it", "blu.it", "giallo.it", "inwind.it"], authMode: "password", helpUrl: "https://aiuto.libero.it/articolo/mail/configurare-libero-mail-con-client-di-posta-imap-e-smtp/", regions: ["it"] },
  // aiuto.virgilio.it (same TIM infrastructure as Libero)
  { id: "virgilio", label: "Virgilio", host: "in.virgilio.it", port: 993, smtpHost: "out.virgilio.it", smtpPort: 465, domains: ["virgilio.it", "alice.it", "tin.it"], authMode: "password", helpUrl: "https://aiuto.virgilio.it/articolo/mail/configurare-virgilio-mail-con-client-di-posta-imap-e-smtp/", regions: ["it"] },
  // assistenza.tiscali.it/servizi/guida/parametri-mail/
  { id: "tiscali", label: "Tiscali", host: "imap.tiscali.it", port: 993, smtpHost: "smtp.tiscali.it", smtpPort: 465, domains: ["tiscali.it"], authMode: "password", helpUrl: "https://assistenza.tiscali.it/servizi/guida/parametri-mail/", regions: ["it"] },

  // ---- Benelux ------------------------------------------------------------
  // ziggo.nl/klantenservice/e-mail/serverinstellingen (covers legacy domains)
  { id: "ziggo", label: "Ziggo", host: "imap.ziggo.nl", port: 993, smtpHost: "smtp.ziggo.nl", smtpPort: 587, domains: ["ziggo.nl", "home.nl", "quicknet.nl", "casema.nl", "upcmail.nl", "chello.nl"], authMode: "password", helpUrl: "https://www.ziggo.nl/klantenservice/e-mail/serverinstellingen", regions: ["benelux"] },
  // kpn.com/service (mail setup; covers xs4all/planet/telfort)
  { id: "kpn", label: "KPN", host: "imap.kpnmail.nl", port: 993, smtpHost: "smtp.kpnmail.nl", smtpPort: 587, domains: ["kpnmail.nl", "xs4all.nl", "planet.nl", "telfort.nl"], authMode: "password", helpUrl: "https://www.kpn.com/service/ugs/instellen-e-mail-laptop-pc", regions: ["benelux"] },

  // ---- Poland / Czechia ---------------------------------------------------
  // pomoc.wp.pl/jak-skonfigurowac-program-pocztowy — IMAP must be enabled first
  { id: "wp", label: "WP Poczta", host: "imap.wp.pl", port: 993, smtpHost: "smtp.wp.pl", smtpPort: 465, domains: ["wp.pl"], authMode: "password", helpUrl: "https://pomoc.wp.pl/jak-skonfigurowac-program-pocztowy", enableHint: true, regions: ["pl"] },
  // pomoc.poczta.interia.pl — POP3/IMAP channel must be enabled first
  { id: "interia", label: "Interia", host: "poczta.interia.pl", port: 993, smtpHost: "poczta.interia.pl", smtpPort: 465, domains: ["interia.pl", "interia.eu"], authMode: "password", helpUrl: "https://pomoc.poczta.interia.pl/programy-pocztowe/news-parametry-do-konfiguracji-programow-pocztowych,nId,2136275", enableHint: true, regions: ["pl"] },
  // o-seznam.cz/napoveda/email (mail programs article)
  { id: "seznam", label: "Seznam / Email.cz", host: "imap.seznam.cz", port: 993, smtpHost: "smtp.seznam.cz", smtpPort: 465, domains: ["seznam.cz", "email.cz", "post.cz", "spoluzaci.cz"], authMode: "password", helpUrl: "https://o-seznam.cz/napoveda/email/mohlo-by-se-hodit/postovni-programy-a-aplikace/", regions: ["cz"] },

  // ---- North America ------------------------------------------------------
  // xfinity.com/support/articles/third-party-email-access — "Third Party
  // Access Security" must be enabled in the Xfinity mail settings first.
  { id: "xfinity", label: "Comcast / Xfinity", host: "imap.comcast.net", port: 993, smtpHost: "smtp.comcast.net", smtpPort: 587, domains: ["comcast.net", "xfinity.com"], authMode: "password", helpUrl: "https://www.xfinity.com/support/articles/third-party-email-access", enableHint: true, regions: ["na"] },
  // att.com/support/article/email-support/KM1240462 — needs a "Secure Mail Key"
  { id: "att", label: "AT&T Mail", host: "imap.mail.att.net", port: 993, smtpHost: "smtp.mail.att.net", smtpPort: 465, domains: ["att.net", "sbcglobal.net", "bellsouth.net", "currently.com"], authMode: "mail-password", helpUrl: "https://www.att.com/support/article/email-support/KM1240462/", regions: ["na"] },

  // ---- China (authorization code instead of the account password) ---------
  // help.mail.qq.com — 授权码 generated after enabling IMAP/SMTP via SMS check
  { id: "qq", label: "QQ Mail", host: "imap.qq.com", port: 993, smtpHost: "smtp.qq.com", smtpPort: 465, domains: ["qq.com", "foxmail.com"], authMode: "auth-code", helpUrl: "https://service.mail.qq.com/detail/0/75", enableHint: true, regions: ["cn"] },
  // help.mail.163.com — client authorization password, SMS-verified
  { id: "netease163", label: "NetEase 163", host: "imap.163.com", port: 993, smtpHost: "smtp.163.com", smtpPort: 465, domains: ["163.com"], authMode: "auth-code", helpUrl: "https://help.mail.163.com", enableHint: true, regions: ["cn"] },
  { id: "netease126", label: "NetEase 126", host: "imap.126.com", port: 993, smtpHost: "smtp.126.com", smtpPort: 465, domains: ["126.com"], authMode: "auth-code", helpUrl: "https://help.mail.163.com", enableHint: true, regions: ["cn"] },
  // help.sina.com.cn — 16-char client authorization code
  { id: "sina", label: "Sina Mail", host: "imap.sina.com", port: 993, smtpHost: "smtp.sina.com", smtpPort: 465, domains: ["sina.com", "sina.cn"], authMode: "auth-code", helpUrl: "https://help.sina.com.cn/comquestiondetail/view/1566/", regions: ["cn"] },
  // help.aliyun.com/zh/document_detail/465307.html (personal tier, existing users)
  { id: "aliyun", label: "Aliyun Mail", host: "imap.aliyun.com", port: 993, smtpHost: "smtp.aliyun.com", smtpPort: 465, domains: ["aliyun.com"], authMode: "password", helpUrl: "https://help.aliyun.com/zh/document_detail/465307.html", regions: ["cn"] },

  // ---- Korea / Japan ------------------------------------------------------
  // Naver: IMAP must be enabled; 2FA + application password mandatory since 2025.
  { id: "naver", label: "Naver", host: "imap.naver.com", port: 993, smtpHost: "smtp.naver.com", smtpPort: 465, domains: ["naver.com"], authMode: "app-password", helpUrl: "https://mail.naver.com", enableHint: true, regions: ["kr"] },
  // cs.daum.net/faq/266/12145.html — IMAP enable + app password since 2025.
  { id: "daum", label: "Daum / Kakao Mail", host: "imap.daum.net", port: 993, smtpHost: "smtp.daum.net", smtpPort: 465, domains: ["daum.net", "hanmail.net"], authMode: "app-password", helpUrl: "https://cs.daum.net/faq/266/12145.html", enableHint: true, regions: ["kr"] },
  // support.yahoo-net.jp/PccMail/s/article/H000014864 — explicit IMAP opt-in
  { id: "yahoojp", label: "Yahoo! JAPAN", host: "imap.mail.yahoo.co.jp", port: 993, smtpHost: "smtp.mail.yahoo.co.jp", smtpPort: 465, domains: ["yahoo.co.jp", "ymail.ne.jp"], authMode: "password", helpUrl: "https://support.yahoo-net.jp/PccMail/s/article/H000014864", enableHint: true, regions: ["jp"] },
  // support.ntt.com (OCN mail server settings)
  { id: "ocn", label: "OCN", host: "imap.ocn.ne.jp", port: 993, smtpHost: "smtp.ocn.ne.jp", smtpPort: 465, domains: ["ocn.ne.jp"], authMode: "password", helpUrl: "https://support.ntt.com/ocn-business/support/detail/pid21000001uk9/", regions: ["jp"] },
  // support.biglobe.ne.jp/settei/mailer/imap.html
  { id: "biglobe", label: "BIGLOBE", host: "mail.biglobe.ne.jp", port: 993, smtpHost: "mail.biglobe.ne.jp", smtpPort: 465, domains: ["biglobe.ne.jp"], authMode: "password", helpUrl: "https://support.biglobe.ne.jp/settei/mailer/imap.html", regions: ["jp"] },
  // support.so-net.ne.jp — the IMAP service add-on must be requested first
  { id: "sonet", label: "So-net", host: "imap.so-net.ne.jp", port: 993, smtpHost: "mail.so-net.ne.jp", smtpPort: 587, domains: ["so-net.ne.jp"], authMode: "password", helpUrl: "https://support.so-net.ne.jp/fa/faq/web/knowledge1804.html", enableHint: true, regions: ["jp"] },
  // docomo.ne.jp/service/spmode/function/mail/usage — separate IMAP password
  { id: "docomo", label: "docomo mail", host: "imap.spmode.ne.jp", port: 993, smtpHost: "smtp.spmode.ne.jp", smtpPort: 465, domains: ["docomo.ne.jp"], authMode: "mail-password", helpUrl: "https://www.docomo.ne.jp/service/spmode/function/mail/usage/", enableHint: true, regions: ["jp"] },

  // ---- Russia -------------------------------------------------------------
  // yandex.com/support/yandex-360/customers/mail/en/mail-clients/others
  { id: "yandex", label: "Yandex Mail", host: "imap.yandex.com", port: 993, smtpHost: "smtp.yandex.com", smtpPort: 465, domains: ["yandex.ru", "yandex.com", "ya.ru", "yandex.kz", "yandex.by"], authMode: "app-password", helpUrl: "https://yandex.com/support/yandex-360/customers/mail/en/mail-clients/others", regions: ["ru", "global"] },
  // help.mail.ru/mail/mailer — app password mandatory since 2022
  { id: "mailru", label: "Mail.ru", host: "imap.mail.ru", port: 993, smtpHost: "smtp.mail.ru", smtpPort: 465, domains: ["mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru"], authMode: "app-password", helpUrl: "https://help.mail.ru/mail/mailer/popsmtp", regions: ["ru"] },

  // ---- Switzerland (hosting) / Australia ----------------------------------
  // infomaniak.com/en/support/faq/2427 (mail sync); free ik.me addresses
  { id: "infomaniak", label: "Infomaniak", host: "mail.infomaniak.com", port: 993, smtpHost: "mail.infomaniak.com", smtpPort: 465, domains: ["ik.me", "ikmail.com", "etik.com"], authMode: "password", helpUrl: "https://www.infomaniak.com/en/support/faq/2427", regions: ["dach", "fr"] },
  // telstra.com.au/support/email/imap-pop-smtp-mail-server-settings
  { id: "bigpond", label: "Telstra / Bigpond", host: "imap.telstra.com", port: 993, smtpHost: "smtp.telstra.com", smtpPort: 465, domains: ["bigpond.com", "bigpond.net.au", "telstra.com"], authMode: "password", helpUrl: "https://www.telstra.com.au/support/email/imap-pop-smtp-mail-server-settings", regions: ["au"] },
];

/** Preset for a preset id, or null. */
export function presetById(id: string): MailPreset | null {
  return MAIL_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Best-guess preset from an email address' domain, or null for an unknown
 * domain. Exact-domain matches win over suffix matches so gmx.com maps to the
 * gmxcom preset even though gmx.net lists similar-looking domains (B1).
 */
export function presetForEmail(email: string): MailPreset | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!domain) return null;
  const exact = MAIL_PRESETS.find((p) => p.domains.some((d) => domain === d));
  if (exact) return exact;
  return MAIL_PRESETS.find((p) => p.domains.some((d) => domain.endsWith("." + d))) ?? null;
}

// ---------------------------------------------------------------------------
// Suite providers (wizard tiles beyond the built-in mechanics)
// ---------------------------------------------------------------------------

/**
 * An app-password suite: ONE credential (email/user + app password) connects
 * every checked service through fixed, catalog-known endpoints — the
 * generalized Nextcloud one-form, minus the server field. `webdavProviders`
 * describes tiles whose only service is a preset WebDAV file server.
 */
export interface SuiteProviderDef {
  family: CloudProviderFamily;
  services: readonly CloudServiceId[];
  authMode: ProviderAuthMode;
  helpUrl: string;
  /** Endpoints prefilled into the (editable) advanced section. */
  endpoints: {
    imapHost?: string;
    imapPort?: number;
    smtpHost?: string;
    smtpPort?: number;
    caldavUrl?: string;
    webdavUrl?: string;
  };
  /** Mail preset id reused for the mail service (keeps hosts single-sourced). */
  mailPresetId?: string;
}

export const SUITE_PROVIDERS: SuiteProviderDef[] = [
  // support.apple.com/102654 (app-specific passwords). iCloud Drive has NO
  // third-party API — files are impossible with Apple, the tile says so.
  {
    family: "apple",
    services: ["calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://support.apple.com/102654",
    endpoints: { imapHost: "imap.mail.me.com", imapPort: 993, smtpHost: "smtp.mail.me.com", smtpPort: 587, caldavUrl: "https://caldav.icloud.com" },
    mailPresetId: "icloud",
  },
  // help.yahoo.com/kb/SLN15241 (app password) + /kb/SLN4707 (CalDAV; Yahoo's
  // own docs flag CalDAV as unreliable — documented in the user guide).
  {
    family: "yahoo",
    services: ["calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://help.yahoo.com/kb/SLN15241.html",
    endpoints: { imapHost: "imap.mail.yahoo.com", imapPort: 993, smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, caldavUrl: "https://caldav.calendar.yahoo.com" },
    mailPresetId: "yahoo",
  },
  // help.aol.com (app passwords + calendar sync articles)
  {
    family: "aol",
    services: ["calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://help.aol.com/articles/Create-and-manage-app-password",
    endpoints: { imapHost: "imap.aol.com", imapPort: 993, smtpHost: "smtp.aol.com", smtpPort: 465, caldavUrl: "https://caldav.aol.com" },
    mailPresetId: "aol",
  },
  // yandex.ru/dev/disk/webdav + yandex support (mail/caldav) — full suite.
  {
    family: "yandex",
    services: ["files", "calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://yandex.com/support/id/authorization/app-passwords.html",
    endpoints: { imapHost: "imap.yandex.com", imapPort: 993, smtpHost: "smtp.yandex.com", smtpPort: 465, caldavUrl: "https://caldav.yandex.ru", webdavUrl: "https://webdav.yandex.ru" },
    mailPresetId: "yandex",
  },
  // help.mail.ru/cloud/desktop/webdav + calendar/mailer articles — full suite.
  {
    family: "mailru",
    services: ["files", "calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://help.mail.ru/mail/mailer/popsmtp",
    endpoints: { imapHost: "imap.mail.ru", imapPort: 993, smtpHost: "smtp.mail.ru", smtpPort: 465, caldavUrl: "https://calendar.mail.ru", webdavUrl: "https://webdav.cloud.mail.ru" },
    mailPresetId: "mailru",
  },
  // zoho.com/mail/help/imap-access.html + /calendar/help/setup-caldav-sync.html
  {
    family: "zoho",
    services: ["calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://www.zoho.com/mail/help/imap-access.html",
    endpoints: { imapHost: "imap.zoho.com", imapPort: 993, smtpHost: "smtp.zoho.com", smtpPort: 465, caldavUrl: "https://calendar.zoho.com" },
    mailPresetId: "zoho",
  },
  // fastmail.help: servers 1500000278342, WebDAV files 1500000277882,
  // CalDAV 360058752754 — the full three-service suite over ONE app password.
  {
    family: "fastmail",
    services: ["files", "calendar", "mail"],
    authMode: "app-password",
    helpUrl: "https://www.fastmail.help/hc/en-us/articles/360058752854",
    endpoints: { imapHost: "imap.fastmail.com", imapPort: 993, smtpHost: "smtp.fastmail.com", smtpPort: 465, caldavUrl: "https://caldav.fastmail.com" , webdavUrl: "https://webdav.fastmail.com" },
    mailPresetId: "fastmail",
  },
  // kb.mailbox.org: e-mail-configuration, caldav-cardav article, drive (WebDAV)
  {
    family: "mailboxorg",
    services: ["files", "calendar", "mail"],
    authMode: "password",
    helpUrl: "https://kb.mailbox.org/en/private/e-mail/e-mail-configuration/",
    endpoints: { imapHost: "imap.mailbox.org", imapPort: 993, smtpHost: "smtp.mailbox.org", smtpPort: 465, caldavUrl: "https://dav.mailbox.org", webdavUrl: "https://dav.mailbox.org/servlet/webdav.infostore" },
    mailPresetId: "mailboxorg",
  },
  // koofr.eu/help/koofr_with_webdav — app password required, fixed URL.
  {
    family: "koofr",
    services: ["files"],
    authMode: "app-password",
    helpUrl: "https://koofr.eu/help/koofr_with_webdav/how-do-i-connect-a-service-to-koofr-through-webdav/",
    endpoints: { webdavUrl: "https://app.koofr.net/dav/Koofr" },
  },
  // pCloud WebDAV endpoints (US/EU); documented in pCloud support + rclone docs.
  {
    family: "pcloud",
    services: ["files"],
    authMode: "password",
    helpUrl: "https://www.pcloud.com/help",
    endpoints: { webdavUrl: "https://webdav.pcloud.com" },
  },
];

/** Suite definition for a family, or null. */
export function suiteProvider(family: CloudProviderFamily): SuiteProviderDef | null {
  return SUITE_PROVIDERS.find((s) => s.family === family) ?? null;
}

// ---------------------------------------------------------------------------
// Family detection for migrated/loose subsystem entries
// ---------------------------------------------------------------------------

function hostOf(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const CALDAV_HOST_FAMILIES: Record<string, CloudProviderFamily> = {
  "caldav.icloud.com": "apple",
  "caldav.calendar.yahoo.com": "yahoo",
  "caldav.aol.com": "aol",
  "caldav.yandex.ru": "yandex",
  "calendar.mail.ru": "mailru",
  "calendar.zoho.com": "zoho",
  "caldav.fastmail.com": "fastmail",
  "dav.mailbox.org": "mailboxorg",
};

const WEBDAV_HOST_FAMILIES: Record<string, CloudProviderFamily> = {
  "webdav.yandex.ru": "yandex",
  "webdav.cloud.mail.ru": "mailru",
  "webdav.fastmail.com": "fastmail",
  "dav.mailbox.org": "mailboxorg",
  "app.koofr.net": "koofr",
  "webdav.pcloud.com": "pcloud",
  "ewebdav.pcloud.com": "pcloud",
};

/** Catalog family for a CalDAV server URL (migrated PIM accounts), or null. */
export function familyOfCalDavUrl(url: string): CloudProviderFamily | null {
  const host = hostOf(url);
  return host ? (CALDAV_HOST_FAMILIES[host] ?? null) : null;
}

/** Catalog family for a WebDAV file-server URL (sync slots), or null. */
export function familyOfWebDavUrl(url: string): CloudProviderFamily | null {
  const host = hostOf(url);
  return host ? (WEBDAV_HOST_FAMILIES[host] ?? null) : null;
}

/** Catalog family for an IMAP host (loose mail accounts), or null. */
export function familyOfImapHost(host: string): CloudProviderFamily | null {
  const h = host.trim().toLowerCase();
  if (!h) return null;
  const preset = MAIL_PRESETS.find((p) => p.host === h);
  if (!preset) return null;
  const suite = SUITE_PROVIDERS.find((s) => s.mailPresetId === preset.id);
  return suite ? suite.family : null;
}
