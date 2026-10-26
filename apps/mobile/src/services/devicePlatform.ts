import { Capacitor } from "@capacitor/core";
import type { AccessPlatform } from "@plainva/ui";

/**
 * The phone's platform for the access rules (`oauthAccess.ts`); the web build
 * signs in like an iPhone, through the browser. A module of its own so that the
 * sign-in toasts can ask it without importing the whole sign-in service.
 */
export function devicePlatform(): AccessPlatform {
  return Capacitor.getPlatform() === "android" ? "android" : "ios";
}
