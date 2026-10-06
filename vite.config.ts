/// <reference types='vitest' />
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import { rozenitePlugin } from '@rozenite/vite-plugin';

const require = createRequire(import.meta.url);

/**
 * `@rozenite/agent-shared` and `@rozenite/agent-bridge` publish a
 * `development` export condition that points at TypeScript sources they do
 * not ship to npm, and Vitest always resolves with `development`. Pin them to
 * their published builds in tests. agent-bridge's CommonJS build then hits
 * the same problem in its own `require('@rozenite/agent-shared')`, so tests
 * replace its hook with a recording fake (see vitest.setup.ts).
 */
const PUBLISHED_ENTRIES: Record<string, string> = {
  '@rozenite/agent-shared': require
    .resolve('@rozenite/agent-shared')
    .replace(/index\.cjs$/, 'index.js'),
  '@rozenite/agent-bridge': require.resolve('@rozenite/agent-bridge'),
};

const publishedAgentPackages = (): Plugin => ({
  name: 'test:published-agent-packages',
  enforce: 'pre',
  resolveId: (id) => PUBLISHED_ENTRIES[id] ?? null,
});

export default defineConfig({
  root: __dirname,
  plugins: [rozenitePlugin(), ...(process.env.VITEST ? [publishedAgentPackages()] : [])],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    // Process @rozenite/ui through Vite so the react-virtuoso mock in
    // vitest.setup.ts reaches its VirtualizedList.
    server: { deps: { inline: ['@rozenite/ui'] } },
  },
  base: './',
  build: {
    outDir: './dist',
    emptyOutDir: false,
    reportCompressedSize: false,
    minify: true,
    sourcemap: false,
  },
  server: {
    port: 3000,
    open: true,
  },
});
