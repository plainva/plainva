import i18n from "../i18n";
import type { CloudProviderFamily, CloudServiceId } from "./cloudAccounts";

/**
 * The NAMES of the cloud-account vocabulary — a provider family, a service.
 *
 * Separate from `cloudAccounts.ts` on purpose: that module is pure logic and
 * must stay importable without pulling the i18n singleton along. Separate from
 * the desktop shell on equally good purpose: it used to live there, so the
 * phone had no way to say "Microsoft" and printed the SERVICE under every
 * account instead ("Kalender", "E-Mail") — the same shape of gap that this
 * whole round is about (mobile rework, N4.1).
 */

export function serviceLabel(service: CloudServiceId): string {
  if (service === "files") return i18n.t("cloudAccounts.serviceFiles");
  if (service === "calendar") return i18n.t("cloudAccounts.serviceCalendar");
  return i18n.t("cloudAccounts.serviceMail");
}

export function familyLabel(family: CloudProviderFamily, flavor?: "nextcloud"): string {
  if (family === "webdav" && flavor === "nextcloud") return i18n.t("cloudAccounts.familyNextcloud");
  switch (family) {
    case "microsoft":
      return i18n.t("cloudAccounts.familyMicrosoft");
    case "google":
      return i18n.t("cloudAccounts.familyGoogle");
    case "webdav":
      return i18n.t("cloudAccounts.familyWebdav");
    case "dropbox":
      return i18n.t("cloudAccounts.familyDropbox");
    case "s3":
      return i18n.t("cloudAccounts.familyS3");
    case "apple":
      return i18n.t("cloudAccounts.familyApple");
    case "yahoo":
      return i18n.t("cloudAccounts.familyYahoo");
    case "aol":
      return i18n.t("cloudAccounts.familyAol");
    case "yandex":
      return i18n.t("cloudAccounts.familyYandex");
    case "mailru":
      return i18n.t("cloudAccounts.familyMailru");
    case "zoho":
      return i18n.t("cloudAccounts.familyZoho");
    case "fastmail":
      return i18n.t("cloudAccounts.familyFastmail");
    case "mailboxorg":
      return i18n.t("cloudAccounts.familyMailboxorg");
    case "koofr":
      return i18n.t("cloudAccounts.familyKoofr");
    case "pcloud":
      return i18n.t("cloudAccounts.familyPcloud");
    default:
      return i18n.t("cloudAccounts.familyImap");
  }
}
