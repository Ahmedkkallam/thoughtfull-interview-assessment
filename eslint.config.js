import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "apps/api/migrations/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Add a block here for apps/web (browser globals, React rules) when it exists.
);
