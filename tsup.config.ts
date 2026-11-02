import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", next: "src/next.ts", express: "src/express.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "node20",
  sourcemap: true,
});
