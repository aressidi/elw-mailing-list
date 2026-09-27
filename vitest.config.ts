import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Server tests hit a real Postgres database that MUST be a throwaway test DB.
// Never point this at the dev database (elw_mailing_list).
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://localhost:5432/elw_mailing_list_test';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      // Known-bug tests fail on purpose; still produce the report.
      reportOnFailure: true,
      include: ['server/**/*.ts', 'client/src/**/*.{ts,tsx}', 'scripts/owner-identity.ts'],
      exclude: ['server/dist/**', 'client/src/main.tsx', '**/*.d.ts'],
    },
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
          globalSetup: ['tests/server/global-setup.ts'],
          // All server test files share one database; run them one at a time.
          fileParallelism: false,
          env: {
            DATABASE_URL: TEST_DATABASE_URL,
            AUTH_ENABLED: 'false',
            NODE_ENV: 'test',
            PORT: '0',
          },
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/client/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/client/setup.ts'],
        },
      },
    ],
  },
});
