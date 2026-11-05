import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  { settings: { next: { rootDir: "apps/web/" } } },
  { files: ["apps/web/app/**/*.tsx"], rules: { "react-hooks/purity": "off" } },
  {
    files: ["apps/web/components/data-table.tsx"],
    rules: { "react-hooks/incompatible-library": "off" },
  },
  globalIgnores(["**/.next/**", "packages/db/generated/**", "data/**"]),
]);
