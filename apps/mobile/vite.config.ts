import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Port 1430 on purpose: the desktop dev server owns 1420 and both run in
// parallel during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1430,
    strictPort: true,
  },
});
