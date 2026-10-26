import { defineConfig } from '@playwright/test'

// Uses the Microsoft Edge that ships with Windows, so no browser download is needed.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173', channel: 'msedge', viewport: { width: 1400, height: 860 } },
  webServer: { command: 'npm run dev', port: 5173, reuseExistingServer: true },
})
