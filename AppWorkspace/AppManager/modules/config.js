const fs = require('fs');
const path = require('path');

function resolveManagerPort(settingFile, defaultPort = 3000) {
    if (!fs.existsSync(settingFile)) return defaultPort;
    try {
        const settings = JSON.parse(fs.readFileSync(settingFile, 'utf-8'));
        const rawPort = settings ? settings.managerPort : null;
        const parsed = parseInt(rawPort, 10);
        if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) {
            return parsed;
        }
    } catch (_) {}
    return defaultPort;
}

function readSettings(settingFile) {
    if (!fs.existsSync(settingFile)) return null;
    try {
        return JSON.parse(fs.readFileSync(settingFile, 'utf-8'));
    } catch (_) {
        return null;
    }
}

function getScriptSrcRoot(managerDir, settings) {
    const sourceDirName = (settings && settings.paths && settings.paths.scriptSrcDir)
        ? settings.paths.scriptSrcDir
        : 'AppScriptSrc';
    return path.join(managerDir, '..', sourceDirName);
}

function getInjectScriptRoot(managerDir, settings) {
    const injectDirName = (settings && settings.paths && settings.paths.injectScriptDir)
        ? settings.paths.injectScriptDir
        : 'AppScripts';
    return path.join(managerDir, '..', injectDirName);
}

function buildDefaultMainSource(appName, srcRootPath) {
    const safeApp = String(appName || '').replace(/[`$\\]/g, '');
    const safePath = String(srcRootPath || '').replace(/\\/g, '/').replace(/[`$]/g, '');
    return `export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'Arial, sans-serif' }}>
      <h1>${safeApp}</h1>
      <p>未找到脚本，请在 ${safePath}/${safeApp}/ 下添加脚本，命名为 main.js</p>
    </div>
  );
}
`;
}

function ensureAppScriptSource(managerDir, settingFile, appName, scriptFileName, options = {}) {
    if (!appName) return;
    const forceSync = !!options.forceSync;
    const settings = readSettings(settingFile) || {};
    const scriptSrcRoot = getScriptSrcRoot(managerDir, settings);
    const injectRoot = getInjectScriptRoot(managerDir, settings);
    const appDir = path.join(scriptSrcRoot, appName);
    const targetMain = path.join(appDir, 'main.jsx');
    fs.mkdirSync(appDir, { recursive: true });

    const safeScript = path.basename(String(scriptFileName || ''));
    const injectFilePath = safeScript ? path.join(injectRoot, safeScript) : null;
    if (injectFilePath && fs.existsSync(injectFilePath) && (forceSync || !fs.existsSync(targetMain))) {
        const content = fs.readFileSync(injectFilePath, 'utf-8');
        const trimmed = String(content || '').trimStart();
        if (trimmed.startsWith('!') || trimmed.length === 0) {
            const fallback = buildDefaultMainSource(appName, scriptSrcRoot);
            fs.writeFileSync(targetMain, fallback, 'utf-8');
        } else {
            fs.writeFileSync(targetMain, content, 'utf-8');
        }
        return;
    }

    if (fs.existsSync(targetMain)) return;

    const defaultMain = buildDefaultMainSource(appName, scriptSrcRoot);
    fs.writeFileSync(targetMain, defaultMain, 'utf-8');
}

function parseExtraDeps(depString) {
    return String(depString || '')
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean);
}

function readBaselineDeps(baselineDepsFile) {
    if (!fs.existsSync(baselineDepsFile)) {
        return { dependencies: {}, devDependencies: {} };
    }
    try {
        const data = JSON.parse(fs.readFileSync(baselineDepsFile, 'utf-8'));
        return {
            dependencies: data.dependencies || {},
            devDependencies: data.devDependencies || {}
        };
    } catch (_) {
        return { dependencies: {}, devDependencies: {} };
    }
}

function isDepInstalled(projectPath, depName) {
    if (!depName) return false;
    if (depName.startsWith('@')) {
        const parts = depName.split('/');
        if (parts.length < 2) return false;
        return fs.existsSync(path.join(projectPath, 'node_modules', parts[0], parts[1]));
    }
    return fs.existsSync(path.join(projectPath, 'node_modules', depName));
}

function getSetupPreview(managerDir, settingFile, baselineDepsFile, appName) {
    const data = readSettings(settingFile);
    if (!data || !data.apps || !data.apps[appName]) {
        return { error: `未找到应用配置: ${appName}` };
    }

    const projDirName = (data.paths && data.paths.projectDir) ? data.paths.projectDir : 'Apps';
    const appCfg = data.apps[appName] || {};
    const appPath = path.join(managerDir, '..', projDirName, appName);
    const nodeModulesPath = path.join(appPath, 'node_modules');
    const appExists = fs.existsSync(appPath);
    const nodeModulesExists = fs.existsSync(nodeModulesPath);

    const baseline = readBaselineDeps(baselineDepsFile);
    const depCandidates = new Set(Object.keys(baseline.dependencies || {}));
    parseExtraDeps(appCfg.dependencies).forEach((d) => depCandidates.add(d));
    const devDepCandidates = new Set(Object.keys(baseline.devDependencies || {}));

    const toInstall = [];
    if (!appExists || !nodeModulesExists) {
        depCandidates.forEach((name) => toInstall.push({ name, section: 'dependencies' }));
        devDepCandidates.forEach((name) => toInstall.push({ name, section: 'devDependencies' }));
    } else {
        depCandidates.forEach((name) => {
            if (!isDepInstalled(appPath, name)) {
                toInstall.push({ name, section: 'dependencies' });
            }
        });
        devDepCandidates.forEach((name) => {
            if (!isDepInstalled(appPath, name)) {
                toInstall.push({ name, section: 'devDependencies' });
            }
        });
    }

    toInstall.sort((a, b) => a.name.localeCompare(b.name));
    return {
        appName,
        projectPath: appPath,
        appExists,
        nodeModulesExists,
        toInstall,
        total: toInstall.length
    };
}

module.exports = {
    resolveManagerPort,
    readSettings,
    getScriptSrcRoot,
    getInjectScriptRoot,
    ensureAppScriptSource,
    getSetupPreview
};
