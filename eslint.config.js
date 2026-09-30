import js from '@eslint/js'
import babelParser from '@babel/eslint-parser'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

// NOTE: `typescript-eslint` cannot be used here — it hard-errors on TypeScript 7
// (peer range `>=4.8.4 <6.1.0`, see typescript-eslint#10940). This project is on
// typescript@7, so linting goes through @babel/eslint-parser instead. That parses
// TS/TSX fine but gives no type-aware rules; `tsc --noEmit` (npm run build) covers types.
export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          presets: [['@babel/preset-typescript', { onlyRemoveTypeImports: false }]],
          plugins: ['@babel/plugin-syntax-jsx'],
        },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Both assume plain JS and misread TS type syntax; tsc is the real guard.
      'no-undef': 'off',
      'no-unused-vars': 'off',
    },
  },
]
