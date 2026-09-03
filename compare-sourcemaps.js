// Asserts two `meteor build --directory` outputs have byte-identical client JS
// and source maps that resolve the same original positions (#14655 correctness).
//   node compare-sourcemaps.js <zodernBundleDir> <baselineBundleDir>
const fs = require('fs');
const path = require('path');

const SOURCE_MAP = process.env.SOURCE_MAP_LIB ||
  '/Users/miguel/code/meteor-checkout/dev_bundle/lib/node_modules/source-map';
const sourcemap = require(SOURCE_MAP);

const [dirA, dirB] = process.argv.slice(2);
if (!dirA || !dirB) {
  console.error('usage: node compare-sourcemaps.js <zodernDir> <baselineDir>');
  process.exit(2);
}

const ARCHS = ['web.browser', 'web.browser.legacy'];

function jsEntries(bundleDir, arch) {
  const progDir = path.join(bundleDir, 'bundle/programs', arch);
  const manifestPath = path.join(progDir, 'program.json');
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return manifest.manifest
    .filter(e => e.type === 'js' && e.path)
    .map(e => ({
      servePath: e.url || e.path,
      file: path.join(progDir, e.path),
      mapFile: e.sourceMap ? path.join(progDir, e.sourceMap) : null,
    }));
}

function samplePositions(code, n) {
  const lines = code.split('\n');
  const positions = [];
  const step = Math.max(1, Math.floor(lines.length / n));
  for (let line = 1; line <= lines.length; line += step) {
    const text = lines[line - 1] || '';
    // a column near the first non-space token on the line
    const col = Math.max(0, text.search(/\S/));
    positions.push({ line, column: col });
  }
  return positions;
}

async function comparePair(a, b, arch) {
  const codeA = fs.readFileSync(a.file);
  const codeB = fs.readFileSync(b.file);
  const byteIdentical = Buffer.compare(codeA, codeB) === 0;
  const result = {
    arch,
    servePath: a.servePath,
    bytesA: codeA.length,
    bytesB: codeB.length,
    byteIdentical,
    mapA: !!a.mapFile,
    mapB: !!b.mapFile,
    mappingChecks: 0,
    mappingMismatches: [],
  };

  if (!byteIdentical) {
    // find first differing offset for a quick diagnostic
    const len = Math.min(codeA.length, codeB.length);
    let off = 0;
    while (off < len && codeA[off] === codeB[off]) off++;
    result.firstDiffOffset = off;
    return result;
  }

  if (a.mapFile && b.mapFile) {
    const mapA = JSON.parse(fs.readFileSync(a.mapFile, 'utf8'));
    const mapB = JSON.parse(fs.readFileSync(b.mapFile, 'utf8'));
    const consA = await new sourcemap.SourceMapConsumer(mapA);
    const consB = await new sourcemap.SourceMapConsumer(mapB);
    const positions = samplePositions(codeA.toString('utf8'), 500);
    for (const pos of positions) {
      const oa = consA.originalPositionFor(pos);
      const ob = consB.originalPositionFor(pos);
      result.mappingChecks++;
      if (oa.source !== ob.source || oa.line !== ob.line ||
          oa.column !== ob.column || oa.name !== ob.name) {
        if (result.mappingMismatches.length < 10) {
          result.mappingMismatches.push({ pos, zodern: oa, baseline: ob });
        }
      }
    }
    consA.destroy();
    consB.destroy();
  }
  return result;
}

(async () => {
  let ok = true;
  const report = [];
  for (const arch of ARCHS) {
    const entriesA = jsEntries(dirA, arch);
    const entriesB = jsEntries(dirB, arch);
    if (!entriesA || !entriesB) continue;
    const byPathB = new Map(entriesB.map(e => [e.servePath, e]));
    for (const a of entriesA) {
      const b = byPathB.get(a.servePath);
      if (!b) {
        report.push({ arch, servePath: a.servePath, missingInBaseline: true });
        ok = false;
        continue;
      }
      const r = await comparePair(a, b, arch);
      report.push(r);
      if (!r.byteIdentical || r.mappingMismatches.length > 0) ok = false;
    }
  }
  console.log(JSON.stringify({ ok, dirA, dirB, report }, null, 2));
  process.exit(ok ? 0 : 1);
})();
