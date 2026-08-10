// Generates a large client module graph that (a) carries real AST / identifier
// / source-map weight, like real app code, and (b) survives production
// optimization (top-level side effects + every function escaping to globalThis,
// so rspack cannot tree-shake or constant-fold it). In `meteor build` the
// generated client -meteor.js imports the built output, so Meteor links,
// versions, and source-maps the whole file. Past a threshold that OOMs the
// Meteor build tool (meteor/meteor#14562). Parameterized:
//
//   MODULES=800 FUNCS=400 node generate.js
//
const fs = require('fs');
const path = require('path');

const MODULES = parseInt(process.env.MODULES || '800', 10);
const FUNCS = parseInt(process.env.FUNCS || '400', 10);

const dir = path.join(__dirname, 'imports', 'generated');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

for (let i = 0; i < MODULES; i++) {
  const lines = [];
  const names = [];
  for (let j = 0; j < FUNCS; j++) {
    names.push(`fn_${i}_${j}`);
    lines.push(
      `export function fn_${i}_${j}(a_${j}, b_${j}) {\n` +
        `  const k_${i}_${j} = { id: ${i * FUNCS + j}, a: a_${j}, b: b_${j}, tag: "mod_${i}_fn_${j}" };\n` +
        `  return (a_${j} || 0) + (b_${j} || 0) + k_${i}_${j}.id + "${i}:${j}".length;\n` +
        `}`,
    );
  }
  // Every function escapes to a global registry via a top-level side effect, so
  // the optimizer must keep all of them (no tree-shaking, no constant folding).
  lines.push(`export const mod_${i} = { ${names.join(', ')} };`);
  lines.push(`(globalThis.__REG__ = globalThis.__REG__ || {})["m${i}"] = mod_${i};`);
  fs.writeFileSync(path.join(dir, `mod${i}.js`), lines.join('\n') + '\n');
}

const imports = Array.from({ length: MODULES }, (_, i) => `import './mod${i}.js';`).join('\n');
fs.writeFileSync(
  path.join(dir, 'index.js'),
  `${imports}\nexport const moduleCount = ${MODULES};\n`,
);

console.log(`generated ${MODULES} modules x ${FUNCS} funcs = ${MODULES * FUNCS} functions`);
