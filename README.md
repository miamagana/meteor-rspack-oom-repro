# rspack large non-Blaze client bundle OOM repro (meteor/meteor#14562)

Shareable, synthetic reproduction of the large non-Blaze client bundle OOM:
`meteor build` runs the Meteor build tool out of memory while linking the
imported Rspack client output. This is the non-Blaze scalability case behind
meteor/meteor#14562. No Blaze, no private code.

## What it is
A minimal (`static-html`, non-Blaze) Meteor 3.5 app with `rspack` added.
`generate.js` writes a large, non-tree-shakeable client module graph (many
functions, all escaping to a global registry via top-level side effects, so
production optimization keeps them). `client/main.js` imports it, so the
generated client `-meteor.js` imports `client-rspack.js`, and Meteor links that
whole output.

## Reproduce
```bash
meteor npm install
node generate.js                 # default 800 modules x 400 funcs = 320k functions
TOOL_NODE_FLAGS='--max-old-space-size=2048' meteor build --directory /tmp/out
```
Result: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out
of memory` (exit 134), after `=> Compiled Rspack client app`.

Size is tunable: `MODULES=<n> FUNCS=<n> node generate.js`. A small size
(`MODULES=20 FUNCS=50`) builds fine, which confirms the app itself is healthy.

## What was observed (Meteor 3.5, rspack 1.1.0, @meteorjs/rspack 2.1.0)
- The generated client output is ~17MB of JS with a ~102MB source map.
- `meteor build` OOMs the build tool at a 2GB heap.
- `meteor build --debug` (minification off) **also** OOMs. So it is not the
  minifier. The OOM is in Meteor's link/output handling of the imported bundle,
  after Rspack has already compiled it.
- The large source map (~102MB) is the prime suspect for the linker/output-stage
  memory blow-up.

## Notes
- Dev (`meteor run`) and `meteor test --full-app` do not reproduce this: the
  Rspack dev server serves the client, so the large output is never imported and
  linked. The import + link only happens in `meteor build` (and production run).
- The 2GB bound just makes the OOM deterministic and machine-independent. Raise
  it to find the real threshold, or raise `MODULES`/`FUNCS` to OOM at a larger
  heap.

## Profiling further
To capture retainers at the limit:
```bash
TOOL_NODE_FLAGS='--max-old-space-size=2048 --heapsnapshot-near-heap-limit=1' \
  meteor build --debug --directory /tmp/out
```
This writes a `.heapsnapshot` just before the OOM for inspecting which stage
(source-map handling vs linking vs versioning) dominates.
