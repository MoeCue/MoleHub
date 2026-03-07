#!/usr/bin/env node

const {
  ensurePackageManager,
  getAppContext,
  ensureConfigFiles,
  buildAndInject,
  startDevServer,
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
  console.log('     Start App (Node.js)');
  console.log('==========================================');
  console.log(`[AppBoot] app: ${ctx.appName}`);
  console.log(`[AppBoot] target: ${ctx.target}`);

  ensureConfigFiles(ctx.target);
  buildAndInject(ctx.appName);
  startDevServer(ctx, pm);
  process.exit(0);
} catch (err) {
  fail(err.message || String(err));
}
