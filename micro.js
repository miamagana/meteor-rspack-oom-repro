// Isolated linker source-map concat on the real bundle+map, one impl per process (#14655).
//   node --max-old-space-size=2048 micro.js <wasm|zodern>
const fs = require('fs');
const path = require('path');

const DEV = '/Users/miguel/code/meteor-checkout/dev_bundle/lib/node_modules';
const sourcemap = require(path.join(DEV, 'source-map'));
const ZodernSourceMap = require(path.join(DEV, '@zodern/source-maps'));

const impl = process.argv[2];
const CODE = process.env.CODE ||
  '/Users/miguel/code/rspack-oom-repro/_build/main-prod/client-rspack.js';
const MAP = process.env.MAP || CODE + '.map';
const HEADER_LINES = 5;

let peakRss = 0;
const sampler = setInterval(() => {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
}, 100);

async function runWasm(code, map) {
  // getPrelinkedOutput's mapped-body path, then the combine's stringify.
  const consumer = await new sourcemap.SourceMapConsumer(map);
  const bodyNode = sourcemap.SourceNode.fromStringWithSourceMap(code, consumer);
  const node = new sourcemap.SourceNode(null, null, null, [
    'function module(require,exports,module){\n\n',
    bodyNode,
    '\n}',
  ]);
  const swsm = node.toStringWithSourceMap({ file: 'app.js' });
  const json = swsm.map.toJSON();
  consumer.destroy();
  return { codeLen: swsm.code.length, mappingsLen: json.mappings.length };
}

function runZodern(code, map) {
  const biased = {
    ...map,
    mappings: ';'.repeat(HEADER_LINES) + map.mappings,
  };
  const sm = new ZodernSourceMap();
  sm.addMap(biased, 0);
  const built = sm.build();
  return { codeLen: code.length, mappingsLen: built.mappings.length };
}

(async () => {
  const t0 = Date.now();
  const code = fs.readFileSync(CODE, 'utf8');
  const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  const tLoaded = Date.now();
  let out, err = null;
  try {
    out = impl === 'wasm' ? await runWasm(code, map) : runZodern(code, map);
  } catch (e) {
    err = e.message;
  }
  clearInterval(sampler);
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  console.log(JSON.stringify({
    impl,
    completed: !err,
    error: err,
    sources: map.sources ? map.sources.length : null,
    mapBytes: fs.statSync(MAP).size,
    loadSec: +((tLoaded - t0) / 1000).toFixed(1),
    concatSec: err ? null : +((Date.now() - tLoaded) / 1000).toFixed(1),
    peakRssMB: Math.round(peakRss / 1048576),
    result: out || null,
  }, null, 2));
  process.exit(err ? 1 : 0);
})();
