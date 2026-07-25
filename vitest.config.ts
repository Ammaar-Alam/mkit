import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const uiCssPath = fileURLToPath(new URL("./src/content/ui.css", import.meta.url));

export default defineConfig({
  define: {
    __MKIT_UI_CSS__: JSON.stringify(existsSync(uiCssPath) ? readFileSync(uiCssPath, "utf8") : ""),
  },
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html"],
    },
    environment: "jsdom",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
  },
});
