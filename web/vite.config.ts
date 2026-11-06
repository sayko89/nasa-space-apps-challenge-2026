import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// BASE_PATH: "/" locally, "/<repo>/" on GitHub Pages, "./" for the offline package.
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  // The planner worker uses dynamic import, so it must be an ES module.
  worker: { format: "es" },
  base: basePath,
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // three.js and react-three are large and rarely change: keep them in their own
        // chunks so the app code stays small and the browser can cache the libraries.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/three/")) return "three";
          if (id.includes("@react-three") || id.includes("three-stdlib") || id.includes("camera-controls")) return "react-three";
          if (id.includes("/react-dom/") || id.includes("/react/") || id.includes("/scheduler/")) return "react";
          return "vendor";
        },
      },
    },
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173, open: true },
});
