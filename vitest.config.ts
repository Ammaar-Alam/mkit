import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __MKIT_UI_CSS__: JSON.stringify(
      readFileSync(new URL("./src/content/ui.css", import.meta.url), "utf8"),
    ),
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
