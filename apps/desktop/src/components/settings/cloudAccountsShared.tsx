import React from "react";
import { Folder, CalendarDays, Mail } from "lucide-react";
import { ICON, cx, type CloudAccountRecord, type CloudProviderFamily, type CloudServiceId } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/** Shared bits of the Cloud-Konten surfaces (list, wizard, detail). */

export const SERVICE_ICONS: Record<CloudServiceId, React.ComponentType<{ size?: number | string }>> = {
  files: Folder,
  calendar: CalendarDays,
  mail: Mail,
};

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

const MONOGRAM: Record<CloudProviderFamily, string> = {
  microsoft: "M",
  google: "G",
  webdav: "W",
  dropbox: "D",
  s3: "S3",
  imap: "@",
  apple: "A",
  yahoo: "Y!",
  aol: "AOL",
  yandex: "Я",
  mailru: "MR",
  zoho: "Z",
  fastmail: "F",
  mailboxorg: "MB",
  koofr: "K",
  pcloud: "P",
};

export function accountMonogram(family: CloudProviderFamily, flavor?: "nextcloud"): string {
  return family === "webdav" && flavor === "nextcloud" ? "N" : MONOGRAM[family];
}

export const AccountMark: React.FC<{ family: CloudProviderFamily; flavor?: "nextcloud"; small?: boolean }> = ({
  family,
  flavor,
  small,
}) => (
  <span className={cx("pv-acct-mark", `pv-acct-mark--${family}`, small && "pv-acct-mark--sm")} aria-hidden>
    {accountMonogram(family, flavor)}
  </span>
);

export const ServiceChip: React.FC<{ service: CloudServiceId; off?: boolean }> = ({ service, off }) => {
  const Icon = SERVICE_ICONS[service];
  return (
    <span className={cx("pv-svcchip", off && "pv-svcchip--off")}>
      <Icon size={ICON.meta} />
      {serviceLabel(service)}
    </span>
  );
};

/** Display line of an account: identity when known, family fallback otherwise. */
export function accountTitle(record: CloudAccountRecord): { name: string; identity: string | null } {
  const name = familyLabel(record.family, record.flavor);
  const identity = record.label.trim() ? record.label : null;
  return { name, identity };
}
