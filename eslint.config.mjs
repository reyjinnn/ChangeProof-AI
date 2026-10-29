import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * ESLint configuration for the ChangeProof host package.
 *
 * Type-aware rules apply only to TypeScript product source and tests. JavaScript
 * configuration files are linted with the base recommended rules, without
 * asking the TypeScript project service to load them as project files.
 * Boundary enforcement proper lives in `.dependency-cruiser.cjs`.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'runs/**', 'fixtures/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A verdict that depends on how a value happened to be typed is a false-assurance bug.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',

      // `as` and `!` bypass schema validation at a boundary. Use zod at the edge
      // and keep the narrowing explicit instead.
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // A policy function that logs, reads a clock, or hits the network is not pure.
      'no-console': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Deep module imports are visible in the specifier only when the
              // path spells out the module directory. The relative form
              // (`../policy/precedence.js`) is caught structurally by
              // dependency-cruiser, which resolves the real target.
              group: ['**/modules/*/**', '!**/modules/*/index.js'],
              message:
                'Import a module through its public index only (src/modules/<name>/index.ts). ' +
                'Deep module imports defeat the boundary contract — .claude/AGENTS.md §5.',
            },
            // Relative depth alone is not a boundary violation: a module nested
            // at src/modules/<name>/<sub>/ legitimately reaches core with
            // `../../../core/index.js`. The real matrix is enforced by
            // dependency-cruiser, which resolves every import to its target.
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Tests deliberately construct malformed input to prove the schema rejects it.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['**/*.config.{ts,mjs,js}', 'eslint.config.mjs', '.dependency-cruiser.cjs'],
    rules: {
      // Configuration files are JavaScript inputs, not typed product source.
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
