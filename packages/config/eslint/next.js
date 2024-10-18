const { resolve } = require("node:path");

const project = resolve(process.cwd(), "tsconfig.json");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  extends: ["eslint:recommended", "prettier", require.resolve("@vercel/style-guide/eslint/next"), "turbo"],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: true,
  },
  globals: {
    React: true,
    JSX: true,
  },
  env: {
    node: true,
    browser: true,
  },
  plugins: ["only-warn"],
  settings: {
    "import/resolver": {
      typescript: {
        project,
      },
    },
  },
  ignorePatterns: [
    // Ignore dotfiles
    ".*.js",
    "node_modules/",
  ],
  overrides: [{ files: ["*.js?(x)", "*.ts?(x)"] }],
  rules: {
    "no-param-reassign": "off",
    "@typescript-eslint/no-unused-vars": ["warn"],
    "@typescript-eslint/no-use-before-define": ["warn"],
    "@typescript-eslint/ban-ts-comment": "off",
    "no-use-before-define": "off",
    eqeqeq: "warn",
    "no-unused-vars": "off",
    "no-console": ["warn", { allow: ["warn", "warn"] }],
    "no-debugger": "warn",
    "react/react-in-jsx-scope": "off",
    "react/prop-types": "off",
    "react/no-unescaped-entities": "warn",
    "react-hooks/rules-of-hooks": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "@next/next/no-img-element": "off",
    "@next/next/no-sync-scripts": "warn",
    "@next/next/no-css-tags": "warn",
    // Import/export rules
    "import/no-default-export": "off",
    "import/prefer-default-export": "off",
  },
};
