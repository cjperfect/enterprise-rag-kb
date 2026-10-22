import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettierConfig from "eslint-config-prettier";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * 参与类型感知（type-checked）检查的源码范围。
 * 这里的 glob 必须能被对应包的 tsconfig `include` 覆盖，否则 ESLint 会报找不到类型信息。
 */
const TYPE_CHECKED_FILES = ["apps/backend/src/**/*.ts", "apps/frontend/**/*.{ts,tsx}", "packages/*/src/**/*.ts"];

/**
 * 游离在各包 tsconfig 之外的独立配置文件（tsup / prisma 等）。
 * 它们没有类型信息可用，只做非类型感知的基础检查。
 */
const STANDALONE_CONFIG_FILES = ["**/*.config.{ts,mts,cts,mjs,js}", "**/prisma.config.ts"];

export default tseslint.config(
  {
    ignores: ["**/.venv/**", "**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**", "**/out/**", "**/coverage/**", "**/next-env.d.ts", "**/*.tsbuildinfo"],
  },

  // ---- 全局基底规则 ----------------------------------------------------------
  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ["**/*.cjs", "**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  // ---- 类型感知规则：仅覆盖源码 ----------------------------------------------
  {
    files: TYPE_CHECKED_FILES,
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // 由 typescript-eslint 自动为每个文件寻找最近的 tsconfig
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 历史欠账：仓库里存在大量第三方库（assistant-ui / marked / turndown / codemirror 等）
      // 泄漏出的 any，一次性收敛成本过高。这里降级为 warn 保留可见性，
      // 让 no-floating-promises、react-hooks/rules-of-hooks 这类高信号规则仍能作为 error 拦截。
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",
    },
  },

  // ---- 游离配置文件 -----------------------------------------------------------
  {
    files: STANDALONE_CONFIG_FILES,
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- apps/backend：NestJS ---------------------------------------------------
  {
    files: ["apps/backend/src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // NestJS 的 Module / Service 普遍是「只有装饰器的空类」，这条规则在这里没有意义
      "@typescript-eslint/no-extraneous-class": "off",
      // 构造函数注入依赖时常写成空实现
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // ---- apps/frontend：React 19 + Next.js --------------------------------------
  {
    files: ["apps/frontend/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks,
      "@next/next": nextPlugin,
    },
    settings: {
      react: { version: "detect" },
      next: { rootDir: "apps/frontend" },
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactPlugin.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      // 项目用 TypeScript，propTypes 不适用
      "react/prop-types": "off",
      // 本项目使用 App Router，没有 pages 目录，该规则不适用
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  // ---- packages/ai-engine ----------------------------------------------------
  {
    files: ["packages/ai-engine/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- packages/shared -------------------------------------------------------
  {
    files: ["packages/shared/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ---- 关闭所有与 Prettier 冲突的格式规则（必须放在最后）--------------------------
  prettierConfig,
);
