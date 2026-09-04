import type { DevicePimAuthorization } from "../../platform/devicePim";

/** The i18n key that names one permission state of the device account. */
export function devicePermissionKey(state: DevicePimAuthorization): string {
  switch (state) {
    case "fullAccess": return "pim.devicePermissionGranted";
    case "denied": return "pim.devicePermissionDenied";
    case "restricted": return "pim.devicePermissionRestricted";
    case "writeOnly": return "pim.devicePermissionWriteOnly";
    case "unsupported": return "pim.deviceNoRemindersAndroid";
    default: return "pim.devicePermissionNotDetermined";
  }
}
