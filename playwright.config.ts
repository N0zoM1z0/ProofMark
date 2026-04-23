import { defineConfig } from '@playwright/test';

const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
const apiBaseUrl = process.env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  reporter: 'list',
  testDir: './tests/playwright',
  use: {
    baseURL: baseUrl
  },
  webServer:
    process.env.PLAYWRIGHT_MANUAL_SERVERS === 'true'
      ? undefined
      : [
          {
            command: 'corepack pnpm --filter @proofmark/api dev',
            env: {
              ...process.env,
              PORT: apiBaseUrl.split(':').at(-1) ?? '3001',
              WEB_ORIGIN: baseUrl
            },
            reuseExistingServer: true,
            timeout: 120_000,
            url: `${apiBaseUrl}/health`
          },
          {
            command: 'corepack pnpm --filter @proofmark/web dev -- --hostname 127.0.0.1 --port 3000',
            env: {
              ...process.env,
              NEXT_PUBLIC_API_BASE_URL: apiBaseUrl
            },
            reuseExistingServer: true,
            timeout: 120_000,
            url: baseUrl
          }
        ]
});
