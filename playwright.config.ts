import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.CC_WEB_E2E_PORT || 8003);
const REPO_DIR = process.cwd();
const E2E_ROOT = process.env.CC_WEB_E2E_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'cc-web-e2e-'));
const E2E_PASSWORD = process.env.CC_WEB_TEST_PW || 'E2eStrong123!';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 20_000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      CC_WEB_PASSWORD: E2E_PASSWORD,
      CC_WEB_CONFIG_DIR: path.join(E2E_ROOT, 'config'),
      CC_WEB_SESSIONS_DIR: path.join(E2E_ROOT, 'sessions'),
      CC_WEB_LOGS_DIR: path.join(E2E_ROOT, 'logs'),
      CC_WEB_HERMES_WSL_DISABLED: '1',
      CLAUDE_PATH: path.join(REPO_DIR, 'scripts', 'mock-claude.js'),
      CODEX_PATH: path.join(REPO_DIR, 'scripts', 'mock-codex.js'),
      GEMINI_PATH: path.join(REPO_DIR, 'scripts', 'mock-gemini.js'),
      CC_SWITCH_CLI_PATH: path.join(REPO_DIR, 'scripts', 'mock-ccswitch.js'),
    },
  },
});
