import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const hostRestricted = [
  {
    group: ['@tauri-apps/*'],
    message: 'Host APIs belong behind src/platform or infrastructure adapters.',
  },
  {
    group: ['googleapis', '@googleapis/*', 'google-auth-library'],
    message: 'Provider SDKs must not reach the UI.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'coverage',
      'screenshots',
      'test-results',
      'playwright-report',
      'src-tauri',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Feature code and the domain layer must stay host/provider agnostic.
    files: ['src/features/**', 'src/domain/**', 'src/app/**', 'src/components/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: hostRestricted }] },
  },
  {
    // Features depend on the MailService contract, never on a concrete provider.
    files: ['src/features/**', 'src/components/**'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...hostRestricted,
            {
              group: ['@/infrastructure/*', '**/infrastructure/*'],
              message: 'Use MailService via context.',
            },
          ],
        },
      ],
    },
  },
  { files: ['*.config.{js,ts}', 'scripts/**'], languageOptions: { globals: { ...globals.node } } },
);
