import type { CapacitorConfig } from "@capacitor/cli";

// appId is free to change until the FIRST store upload (M5) — after that it
// is permanent on both stores.
const config: CapacitorConfig = {
  appId: "com.plainva.app",
  appName: "Plainva",
  webDir: "dist",
};

export default config;
