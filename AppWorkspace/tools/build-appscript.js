#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function fail(msg, code = 1) {
  process.stderr.write(`[build-appscript] ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { app: null, verbose: false, inject: false };
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
    if (a === '--verbose') {
      out.verbose = true;
      continue;
    }
    if (a === '--inject') {
      out.inject = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      log('Usage: node tools/build-appscript.js [--app <appName>] [--inject] [--verbose]');
      process.exit(0);
    }
    fail(`Unknown argument: ${a}`);
  }
  return out;
}

function loadEsbuild() {
  try {
    return require('esbuild');
  } catch (_) {
    fail('Missing esbuild. Run: pnpm install (workspace root: AppWorkspace).');
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getTargets(setting, selectedApp) {
  const apps = setting.apps || {};
  const entries = Object.entries(apps);
  if (!entries.length) fail('No apps found in setting.json');

  if (selectedApp) {
    const hit = entries.find(([name]) => name === selectedApp);
    if (!hit) fail(`App not found in setting.json: ${selectedApp}`);
    return [hit];
  }

  return entries;
}

async function buildOne(esbuild, opts) {
  const {
    appName,
    appCfg,
    sourceRoot,
    projectRoot,
    outputRoot,
    inject,
    verbose
  } = opts;

  const scriptName = appCfg.script;
  if (!scriptName && !inject) {
    throw new Error(`${appName}: missing script in setting.json`);
  }

  const scriptEntry = appCfg.scriptEntry || `${appName}/main.jsx`;
  const entryFile = path.join(sourceRoot, scriptEntry);
  if (!fs.existsSync(entryFile)) {
    throw new Error(`${appName}: source entry not found: ${entryFile}`);
  }

  const outFile = inject
    ? path.join(projectRoot, appName, 'src', 'App.jsx')
    : path.join(outputRoot, scriptName);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  if (verbose) {
    log(`[build-appscript] ${appName}`);
    log(`  entry: ${entryFile}`);
    log(`  output: ${outFile}`);
  }

  await esbuild.build({
    entryPoints: [entryFile],
    outfile: outFile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2019'],
    packages: 'external',
    jsx: 'automatic',
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'silent',
    banner: {
      js: `// Generated from AppScriptSrc (${appName}) - DO NOT EDIT DIRECTLY.`
    }
  });

  log(`[build-appscript] built ${appName} -> ${outFile}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const esbuild = loadEsbuild();

  const workspaceRoot = path.resolve(__dirname, '..');
  const settingFile = path.resolve(workspaceRoot, '..', 'setting.json');

  if (!fs.existsSync(settingFile)) {
    fail(`setting.json not found: ${settingFile}`);
  }

  const setting = readJson(settingFile);
  const pathsCfg = setting.paths || {};
  const sourceDirName = pathsCfg.scriptSrcDir || 'AppScriptSrc';
  const outputDirName = pathsCfg.scriptDir || 'AppScript';
  const projectDirName = pathsCfg.projectDir || 'Apps';

  const sourceRoot = path.join(workspaceRoot, sourceDirName);
  const outputRoot = path.join(workspaceRoot, outputDirName);
  const projectRoot = path.join(workspaceRoot, projectDirName);

  if (!fs.existsSync(sourceRoot)) {
    fail(`source directory not found: ${sourceRoot}`);
  }

  const targets = getTargets(setting, args.app);
  let built = 0;
  for (const [appName, appCfg] of targets) {
    try {
      await buildOne(esbuild, {
        appName,
        appCfg,
        sourceRoot,
        projectRoot,
        outputRoot,
        inject: args.inject,
        verbose: args.verbose
      });
      built += 1;
    } catch (err) {
      fail(err.message);
    }
  }

  log(`[build-appscript] done. built=${built}`);
}

main().catch((err) => fail(err.message));
