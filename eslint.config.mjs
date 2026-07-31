import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules — production strictness
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "@typescript-eslint/ban-ts-comment": ["warn", { "ts-ignore": "allow-with-description", "ts-expect-error": "allow-with-description" }],

    // React rules — safety-critical
    "react-hooks/exhaustive-deps": "warn",
    "react/no-unescaped-entities": "off", // many false positives for apostrophes

    // General JavaScript rules — production safety
    "prefer-const": "warn",
    "no-unused-vars": "off", // TS version handles this
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-debugger": "error",
    "no-unreachable": "error",
    "no-fallthrough": "warn",
    "no-redeclare": "off", // TS handles this
    "no-undef": "off", // TS handles this
    "no-useless-escape": "warn",
    "no-irregular-whitespace": "warn",
    "no-case-declarations": "warn",
    "no-empty": ["warn", { allowEmptyCatch: true }],

    // Relaxed rules (non-critical)
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",
    "react-hooks/purity": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",
    "@next/next/no-img-element": "warn",
    "@next/next/no-html-link-for-pages": "off",
    "no-mixed-spaces-and-tabs": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills/**", "rain-v6-extract/**", ".archive/**", "mini-services/**"]
}];

export default eslintConfig;
