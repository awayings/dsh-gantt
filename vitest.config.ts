import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['dot'],
    projects: [
      {
        test: {
          name: 'host',
          include: ['tests/store/**/*.spec.js', 'tests/host/**/*.spec.js'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'client',
          include: ['tests/client/**/*.spec.js'],
          environment: 'jsdom',
          setupFiles: ['tests/client/setup.js'],
          testTimeout: 30_000,
          pool: 'forks',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['store.js', 'index.js', 'client.js'],
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        'store.js': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'index.js': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'client.js': {
          statements: 99,
          branches: 98,
          functions: 99,
          lines: 99,
        },
      },
    },
  },
})
