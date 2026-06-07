import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      prettier
    ],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      // The daemon handles dynamic Nostr/JSON payloads; explicit `any` is sometimes
      // pragmatic. Surface it as a warning rather than failing the build.
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    // Test/mocks use vitest globals and looser typing.
    files: ['**/*.test.ts', '**/__tests__/**', 'src/daemon/testing/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    ignores: ['dist', 'node_modules', 'prisma', '*.config.*', 'scripts']
  }
);
