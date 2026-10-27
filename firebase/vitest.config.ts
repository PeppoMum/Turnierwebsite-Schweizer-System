import { defineConfig } from 'vitest/config';

// Regel- und Integrationstests gegen den Firestore-Emulator.
// Start über `npm run test:rules` (startet den Emulator automatisch).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firebase/tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
