import { moduleCount } from '/imports/generated';

// If the client Rspack bundle loads, this runs. At OOM sizes the build never
// finishes, so this never executes.
window.__CLIENT_BOOTED__ = true;
window.__MODULE_COUNT__ = moduleCount;
console.log(`client booted, modules: ${moduleCount}, fns: ${Object.keys(globalThis.__REG__ || {}).length}`);
