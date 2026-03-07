#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const out = { app: null, dryRun: false, verbose: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--app' && argv[i + 1]) {
      out.app = argv[i + 1];
      i += 1;
      continue;
    }
    if (a.startsWith('--app=')) {
      out.app = a.slice('--app='.length);
      continue;
    }
    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (a === '--verbose') {
      out.verbose = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
    console.error(`[sync-deps] Unknown argument: ${a}`);
    printHelp();
    process.exit(1);
  }
  return out;
}

function printHelp() {
  console.log('Usage: node tools/sync-deps.js [--app <name>] [--dry-run] [--verbose]');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  const body = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(filePath, body, 'utf8');
}

function sortedObject(input) {
  const out = {};
  Object.keys(input || {})
    .sort((a, b) => a.localeCompare(b))
    .forEach((k) => {
      out[k] = input[k];
    });
  return out;
}

function mergeSection(current, baseline) {
  const merged = { ...(current || {}) };
  for (const [name, version] of Object.entries(baseline || {})) {
    merged[name] = version;
  }
  return sortedObject(merged);
}

function normalizeScripts(pkg) {
  if (!pkg.scripts || typeof pkg.scripts !== 'object') {
    pkg.scripts = {
      dev: 'vite',
      build: 'vite build',
      lint: 'eslint .',
      preview: 'vite preview'
    };
    return;
  }

  if (!pkg.scripts.dev) pkg.scripts.dev = 'vite';
  if (!pkg.scripts.build) pkg.scripts.build = 'vite build';
  if (!pkg.scripts.lint) pkg.scripts.lint = 'eslint .';
  if (!pkg.scripts.preview) pkg.scripts.preview = 'vite preview';
}

function collectTargets(appsDir, appName) {
  if (appName) {
    const target = path.join(appsDir, appName, 'package.json');
    if (!fs.existsSync(target)) {
      throw new Error(`Target app not found: ${appName}`);
    }
    return [target];
  }

  return fs
    .readdirSync(appsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(appsDir, d.name, 'package.json'))
    .filter((p) => fs.existsSync(p));
}

function updatePackageJson(filePath, baseline, dryRun, verbose) {
  const originalBody = fs.readFileSync(filePath, 'utf8');
  const pkg = JSON.parse(originalBody);

  pkg.private = true;
  pkg.type = pkg.type || 'module';
  normalizeScripts(pkg);

  pkg.dependencies = mergeSection(pkg.dependencies, baseline.dependencies);
  pkg.devDependencies = mergeSection(pkg.devDependencies, baseline.devDependencies);

  const nextBody = `${JSON.stringify(pkg, null, 2)}\n`;
  const changed = nextBody !== originalBody;

  if (changed && !dryRun) {
    writeJson(filePath, pkg);
  }

  if (verbose || changed) {
    const mark = changed ? '[updated]' : '[ok]';
    console.log(`${mark} ${filePath}`);
  }

  return changed;
}

function main() {
  const args = parseArgs(process.argv);
  const rootDir = path.resolve(__dirname, '..');
  const appsDir = path.join(rootDir, 'Apps');
  const baselineFile = path.join(rootDir, 'tools', 'deps.base.json');

  if (!fs.existsSync(baselineFile)) {
    throw new Error('Missing tools/deps.base.json');
  }
  if (!fs.existsSync(appsDir)) {
    throw new Error('Missing Apps directory');
  }

  const baseline = readJson(baselineFile);
  const targets = collectTargets(appsDir, args.app);

  if (!targets.length) {
    console.log('[sync-deps] no package.json found under Apps');
    return;
  }

  let changedCount = 0;
  for (const filePath of targets) {
    const changed = updatePackageJson(filePath, baseline, args.dryRun, args.verbose);
    if (changed) changedCount += 1;
  }

  const mode = args.dryRun ? 'dry-run' : 'write';
  console.log(`[sync-deps] mode=${mode} total=${targets.length} changed=${changedCount}`);
}

try {
  main();
} catch (err) {
  console.error(`[sync-deps] ${err.message}`);
  process.exit(1);
}
