import { defineConfig } from '@playwright/test'

// Browser walkthrough of the full demo. It runs against its own database and a
// local stand-in for the model API (tests/e2e/mock-model.ts), so it never needs
// or spends a real API key: env vars set here win over any local .env.
const PORT = 3100

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The app honours reduced motion, so evidence screenshots never catch an entrance animation.
    reducedMotion: 'reduce',
  },
  webServer: [
    {
      command: 'npx tsx tests/e2e/mock-model.ts',
      port: 4010,
      reuseExistingServer: false,
      env: { MOCK_MODEL_PORT: '4010' },
    },
    {
      command: `npx tsx scripts/seed.ts --reset && npx vite dev --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/login`,
      timeout: 180_000,
      reuseExistingServer: false,
      env: {
        DATABASE_PATH: './data/e2e.db',
        SEED_PASSWORD: 'flowpilot-demo',
        MODEL_PROVIDER: 'anthropic',
        MODEL_NAME: 'e2e-mock-model',
        ANTHROPIC_API_KEY: 'e2e-dummy-key',
        ANTHROPIC_BASE_URL: 'http://localhost:4010',
        OPENROUTER_API_KEY: '',
        OPENAI_API_KEY: '',
      },
    },
  ],
})
