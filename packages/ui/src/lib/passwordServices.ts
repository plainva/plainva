import type { CloudAccountRecord, CloudServiceId } from "./cloudAccounts";

export function passwordServicesOf(record: CloudAccountRecord): CloudServiceId[] {
  const services: CloudServiceId[] = [];
  // S3's secret key is its password (plan "Verbinden", V2: one way to sign
  // in again after "Sign out on this device", for every provider).
  if (record.services.files?.provider === "webdav" || record.services.files?.provider === "s3") services.push("files");
  if (record.services.calendar && record.family !== "google" && record.family !== "microsoft" && record.family !== "device") services.push("calendar");
  if (record.services.mail && record.family !== "microsoft") services.push("mail");
  return services;
}
