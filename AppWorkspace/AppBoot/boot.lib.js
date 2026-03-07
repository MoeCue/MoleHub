const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const isWin = process.platform === 'win32';

const workspaceRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(workspaceRoot, '..');
const settingFile = path.join(repoRoot, 'setting.json');
const commandEnv = {
  ...process.env,
  NO_COLOR: '1',
  FORCE_COLOR: '0',
  npm_config_color: 'false'
};

function fail(message, code = 1) {
  console.error(`[AppBoot] ${message}`);
  process.exit(code);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function resolveManagerApiTarget(setting) {
  const defaultPort = 3000;
  const rawPort = setting && setting.managerPort;
  const managerPort = Number.isInteger(parseInt(rawPort, 10)) ? parseInt(rawPort, 10) : defaultPort;

  let baseUrl = (setting && setting.managerUrl) ? String(setting.managerUrl).trim() : 'http://localhost';
  if (!baseUrl) baseUrl = 'http://localhost';
  if (!/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `http://${baseUrl}`;
  }

  try {
    const u = new URL(baseUrl);
    u.port = String(managerPort);
    return u.origin;
  } catch (_) {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return `${trimmed}:${managerPort}`;
  }
}

function run(cmd, args, cwd, options = {}) {
  const finalCmd = resolveCmd(cmd);
  const result = spawnSync(finalCmd, args, {
    cwd,
    stdio: 'inherit',
    shell: isWin,
    windowsHide: true,
    env: commandEnv,
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  const code = typeof result.status === 'number' ? result.status : 1;
  return code;
}

function hasCmd(cmd, args = ['-v']) {
  try {
    const r = spawnSync(resolveCmd(cmd), args, {
      stdio: 'ignore',
      shell: isWin,
      windowsHide: true,
      env: commandEnv
    });
    return r.status === 0;
  } catch (_) {
    return false;
  }
}

function resolveCmd(cmd) {
  if (!isWin) return cmd;
  if (cmd.includes('\\') || cmd.includes('/') || /\.[a-z0-9]+$/i.test(cmd)) return cmd;
  if (cmd.toLowerCase() === 'node') return cmd;
  return `${cmd}.cmd`;
}

function ensurePackageManager() {
  if (hasCmd('pnpm', ['-v'])) {
    return { pm: 'pnpm', cmd: 'pnpm' };
  }

  console.log('[AppBoot] pnpm not found, try npm i -g pnpm ...');
  const installCode = run('npm', ['i', '-g', 'pnpm'], process.env.USERPROFILE || repoRoot);
  if (installCode === 0 && hasCmd('pnpm', ['-v'])) {
    return { pm: 'pnpm', cmd: 'pnpm' };
  }

  const appDataPnpm = path.join(process.env.APPDATA || '', 'npm', 'pnpm.cmd');
  if (fs.existsSync(appDataPnpm)) {
    return { pm: 'pnpm', cmd: appDataPnpm };
  }

  return { pm: 'npm', cmd: 'npm' };
}

function splitDeps(text) {
  return String(text || '')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function getAppContext(appNameArg) {
  if (!fs.existsSync(settingFile)) {
    fail(`setting.json not found: ${settingFile}`);
  }

  const setting = readJson(settingFile);
  const appName = appNameArg || setting.currentApp;
  if (!appName) {
    fail('appName is empty. pass --app <name> or set setting.json.currentApp');
  }

  const pathsCfg = setting.paths || {};
  const appCfg = (setting.apps || {})[appName];
  if (!appCfg) {
    fail(`app config not found in setting.json: ${appName}`);
  }

  const projectDir = pathsCfg.projectDir || 'Apps';
  const target = path.join(workspaceRoot, projectDir, appName);
  const twVersion = appCfg.tailwindVersion || 'latest';
  const extraDeps = splitDeps(appCfg.dependencies);

  return {
    setting,
    appName,
    appCfg,
    projectDir,
    target,
    twVersion,
    extraDeps
  };
}

function createViteProjectIfNeeded(ctx, pm) {
  const packageJson = path.join(ctx.target, 'package.json');
  if (fs.existsSync(packageJson)) return;

  console.log(`[AppBoot] create vite app: ${ctx.appName}`);
  if (fs.existsSync(ctx.target)) {
    fs.rmSync(ctx.target, { recursive: true, force: true });
  }

  const appsRoot = path.join(workspaceRoot, ctx.projectDir);
  fs.mkdirSync(appsRoot, { recursive: true });

  let code = 1;
  if (pm.pm === 'pnpm') {
    code = run(pm.cmd, ['create', 'vite', ctx.appName, '--template', 'react', '--no-interactive', '--no-rolldown'], appsRoot);
  } else {
    code = run(pm.cmd, ['create', 'vite@latest', ctx.appName, '--', '--template', 'react', '--no-interactive', '--no-rolldown'], appsRoot);
  }
  if (code !== 0) {
    fail('vite project creation failed');
  }
}

function syncDependencyBaseline(appName) {
  const script = path.join(workspaceRoot, 'tools', 'sync-deps.js');
  if (!fs.existsSync(script)) {
    fail(`sync-deps.js not found: ${script}`);
  }

  const code = run('node', [script, '--app', appName], workspaceRoot);
  if (code !== 0) {
    fail('dependency baseline sync failed');
  }
}

function installDependencies(ctx, pm) {
  console.log('[AppBoot] install dependencies...');

  let code = 1;
  if (pm.pm === 'pnpm') {
    code = run(pm.cmd, ['install'], workspaceRoot);
  } else {
    code = run(pm.cmd, ['install'], ctx.target);
  }
  if (code !== 0) {
    fail('install failed');
  }

  console.log(`[AppBoot] fix tailwind version: ${ctx.twVersion}`);
  if (pm.pm === 'pnpm') {
    run(pm.cmd, ['remove', 'tailwindcss', '@tailwindcss/postcss'], ctx.target);
    code = run(pm.cmd, ['add', '-D', `tailwindcss@${ctx.twVersion}`, 'postcss', 'autoprefixer'], ctx.target);
  } else {
    run(pm.cmd, ['uninstall', 'tailwindcss', '@tailwindcss/postcss'], ctx.target);
    code = run(pm.cmd, ['install', '-D', `tailwindcss@${ctx.twVersion}`, 'postcss', 'autoprefixer'], ctx.target);
  }
  if (code !== 0) {
    fail('tailwind fix failed');
  }

  if (ctx.extraDeps.length) {
    console.log(`[AppBoot] install extra deps: ${ctx.extraDeps.join(' ')}`);
    if (pm.pm === 'pnpm') {
      code = run(pm.cmd, ['add', ...ctx.extraDeps], ctx.target);
    } else {
      code = run(pm.cmd, ['install', ...ctx.extraDeps], ctx.target);
    }
    if (code !== 0) {
      fail('extra dependency install failed');
    }
  }
}

function ensureConfigFiles(target, setting) {
  const twConfig = path.join(target, 'tailwind.config.js');
  const postcssConfig = path.join(target, 'postcss.config.js');
  const indexCss = path.join(target, 'src', 'index.css');
  const viteConfig = path.join(target, 'vite.config.js');
  const tailwindIndexCss = '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n';
  const effectiveSetting = setting || (fs.existsSync(settingFile) ? readJson(settingFile) : {});
  const managerApiTarget = resolveManagerApiTarget(effectiveSetting);

  if (!fs.existsSync(twConfig)) {
    writeText(
      twConfig,
      '/** @type {import(\'tailwindcss\').Config} */\nexport default {\n  content: [\n    "./index.html",\n    "./src/**/*.{js,ts,jsx,tsx}",\n  ],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}\n'
    );
  }

  if (!fs.existsSync(postcssConfig)) {
    writeText(
      postcssConfig,
      'export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n'
    );
  }

  if (!fs.existsSync(indexCss)) {
    writeText(indexCss, tailwindIndexCss);
    return;
  }

  const currentIndexCss = fs.readFileSync(indexCss, 'utf8');
  const hasTailwindDirectives =
    currentIndexCss.includes('@tailwind base;') &&
    currentIndexCss.includes('@tailwind components;') &&
    currentIndexCss.includes('@tailwind utilities;');

  if (!hasTailwindDirectives) {
    // Migrate old Vite default CSS to Tailwind entry so utility classes can work.
    writeText(indexCss, tailwindIndexCss);
  }

  const desiredProxy = `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    proxy: {\n      '/api': {\n        target: '${managerApiTarget}',\n        changeOrigin: true\n      }\n    }\n  }\n})\n`;

  if (!fs.existsSync(viteConfig)) {
    writeText(viteConfig, desiredProxy);
    return;
  }

  const currentVite = fs.readFileSync(viteConfig, 'utf8');
  const hasApiProxy = currentVite.includes("'/api'") && currentVite.includes('proxy');
  const hasTarget = currentVite.includes(managerApiTarget);
  if (!hasApiProxy || !hasTarget) {
    writeText(viteConfig, desiredProxy);
  }
}

function buildAndInject(appName) {
  const buildScript = path.join(workspaceRoot, 'tools', 'build-appscript.js');
  if (!fs.existsSync(buildScript)) {
    fail(`build-appscript.js not found: ${buildScript}`);
  }

  const code = run('node', [buildScript, '--app', appName, '--inject'], workspaceRoot);
  if (code !== 0) {
    fail('build/inject failed');
  }
}

function startDevServer(ctx, pm) {
  const port = String(ctx.appCfg.port || 5173);
  console.log(`[AppBoot] start dev server on :${port}`);

  if (pm.pm === 'pnpm') {
    const code = run(pm.cmd, ['--filter', ctx.appName, 'run', 'dev', '--port', port, '--strictPort'], workspaceRoot);
    if (code !== 0) {
      fail(`pnpm dev failed with exit code ${code}`);
    }
    return;
  }

  const code = run('npm', ['run', 'dev', '--', '--port', port, '--strictPort'], ctx.target);
  if (code !== 0) {
    fail('dev server start failed');
  }
}

module.exports = {
  workspaceRoot,
  repoRoot,
  settingFile,
  ensurePackageManager,
  getAppContext,
  createViteProjectIfNeeded,
  syncDependencyBaseline,
  installDependencies,
  ensureConfigFiles,
  buildAndInject,
  startDevServer,
  fail
};
