import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        vnc: resolve(__dirname, "vnc.html"),
      },
    },
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  server: {
    port: 5181,
    proxy: {
      "/api/events": { target: "ws://localhost:8080", ws: true },
      "/api/terminal": { target: "ws://localhost:8080", ws: true },
      "/vnc/ws": { target: "ws://localhost:8080", ws: true },
      "/api": "http://localhost:8080",
      "/ws": { target: "ws://localhost:8080", ws: true },
      "/healthz": "http://localhost:8080",
    },
  },
});
