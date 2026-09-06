// Lint for correctness, not style: the code's dense one-line style is deliberate, and no formatter is imposed.
// Type-aware rules run on package sources; tests, tools and configs get the plain rules.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const unused = ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "site/dist/**", ".orrery-inspect/**", "tools/packs/cache/**", "packages/core/packs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": unused,
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  { files: ["**/*.test.ts", "**/test/**/*.ts"], rules: { "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-unused-expressions": "off" } },
  { files: ["**/*.mjs", "**/*.js"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
);
