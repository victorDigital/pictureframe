import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "_app",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      input: resolve(__dirname, "src/main.tsx"),
      output: {
        entryFileNames: "app.js",
        assetFileNames: (asset) => (asset.name?.endsWith(".css") ? "style.css" : "assets/[name][extname]"),
      },
    },
  },
});
