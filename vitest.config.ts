import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules', 'public', 'web'],
    environment: 'node',
    reporters: ['default'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'lib/**/*.js'],
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
      '@infra': path.resolve(__dirname, 'src/infra'),
      '@application': path.resolve(__dirname, 'src/application'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
});
