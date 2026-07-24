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
  },
};

export default config;
