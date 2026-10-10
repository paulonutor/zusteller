import fs from 'node:fs';
import { defineConfig } from '@playwright/test';

const PORT = 5304;
const chromiumPath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const executablePath = fs.existsSync(chromiumPath) ? chromiumPath : undefined;

export default defineConfig({
  testDir: './tests-visual',
  // {platform} keeps linux (CI) and darwin baselines apart.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  outputDir: './test-results',
  fullyParallel: true,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.0003, threshold: 0.2, animations: 'disabled' },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    // Same glyph rasterising on every machine: no hinting, no subpixel/LCD text.
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--font-render-hinting=none',
        '--disable-lcd-text',
        '--disable-font-subpixel-positioning',
      ],
    },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'functional', testDir: './tests-e2e', use: { browserName: 'chromium' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
