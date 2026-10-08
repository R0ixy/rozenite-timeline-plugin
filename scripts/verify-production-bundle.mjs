// Greps exported JS bundles for code that only exists in the plugin's real
// implementation. Usage, from the example app directory:
//   node ../scripts/verify-production-bundle.mjs <prod-dist> [<dev-dist>]
// (`bun run verify:prod` at the repo root rebuilds, repacks and reinstalls the
// plugin, exports the example, then runs this.)
// First it checks that the example really has the current build installed:
// a stale install would make every check below meaningless. Then the
// production bundle must contain none of the markers, and the optional
// development bundle must contain all of them (proving the markers are real).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_ROOT = path.resolve('..');
const INSTALLED_ROOT = path.resolve('node_modules/rozenite-timeline-plugin');

const hashTree = (dir) => {
  const hashes = new Map();
  for (const file of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isFile()) {
      hashes.set(file, crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  }
  return hashes;
};

const checkInstalledBuild = () => {
  const expected = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, 'package.json'), 'utf8')).version;
  const installed = JSON.parse(fs.readFileSync(path.join(INSTALLED_ROOT, 'package.json'), 'utf8')).version;
  const built = hashTree(path.join(PLUGIN_ROOT, 'dist'));
  const shipped = hashTree(path.join(INSTALLED_ROOT, 'dist'));
  const differing = [...new Set([...built.keys(), ...shipped.keys()])].filter(
    (file) => built.get(file) !== shipped.get(file),
  );
  const ok = installed === expected && differing.length === 0;
  console.log(
    `${ok ? 'PASS' : 'FAIL'} installed plugin ${installed} (expected ${expected}), dist files differing from the current build: ${differing.length ? differing.slice(0, 5).join(', ') : 'none'}`,
  );
  return ok;
};

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
let failed = !checkInstalledBuild();

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
