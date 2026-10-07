/// <reference types='vitest' />
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';
import { rozenitePlugin } from '@rozenite/vite-plugin';

const require = createRequire(import.meta.url);

/**
 * `@rozenite/agent-bridge` publishes a `development` export condition that
 * points at TypeScript sources it doesn't ship to npm, and Vitest always
 * resolves with `development`. Pin it to its published build in tests; its
 * hook is then replaced by a recording fake (see vitest.setup.ts).
 */
const publishedAgentBridge = (): Plugin => ({
  name: 'test:published-agent-bridge',
  enforce: 'pre',
  resolveId: (id) =>
    id === '@rozenite/agent-bridge' ? require.resolve('@rozenite/agent-bridge') : null,
});

export default defineConfig({
  root: __dirname,
  plugins: [rozenitePlugin(), ...(process.env.VITEST ? [publishedAgentBridge()] : [])],
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
