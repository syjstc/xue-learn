import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist/**",
    "libs/contracts/src/generated/**",
    "src/shared/api/generated/**",
    "apps/**/dist/**",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@cognilearn/server", "@cognilearn/server/*"],
              message:
                "Frontend must not import server code. Use @/shared/api/generated or @/shared/i18n.",
            },
          ],
        },
      ],
    },
  },
]);
