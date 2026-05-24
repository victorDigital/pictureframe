import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  base: "/shell/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: "index.html",
    },
  },
  server: {
    port: 5180,
  },
});
