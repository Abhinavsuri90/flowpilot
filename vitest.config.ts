import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    // npm run test:coverage. The unit and API tests cover the server and the shared
    // logic; the pages and components are covered by the browser tests instead.
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts', 'src/server/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // A little under today's figures, so a real drop fails CI.
      thresholds: { lines: 85, statements: 80, functions: 80, branches: 65 },
    },
  },
})
