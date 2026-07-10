import type { CapacitorConfig } from "@capacitor/cli";

// appId is free to change until the FIRST store upload (M5) — after that it
// is permanent on both stores.
const config: CapacitorConfig = {
  appId: "com.plainva.app",
  appName: "Plainva",
  webDir: "dist",
  plugins: {
    // Route window.fetch through the native HTTP stack (M3): the shared sync
    // targets receive plain fetch and run CORS-free against any WebDAV/cloud
    // endpoint. On the plain web dev server fetch stays the browser's own.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
