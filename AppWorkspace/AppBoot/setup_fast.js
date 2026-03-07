#!/usr/bin/env node

const {
  ensurePackageManager,
  getAppContext,
  createViteProjectIfNeeded,
  syncDependencyBaseline,
  installDependencies,
  ensureConfigFiles,
  fail
} = require('./boot.lib');

function readAppNameArg() {
  const idx = process.argv.indexOf('--app');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

try {
  const pm = ensurePackageManager();
  const ctx = getAppContext(readAppNameArg());

  console.log('==========================================');
  console.log('     Setup Fast (Node.js)');
  console.log('==========================================');
  console.log(`[AppBoot] app: ${ctx.appName}`);
  console.log(`[AppBoot] target: ${ctx.target}`);

  createViteProjectIfNeeded(ctx, pm);
  syncDependencyBaseline(ctx.appName);
  installDependencies(ctx, pm);
  ensureConfigFiles(ctx.target, ctx.setting);

  console.log('==========================================');
  console.log('     Setup Fast Completed');
  console.log('==========================================');
  process.exit(0);
} catch (err) {
  fail(err.message || String(err));
}
