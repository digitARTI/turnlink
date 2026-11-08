import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test', outputDir: '../dist/dashboard-evidence', workers: 1, timeout: 30000,
  use: { browserName: 'chromium', screenshot: 'only-on-failure', trace: 'retain-on-failure', reducedMotion: 'reduce' },
  projects: [
    { name: 'desktop-light', use: { viewport: { width: 1440, height: 960 }, colorScheme: 'light' } },
    { name: 'mobile-dark', use: { viewport: { width: 390, height: 844 }, colorScheme: 'dark' } },
  ],
});
