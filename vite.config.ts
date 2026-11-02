import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves this project site under /<repo>/. Production builds use
// that base by default; dev server uses /. VITE_BASE_PATH overrides either.
const PAGES_BASE = "/web001-home-services-demo/";

function normalizeBase(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const override = process.env.VITE_BASE_PATH ?? env.VITE_BASE_PATH;
  return {
    base: normalizeBase(override || (command === "build" ? PAGES_BASE : "/")),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  };
});
