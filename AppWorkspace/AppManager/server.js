const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');
const {
    resolveManagerPort,
    readSettings,
    getInjectScriptRoot,
    ensureAppScriptSource,
    getSetupPreview
} = require('./modules/config');
const {
    getListeningPidsByPort,
    killPidTree,
    isPidOwnedByTargetPath,
    getNodePidsByAppName,
    isPortInUse,
    waitForPortFree
} = require('./modules/process-utils');
const {
    ensureLogsDir,
    makeLogFilePath,
    writeActionLog,
    getLatestLogByApp,
    getLatestLogAny,
    stripAnsi
} = require('./modules/log-utils');
const { createAppRuntimeRouter } = require('./routes/app-runtime');
const { createLogsRouter } = require('./routes/logs');

// ==========================================
// 1. 初始化依赖与配置
// ==========================================

const configPath = path.join(__dirname, 'modules.json');
const modulesConfig = fs.existsSync(configPath) 
    ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) 
    : { dependencies: {} };

const loadDep = (name) => {
    const cfg = modulesConfig.dependencies[name];
    return (cfg && cfg.enabled) ? require(name) : null;
};

const bodyParser = loadDep('body-parser');
const cors = loadDep('cors');

// [优化] 已移除顶部 ExcelGen 引用，避免启动时卡顿
// let ExcelGen = null; ... <--- 已删除

const app = express();
const SETTING_FILE = path.join(__dirname, '../../setting.json');
const BASELINE_DEPS_FILE = path.join(__dirname, '../tools/deps.base.json');
const LOGS_DIR = path.join(__dirname, '..', 'Logs');
const DEFAULT_MANAGER_PORT = 3000;

const PORT = resolveManagerPort(SETTING_FILE, DEFAULT_MANAGER_PORT);
const MANAGER_LOG_MAX = 2000;
const managerLogs = [];
const managedAppPids = new Map();

function loadOptionalRouterFactory(modulePath, exportName) {
    try {
        if (!fs.existsSync(modulePath)) return null;
        const mod = require(modulePath);
        const factory = mod && mod[exportName];
        return typeof factory === 'function' ? factory : null;
    } catch (e) {
        console.warn(`[optional-router] load failed: ${modulePath} (${e.message})`);
        return null;
    }
}

function appendManagerLog(level, args) {
    const msg = args.map((x) => {
        if (typeof x === 'string') return x;
        try { return JSON.stringify(x); } catch (_) { return String(x); }
    }).join(' ');
    managerLogs.push(`[${new Date().toISOString()}] [${level}] ${msg}`);
    if (managerLogs.length > MANAGER_LOG_MAX) {
        managerLogs.splice(0, managerLogs.length - MANAGER_LOG_MAX);
    }
}

const rawConsoleLog = console.log.bind(console);
const rawConsoleWarn = console.warn.bind(console);
const rawConsoleError = console.error.bind(console);
console.log = (...args) => { appendManagerLog('INFO', args); rawConsoleLog(...args); };
console.warn = (...args) => { appendManagerLog('WARN', args); rawConsoleWarn(...args); };
console.error = (...args) => { appendManagerLog('ERROR', args); rawConsoleError(...args); };

// ==========================================
// 2. 中间件配置
// ==========================================

if (bodyParser) {
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
} else {
    app.use(express.json({ limit: '50mb' }));
}

if (cors) app.use(cors());
app.use(express.static(__dirname));

// ==========================================
// 3. 辅助函数 & 基础接口
// ==========================================

function launchBatInNewConsole(batPath) {
    try {
        if (!fs.existsSync(batPath)) {
            return { ok: false, error: `脚本不存在: ${batPath}` };
        }
        const child = spawn(
            'cmd.exe',
            ['/c', 'start', '""', 'cmd.exe', '/k', batPath],
            {
                cwd: path.dirname(batPath),
                detached: true,
                windowsHide: false,
                stdio: 'ignore'
            }
        );
        child.unref();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function launchNodeScriptInNewConsole(scriptPath) {
    try {
        if (!fs.existsSync(scriptPath)) {
            return { ok: false, error: `脚本不存在: ${scriptPath}` };
        }
        const child = spawn(
            'cmd.exe',
            ['/c', 'start', '""', 'cmd.exe', '/k', 'node', scriptPath],
            {
                cwd: path.dirname(scriptPath),
                detached: true,
                windowsHide: false,
                stdio: 'ignore'
            }
        );
        child.unref();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function launchNodeScriptWithLog(scriptPath, appName, action, extraArgs = []) {
    try {
        if (!fs.existsSync(scriptPath)) {
            return { ok: false, error: `脚本不存在: ${scriptPath}` };
        }
        const logFile = makeLogFilePath(LOGS_DIR, appName, action);
        const out = fs.createWriteStream(logFile, { flags: 'a' });
        out.on('error', (err) => {
            console.error(`[log-stream] ${path.basename(logFile)} error: ${err.message}`);
        });
        if (!out.writableEnded && !out.destroyed) {
            out.write(`[${new Date().toISOString()}] start ${action} app=${appName}\n`);
        }

        const child = spawn('node', [scriptPath, ...extraArgs], {
            cwd: path.dirname(scriptPath),
            detached: true,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        if (child.stdout) child.stdout.pipe(out, { end: false });
        if (child.stderr) child.stderr.pipe(out, { end: false });
        if (action === 'start' && child.pid) {
            if (!managedAppPids.has(appName)) managedAppPids.set(appName, new Set());
            managedAppPids.get(appName).add(child.pid);
        }
        child.on('close', (code) => {
            if (action === 'start' && child.pid && managedAppPids.has(appName)) {
                managedAppPids.get(appName).delete(child.pid);
                if (managedAppPids.get(appName).size === 0) managedAppPids.delete(appName);
            }
            try {
                if (!out.writableEnded && !out.destroyed) {
                    out.write(`\n[${new Date().toISOString()}] exit code=${code}\n`);
                    out.end();
                }
            } catch (_) {}
        });
        child.unref();
        return { ok: true, logFile: path.basename(logFile), pid: child.pid || null };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function readExitCodeFromLog(logPath) {
    if (!logPath || !fs.existsSync(logPath)) return null;
    try {
        const txt = fs.readFileSync(logPath, 'utf-8');
        const m = txt.match(/exit code=(\d+)/g);
        if (!m || !m.length) return null;
        const last = m[m.length - 1].match(/exit code=(\d+)/);
        if (!last) return null;
        return parseInt(last[1], 10);
    } catch (_) {
        return null;
    }
}

async function waitForStartResult({ port, logPath, timeoutMs = 20000, intervalMs = 500 }) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (port > 0) {
            const occupied = await isPortInUse(port);
            if (occupied) return { ok: true };
        }
        const exitCode = readExitCodeFromLog(logPath);
        if (Number.isInteger(exitCode) && exitCode !== 0) {
            return { ok: false, reason: `启动脚本失败，exit code=${exitCode}` };
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { ok: false, reason: `应用启动超时，端口 ${port} 未监听，请查看日志` };
}

function cleanupManagedAppsOnExit() {
    const all = [];
    managedAppPids.forEach((pidSet, appName) => {
        pidSet.forEach((pid) => all.push({ appName, pid }));
    });
    if (!all.length) return;
    console.log(`[shutdown] stopping managed app processes: ${all.length}`);
    all.forEach(({ appName, pid }) => {
        const ok = killPidTree(pid);
        console.log(`[shutdown] ${ok ? 'stopped' : 'skip'} app=${appName} pid=${pid}`);
    });
}

let isShuttingDown = false;
function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[shutdown] signal=${signal || 'exit'} begin cleanup`);
    cleanupManagedAppsOnExit();
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

app.use('/api', createAppRuntimeRouter({
    managerDir: __dirname,
    settingFile: SETTING_FILE,
    baselineDepsFile: BASELINE_DEPS_FILE,
    logsDir: LOGS_DIR,
    readSettings,
    getInjectScriptRoot,
    ensureAppScriptSource,
    getSetupPreview,
    isPortInUse,
    getListeningPidsByPort,
    isPidOwnedByTargetPath,
    killPidTree,
    waitForPortFree,
    getNodePidsByAppName,
    writeActionLog,
    launchNodeScriptWithLog,
    launchBatInNewConsole,
    waitForStartResult
}));

app.use('/api', createLogsRouter({
    logsDir: LOGS_DIR,
    managerLogs,
    ensureLogsDir,
    getLatestLogByApp,
    getLatestLogAny,
    stripAnsi
}));

const toolsFactory = loadOptionalRouterFactory(
    path.join(__dirname, 'app_tools', 'tools.js'),
    'createToolsRouter'
);
if (toolsFactory) {
    app.use('/api', toolsFactory());
    console.log('[optional-router] mounted app_tools/tools.js');
} else {
    console.log('[optional-router] skip app_tools/tools.js');
}

const promptFactory = loadOptionalRouterFactory(
    path.join(__dirname, 'app_tools', 'prompt.js'),
    'createPromptRouter'
);
if (promptFactory) {
    app.use('/api', promptFactory());
    console.log('[optional-router] mounted app_tools/prompt.js');
} else {
    console.log('[optional-router] skip app_tools/prompt.js');
}

// ==========================================
// 4. [核心] 动态加载 APP 插件
// ==========================================
const appsDir = path.join(__dirname, 'apps');
if (fs.existsSync(appsDir)) {
    console.log("---------------------------------------");
    console.log("[AppManager] Loading App Modules (Lazy Mode):");
    const pluginFiles = [];
    const walkPlugins = (dir) => {
        fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) return walkPlugins(full);
            if (entry.isFile() && entry.name.endsWith('.js')) pluginFiles.push(full);
        });
    };
    walkPlugins(appsDir);

    pluginFiles.forEach((full) => {
        try {
            const rel = path.relative(appsDir, full).replace(/\\/g, '/');
            const withoutExt = rel.replace(/\.js$/i, '');
            const routeName = withoutExt.endsWith('/index')
                ? withoutExt.slice(0, -('/index'.length))
                : withoutExt;
            const routePath = `/api/app/${routeName}`;
            const router = require(full);
            app.use(routePath, router);
            console.log(`   [+] Mounted: ${routePath}`);
        } catch (e) {
            console.error(`   [!] Failed to load ${path.relative(appsDir, full)}:`, e.message);
        }
    });
    console.log("---------------------------------------");
}

// ==========================================
// 5. 启动服务
// ==========================================
app.listen(PORT, async () => {
    console.log(`管理后台已启动: http://localhost:${PORT}/dashboard.html`);
    const openDep = modulesConfig.dependencies['open'];
    if (openDep && openDep.enabled) {
        try { const open = await import('open'); open.default(`http://localhost:${PORT}/dashboard.html`); } catch (e) {}
    }
});




