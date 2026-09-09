import type { CloudAccountRecord, CloudServiceId } from "./cloudAccounts";

export function passwordServicesOf(record: CloudAccountRecord): CloudServiceId[] {
  const services: CloudServiceId[] = [];
  if (record.services.files?.provider === "webdav") services.push("files");
  if (record.services.calendar && record.family !== "google" && record.family !== "microsoft" && record.family !== "device") services.push("calendar");
  if (record.services.mail && record.family !== "microsoft") services.push("mail");
  return services;
}
