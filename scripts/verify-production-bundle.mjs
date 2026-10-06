// Greps exported JS bundles for code that only exists in the plugin's real
// implementation. Usage:
//   node scripts/verify-production-bundle.mjs <prod-dist> [<dev-dist>]
// (run from the repo root via `bun run verify:prod`, which exports the example app first)
// The production bundle must contain none of the markers; the optional
// development bundle must contain all of them (proving the markers are real).
import fs from 'node:fs';
import path from 'node:path';

const MARKERS = [
  '__ROZENITE_TIMELINE_STORE__', // the store singleton key (src/react-native/timeline.ts)
  'rozenite-timeline-plugin', // the plugin id (src/shared/messaging.ts)
  '[Unserializable: ', // the serializer (src/shared/serialize.ts)
  'from a previous list-events call', // the agent tools (src/react-native/agent-handlers.ts)
  'device-ready', // the bridge protocol (src/react-native/useRozeniteTimelinePlugin.ts)
  'plugin-mounted', // @rozenite/plugin-bridge
];
const APP_MARKER = 'Timeline playground';

const findBundles = (dir) =>
  fs.readdirSync(dir, { recursive: true })
    .map((file) => path.join(dir, String(file)))
    .filter((file) => /\.(js|hbc)$/.test(file) && fs.statSync(file).isFile());

const scan = (dir) => {
  const bundles = findBundles(dir);
  if (bundles.length === 0) throw new Error(`No bundles found in ${dir}`);
  return bundles.map((file) => {
    const text = fs.readFileSync(file, 'latin1');
    return {
      file: path.relative(process.cwd(), file),
      bytes: text.length,
      isApp: text.includes(APP_MARKER),
      found: MARKERS.filter((marker) => text.includes(marker)),
    };
  });
};

const [prodDir = 'dist', devDir] = process.argv.slice(2);
let failed = false;

for (const bundle of scan(prodDir)) {
  const ok = bundle.isApp && bundle.found.length === 0;
  failed ||= !ok;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} production ${bundle.file} (${bundle.bytes} bytes): app code ${bundle.isApp ? 'present' : 'MISSING'}, plugin markers: ${bundle.found.length ? bundle.found.join(', ') : 'none'}`,
  );
}

if (devDir) {
  for (const bundle of scan(devDir)) {
    const ok = bundle.found.length === MARKERS.length;
    failed ||= !ok;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} development ${bundle.file}: plugin markers found ${bundle.found.length}/${MARKERS.length}`,
    );
  }
}

process.exit(failed ? 1 : 0);
