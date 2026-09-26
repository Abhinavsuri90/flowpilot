// ESLint: TypeScript recommended rules plus the rules of hooks. Formatting is
// not linted; typecheck (tsc, strict, unused locals) runs separately.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['.output/**', '.nitro/**', '.tanstack/**', 'node_modules/**', 'src/routeTree.gen.ts', 'test-results/**', 'playwright-report/**', 'data/**', 'deploy/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Test helpers read API bodies as `any` on purpose; the server types them.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
)
