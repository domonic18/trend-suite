// ESLint 扁平配置（仓级单配置，pnpm lint 从根跑；与 aitech-hub 家族同款约定：
// typescript-eslint recommended + 下划线前缀豁免未用变量）。
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**", // tsc 产物，非 lint 对象
      "**/coverage/**",
      "docs/**", // 需求/架构文档与 e2e 记录 HTML，非 lint 对象
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // 下划线前缀 = 有意不用（mock 桩签名/解构占位），家族约定入机器守
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
);
