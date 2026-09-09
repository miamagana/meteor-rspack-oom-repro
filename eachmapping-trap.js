// Shows the wasm SourceMapConsumer.eachMapping (the wall behind #14655) trapping on
// the real ~418MB client map and completing on a small one. Build the app once first.
//   SOURCE_MAP_LIB=/path/to/meteor/dev_bundle/lib/node_modules/source-map \
//     node --max-old-space-size=2048 eachmapping-trap.js
const fs = require('fs');
const path = require('path');

const SOURCE_MAP_LIB = process.env.SOURCE_MAP_LIB || 'source-map';
const sourcemap = require(SOURCE_MAP_LIB);
const MAP = process.env.MAP ||
  path.join(__dirname, '_build/main-prod/client-rspack.js.map');

async function iterate(map, label) {
  let peak = 0;
  const t = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100);
  try {
    const consumer = await new sourcemap.SourceMapConsumer(map);
    let count = 0;
    consumer.eachMapping(() => { count++; });
    consumer.destroy();
    clearInterval(t);
    peak = Math.max(peak, process.memoryUsage().rss);
    return { label, completed: true, mappings: count, peakRssMB: Math.round(peak / 1048576) };
  } catch (e) {
    clearInterval(t);
    return { label, completed: false, error: e.message, peakRssMB: Math.round(process.memoryUsage().rss / 1048576) };
  }
}

function smallMap() {
  const gen = new sourcemap.SourceMapGenerator({ file: 'small.js' });
  for (let i = 1; i <= 3; i++) {
    gen.addMapping({ generated: { line: i, column: 0 }, original: { line: i, column: 0 }, source: 'src' + i + '.js' });
  }
  return JSON.parse(gen.toString());
}

(async () => {
  console.log(JSON.stringify(await iterate(smallMap(), 'small (control)'), null, 0));
  if (!fs.existsSync(MAP)) {
    console.log('big map not found at ' + MAP + '. Build the app first (see header).');
    process.exit(2);
  }
  const big = JSON.parse(fs.readFileSync(MAP, 'utf8'));
  console.log('big map: ' + (big.sources ? big.sources.length : '?') + ' sources, ' +
    Math.round(fs.statSync(MAP).size / 1048576) + 'MB');
  const r = await iterate(big, 'big (real repro map)');
  console.log(JSON.stringify(r, null, 0));
  process.exit(r.completed ? 0 : 1);
})();
