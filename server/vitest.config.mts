import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // every test file gets its own SQLite file, so files can run in parallel
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
