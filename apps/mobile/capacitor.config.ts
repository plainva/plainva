import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";

// appId is free to change until the FIRST store upload (M5) — after that it
// is permanent on both stores.
const config: CapacitorConfig = {
  appId: "com.plainva.app",
  appName: "Plainva",
  webDir: "dist",
  // NOTE: CapacitorHttp's fetch patch is intentionally NOT enabled — it sits
  // on HttpURLConnection, which rejects WebDAV methods (PROPFIND & friends).
  // Sync uses the local OkHttp plugin instead (adapters/webdavHttp.ts).
  plugins: {
    // iOS shows the keyboard as an OVERLAY by default, hiding the fixed
    // editor toolbar behind it; "native" shrinks the WebView frame like
    // Android's adjustResize, so bottom-fixed UI rises above the keyboard.
    Keyboard: {
      resize: KeyboardResize.Native,
    },
    // iOS: the databases live outside Documents, which the app shares with
    // the Files app (release list A11). Existing ones are moved at the first
    // start (src/adapters/iosDatabaseFolder.ts). Android keeps them in the
    // app's private databases folder and ignores this.
    CapacitorSQLite: {
      iosDatabaseLocation: "Library/CapacitorDatabase",
    },
  },
};

export default config;
