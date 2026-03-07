#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
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

function rewriteConfigFiles(target) {
  fs.writeFileSync(
    path.join(target, 'tailwind.config.js'),
    '/** @type {import(\'tailwindcss\').Config} */\nexport default {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(target, 'postcss.config.js'),
    'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n',
    'utf8'
  );
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  fs.writeFileSync(path.join(target, 'src', 'index.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n', 'utf8');
}

try {
  const pm = ensurePackageManager();
  const ctx = getAppContext(readAppNameArg());

  console.log('==========================================');
  console.log('     Setup Full (Node.js)');
  console.log('==========================================');
  console.log(`[AppBoot] app: ${ctx.appName}`);
  console.log(`[AppBoot] target: ${ctx.target}`);

  createViteProjectIfNeeded(ctx, pm);
  syncDependencyBaseline(ctx.appName);
  installDependencies(ctx, pm);
  ensureConfigFiles(ctx.target, ctx.setting);
  rewriteConfigFiles(ctx.target);

  console.log('==========================================');
  console.log('     Setup Full Completed');
  console.log('==========================================');
  process.exit(0);
} catch (err) {
  fail(err.message || String(err));
}
