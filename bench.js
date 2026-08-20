// Benchmark runner for meteor/meteor#14655. Runs `meteor build` for one meteor
// executable + variant label, under a bounded tool heap, and captures peak
// process-tree RSS, wall time, exit status, output size, and the METEOR_PROFILE
// log. Runs both normal and --debug. Meant to compare baseline vs the Rspack
// bypass on the same reproduction.
//
//   METEOR=/path/to/meteor node bench.js <label> [--exclude web.browser.legacy,web.cordova]
//
// Env: HEAP (MB, default 2048), OUT (default /tmp/bench-out), WARM=1 to warm once first.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const METEOR = process.env.METEOR || 'meteor';
const HEAP = process.env.HEAP || '2048';
const APP = __dirname;
const label = process.argv[2] || 'run';
const excludeIdx = process.argv.indexOf('--exclude');
const exclude = excludeIdx > -1 ? process.argv[excludeIdx + 1] : '';

function toolRssMB() {
  // RSS (MB) of the Meteor build-tool node process specifically. The linker /
  // source-map / minifier all run in this process, and its heap is what the 2GB
  // cap bounds. Summing the whole tree would be dominated by the separate rspack
  // (rust) process, which is irrelevant to the linker OOM.
  let rows;
  try {
    rows = execSync('ps -A -ww -o rss=,command=', { encoding: 'utf8' }).split('\n');
  } catch { return 0; }
  let max = 0;
  for (const line of rows) {
    if (line.includes('tools/index.js') && line.includes('meteor-checkout')) {
      const m = line.trim().match(/^(\d+)\s+/);
      if (m) max = Math.max(max, +m[1] / 1024);
    }
  }
  return max;
}

function runOnce(mode) {
  return new Promise(resolve => {
    const out = path.join(process.env.OUT || '/tmp/bench-out', `${label}-${mode}`);
    fs.rmSync(out, { recursive: true, force: true });
    fs.rmSync(path.join(APP, '_build'), { recursive: true, force: true });
    fs.rmSync(path.join(APP, 'node_modules/.cache'), { recursive: true, force: true });

    const args = ['build', '--directory', out];
    if (mode === 'debug') args.push('--debug');
    const env = {
      ...process.env,
      METEOR_HOME: path.dirname(METEOR),
      TOOL_NODE_FLAGS: `--max-old-space-size=${HEAP}`,
      METEOR_PROFILE: '1',
    };
    if (exclude) env.METEOR_FORCE_EXCLUDE_ARCHS = exclude;

    const logPath = path.join(process.env.OUT || '/tmp/bench-out', `${label}-${mode}.log`);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const log = fs.openSync(logPath, 'w');

    const t0 = Date.now();
    const child = spawn(METEOR, args, { cwd: APP, env });
    let peak = 0;
    const poll = setInterval(() => { peak = Math.max(peak, toolRssMB()); }, 250);
    child.stdout.on('data', d => fs.writeSync(log, d));
    child.stderr.on('data', d => fs.writeSync(log, d));
    child.on('exit', code => {
      clearInterval(poll);
      fs.closeSync(log);
      const wallMs = Date.now() - t0;
      const clientBytes = clientBytesFromManifest(out, 'web.browser') || clientBytesFromManifest(out, 'web.browser.legacy');
      const profile = extractProfile(logPath);
      resolve({ mode, exit: code, completed: code === 0, wallSec: +(wallMs / 1000).toFixed(1), peakRssMB: Math.round(peak), clientBytes, profile, log: logPath });
    });
  });
}

function clientBytesFromManifest(out, arch) {
  try {
    const dir = path.join(out, 'bundle/programs', arch);
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'program.json'), 'utf8'));
    let total = 0;
    for (const e of m.manifest) {
      if (e.type === 'js' && e.path) {
        try { total += fs.statSync(path.join(dir, e.path)).size; } catch {}
      }
    }
    return total;
  } catch { return 0; }
}

function extractProfile(logPath) {
  // METEOR_PROFILE prints a tree of `Name.....N ms (count)` lines.
  let txt = '';
  try { txt = fs.readFileSync(logPath, 'utf8'); } catch { return {}; }
  const grab = kw => {
    const re = new RegExp(`[^\\n]*${kw}[^\\n]*?\\.{2,}\\s*([\\d,]+)\\s*ms`, 'i');
    const m = txt.match(re);
    return m ? +m[1].replace(/,/g, '') : null;
  };
  return {
    totalMs: grab('meteor build'),
    prelinkMs: grab('getPrelinkedFiles'),
    linkJsMs: grab('linkJS'),
    minifyMs: grab('minif'),
    sourceMapMs: grab('toStringWithSourceMap'),
  };
}

(async () => {
  if (process.env.WARM) { await runOnce('warm'); }
  const results = [];
  for (const mode of ['normal', 'debug']) results.push(await runOnce(mode));
  const summary = { label, meteor: METEOR, heapMB: +HEAP, exclude: exclude || null, results };
  console.log(JSON.stringify(summary, null, 2));
})();
