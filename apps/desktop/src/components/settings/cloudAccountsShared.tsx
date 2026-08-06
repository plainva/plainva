import React from "react";
import { Folder, CalendarDays, Mail } from "lucide-react";
import { ICON, accountMonogram, cx, familyLabel, serviceLabel, type CloudAccountRecord, type CloudProviderFamily, type CloudServiceId } from "@plainva/ui";

/** Shared bits of the Cloud-Konten surfaces (list, wizard, detail). */

export const SERVICE_ICONS: Record<CloudServiceId, React.ComponentType<{ size?: number | string }>> = {
  files: Folder,
  calendar: CalendarDays,
  mail: Mail,
};

/** The names and the monogram table live in @plainva/ui so both shells read
 * the same vocabulary (H9); the phone had none until the mobile rework. */
export { accountMonogram, familyLabel, serviceLabel };

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
