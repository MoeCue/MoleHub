const fs = require('fs');
const path = require('path');
const express = require('express');

function createAppRuntimeRouter(deps) {
    const {
        managerDir,
        settingFile,
        baselineDepsFile,
        logsDir,
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
        launchNodeScriptWithLog,
        launchBatInNewConsole,
        waitForStartResult
    } = deps;

    const router = express.Router();

    router.get('/apps', (req, res) => {
        const settings = readSettings(settingFile) || {};
        res.json({
            apps: settings.apps || {},
            newAppDefaults: settings.newAppDefaults || {}
        });
    });

    router.get('/apps/status', async (req, res) => {
        const settings = readSettings(settingFile) || { apps: {} };
        const apps = settings.apps || {};
        const running = {};
        const entries = Object.entries(apps);
        for (const [appName, appCfg] of entries) {
            const port = parseInt(appCfg && appCfg.port, 10);
            if (!port) {
                running[appName] = false;
                continue;
            }
            running[appName] = await isPortInUse(port);
        }
        res.json({ success: true, running });
    });

    router.get('/scripts', (req, res) => {
        const data = readSettings(settingFile);
        const scriptPath = getInjectScriptRoot(managerDir, data);
        if (!fs.existsSync(scriptPath)) return res.json({ files: [] });
        try {
            const files = fs.readdirSync(scriptPath).filter((file) => file.endsWith('.jsx') || file.endsWith('.js'));
            res.json({ files });
        } catch (_) {
            res.json({ files: [] });
        }
    });

    router.post('/save', (req, res) => {
        const { appName, config } = req.body;
        const normalizedName = String(appName || '').toLowerCase();
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedName)) {
            return res.status(400).json({ success: false, error: 'appName 仅支持小写字母、数字和短横线(-)' });
        }

        const data = readSettings(settingFile) || { apps: {} };
        const defaults = data.newAppDefaults || {};
        const defaultTailwindVersion = defaults.tailwindVersion || '3.4.17';
        const defaultDependencies = defaults.dependencies || '';
        if (!data.apps) data.apps = {};
        if (!data.paths) data.paths = {};
        if (!data.paths.injectScriptDir) data.paths.injectScriptDir = 'AppScripts';
        const normalizedConfig = { ...(config || {}) };
        if (!normalizedConfig.tailwindVersion) normalizedConfig.tailwindVersion = defaultTailwindVersion;
        if (!normalizedConfig.dependencies) normalizedConfig.dependencies = defaultDependencies;
        data.apps[normalizedName] = normalizedConfig;

        if (!data.apps[normalizedName].scriptEntry) {
            data.apps[normalizedName].scriptEntry = `${normalizedName}/main.jsx`;
        }

        fs.writeFileSync(settingFile, JSON.stringify(data, null, 2), 'utf-8');
        ensureAppScriptSource(managerDir, settingFile, normalizedName, config ? config.script : null);
        // Create backend plugin folder for this app (supports multiple backend scripts).
        fs.mkdirSync(path.join(managerDir, 'apps', normalizedName), { recursive: true });
        res.json({ success: true });
    });

    router.post('/setup', (req, res) => {
        const { appName } = req.body;
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const settings = readSettings(settingFile);
        const appCfg = settings && settings.apps ? settings.apps[appName] : null;
        ensureAppScriptSource(managerDir, settingFile, appName, appCfg ? appCfg.script : null, { forceSync: true });

        const jsPath = path.join(managerDir, '..', 'AppBoot', 'setup_fast.js');
        const batPath = path.join(managerDir, '..', 'AppBoot', 'setup_fast.bat');
        const launch = fs.existsSync(jsPath)
            ? launchNodeScriptWithLog(jsPath, appName, 'setup', ['--app', appName])
            : launchBatInNewConsole(batPath);

        if (!launch.ok) return res.status(500).json({ success: false, error: launch.error });
        res.json({ success: true, logFile: launch.logFile || null });
    });

    router.post('/setup/preview', (req, res) => {
        const { appName } = req.body || {};
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const preview = getSetupPreview(managerDir, settingFile, baselineDepsFile, appName);
        if (preview.error) return res.status(404).json({ success: false, error: preview.error });
        res.json({ success: true, ...preview });
    });

    router.post('/start', async (req, res) => {
        const { appName } = req.body;
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const settings = readSettings(settingFile);
        const appCfg = settings && settings.apps ? settings.apps[appName] : null;
        if (!appCfg) {
            return res.status(404).json({ success: false, error: `未找到应用配置: ${appName}` });
        }

        const appPort = appCfg ? parseInt(appCfg.port, 10) : 0;
        const projectDir = (settings && settings.paths && settings.paths.projectDir) ? settings.paths.projectDir : 'Apps';
        const srcDir = (settings && settings.paths && settings.paths.scriptSrcDir) ? settings.paths.scriptSrcDir : 'AppScriptSrc';
        const targetPath = path.join(managerDir, '..', projectDir, appName);
        const packageJsonPath = path.join(targetPath, 'package.json');
        const scriptEntry = appCfg.scriptEntry || `${appName}/main.jsx`;
        const scriptEntryPath = path.join(managerDir, '..', srcDir, scriptEntry);

        if (!fs.existsSync(packageJsonPath)) {
            return res.status(400).json({ success: false, error: '应用未安装，请先点击“安装/修复”' });
        }
        if (!fs.existsSync(scriptEntryPath)) {
            return res.status(400).json({ success: false, error: '脚本不存在，请先在 AppScriptSrc 下补齐脚本并执行“安装/修复”' });
        }

        if (appPort > 0) {
            const occupied = await isPortInUse(appPort);
            const pids = getListeningPidsByPort(appPort);

            if (occupied) {
                const ownPids = [];
                const foreignPids = [];

                pids.forEach((pid) => {
                    const match = isPidOwnedByTargetPath(pid, targetPath);
                    if (match.matched) {
                        ownPids.push({ pid, cmdline: match.cmdline });
                    } else {
                        foreignPids.push({ pid, cmdline: match.cmdline || '' });
                    }
                });

                if (ownPids.length > 0) {
                    console.log(`[start-check] port ${appPort} occupied by same app, stopping stale process...`);
                    ownPids.forEach((x) => console.log(`[start-check] own pid=${x.pid} cmd=${x.cmdline}`));
                    ownPids.forEach((x) => killPidTree(x.pid));
                    const free = await waitForPortFree(appPort, 8000, 300);
                    if (!free) {
                        return res.status(500).json({
                            success: false,
                            error: `端口 ${appPort} 无法释放，请手动关闭后重试`,
                            port: appPort
                        });
                    }
                }

                if (foreignPids.length > 0) {
                    foreignPids.forEach((x) => console.log(`[start-check] foreign pid=${x.pid} cmd=${x.cmdline}`));
                    return res.status(409).json({
                        success: false,
                        error: `端口被其他进程占用（${appPort}）`,
                        port: appPort,
                        occupiedByOther: true,
                        holders: foreignPids.map((x) => ({ pid: x.pid, cmdline: x.cmdline.slice(0, 240) }))
                    });
                }

                if (pids.length === 0) {
                    console.log(`[start-check] port ${appPort} occupied but no pid resolved by netstat`);
                    return res.json({
                        success: true,
                        alreadyRunning: true,
                        unresolvedOwner: true,
                        port: appPort,
                        url: `http://localhost:${appPort}`
                    });
                }
            }
        }

        const jsPath = path.join(managerDir, '..', 'AppBoot', 'start.js');
        const batPath = path.join(managerDir, '..', 'AppBoot', 'start.bat');
        const launch = fs.existsSync(jsPath)
            ? launchNodeScriptWithLog(jsPath, appName, 'start', ['--app', appName])
            : launchBatInNewConsole(batPath);

        if (!launch.ok) return res.status(500).json({ success: false, error: launch.error });

        if (appPort > 0 && launch.logFile) {
            const logPath = path.join(logsDir, launch.logFile);
            const startResult = await waitForStartResult({ port: appPort, logPath, timeoutMs: 20000, intervalMs: 500 });
            if (!startResult.ok) {
                return res.status(500).json({
                    success: false,
                    error: startResult.reason,
                    logFile: launch.logFile || null
                });
            }
        }

        res.json({
            success: true,
            logFile: launch.logFile || null,
            port: appPort || null,
            url: appPort ? `http://localhost:${appPort}` : null
        });
    });

    router.post('/stop', async (req, res) => {
        const { appName } = req.body || {};
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const settings = readSettings(settingFile);
        const appCfg = settings && settings.apps ? settings.apps[appName] : null;
        const appPort = appCfg ? parseInt(appCfg.port, 10) : 0;
        if (!appPort) return res.status(404).json({ success: false, error: `未找到应用端口: ${appName}` });

        const projectDir = (settings && settings.paths && settings.paths.projectDir) ? settings.paths.projectDir : 'Apps';
        const targetPath = path.join(managerDir, '..', projectDir, appName);
        const occupied = await isPortInUse(appPort);

        if (!occupied) {
            const stopLog = deps.writeActionLog(logsDir, appName, 'stop', [
                `[${new Date().toISOString()}] stop app=${appName}`,
                `[stop-check] port=${appPort} already free`
            ]);
            return res.json({ success: true, appName, port: appPort, stopped: 0, released: true, message: '端口已释放', logFile: stopLog });
        }

        const ownPids = [];
        const foreignPids = [];
        const pids = getListeningPidsByPort(appPort);

        if (!pids.length) {
            console.log(`[stop-check] port ${appPort} occupied but no pid resolved by netstat, fallback scan by app path`);
            const guessed = getNodePidsByAppName(appName);
            if (guessed.length === 0) {
                return res.status(409).json({
                    success: false,
                    appName,
                    port: appPort,
                    occupiedByOther: true,
                    error: `端口 ${appPort} 被占用，但未能识别占用进程`
                });
            }
            guessed.forEach((x) => ownPids.push({ pid: x.pid, cmdline: x.cmdline || '' }));
        } else {
            pids.forEach((pid) => {
                const match = isPidOwnedByTargetPath(pid, targetPath);
                if (match.matched) {
                    ownPids.push({ pid, cmdline: match.cmdline || '' });
                } else {
                    foreignPids.push({
                        pid,
                        cmdline: match.cmdline ? match.cmdline.slice(0, 240) : ''
                    });
                }
            });
        }

        if (!ownPids.length && foreignPids.length) {
            foreignPids.forEach((x) => console.log(`[stop-check] foreign pid=${x.pid} cmd=${x.cmdline}`));
            return res.status(409).json({
                success: false,
                error: `端口 ${appPort} 被其他进程占用，无法停止`,
                appName,
                port: appPort,
                occupiedByOther: true,
                foreignPids
            });
        }

        ownPids.forEach((x) => console.log(`[stop-check] own pid=${x.pid} cmd=${x.cmdline}`));
        const killed = ownPids.filter((x) => killPidTree(x.pid)).map((x) => x.pid);
        const released = await waitForPortFree(appPort, 8000, 300);
        const stopLog = deps.writeActionLog(logsDir, appName, 'stop', [
            `[${new Date().toISOString()}] stop app=${appName}`,
            `[stop-check] port=${appPort}`,
            `[stop-check] ownPids=${ownPids.map((x) => x.pid).join(',') || '-'}`,
            `[stop-check] killed=${killed.join(',') || '-'}`,
            `[stop-check] released=${released}`
        ]);

        if (!released) {
            return res.status(500).json({
                success: false,
                appName,
                port: appPort,
                stopped: killed.length,
                released: false,
                logFile: stopLog,
                error: `停止后端口 ${appPort} 仍被占用`
            });
        }

        res.json({
            success: true,
            appName,
            port: appPort,
            stopped: killed.length,
            pids: killed,
            blocked: foreignPids,
            released: true,
            logFile: stopLog
        });
    });

    router.post('/uninstall/preview', async (req, res) => {
        const { appName } = req.body || {};
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const settings = readSettings(settingFile) || {};
        const appCfg = settings && settings.apps ? settings.apps[appName] : null;
        if (!appCfg) {
            return res.status(404).json({ success: false, error: `未找到应用配置: ${appName}` });
        }

        const port = parseInt(appCfg.port, 10) || 0;
        const running = port > 0 ? await isPortInUse(port) : false;
        const projectDir = (settings.paths && settings.paths.projectDir) ? settings.paths.projectDir : 'Apps';
        const scriptSrcDir = (settings.paths && settings.paths.scriptSrcDir) ? settings.paths.scriptSrcDir : 'AppScriptSrc';
        const appPath = path.join(managerDir, '..', projectDir, appName);
        const scriptSrcPath = path.join(managerDir, '..', scriptSrcDir, appName);
        const logsRoot = path.join(managerDir, '..', 'Logs');
        let logFiles = [];
        if (fs.existsSync(logsRoot)) {
            logFiles = fs.readdirSync(logsRoot)
                .filter((f) => f.startsWith(`${appName}-`) && f.endsWith('.log'))
                .map((f) => path.join(logsRoot, f));
        }

        const backendDir = path.join(managerDir, 'apps');
        const backendFiles = [];
        if (fs.existsSync(backendDir)) {
            const appBackendDir = path.join(backendDir, appName);
            if (fs.existsSync(appBackendDir)) {
                const walk = (dir) => {
                    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
                        const full = path.join(dir, entry.name);
                        if (entry.isDirectory()) return walk(full);
                        if (entry.isFile() && entry.name.endsWith('.js')) backendFiles.push(full);
                    });
                };
                walk(appBackendDir);
            }

            // Legacy flat files under apps/ (backward compatibility)
            const needle = String(appName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const files = fs.readdirSync(backendDir).filter((f) => f.endsWith('.js'));
            files.forEach((f) => {
                const full = path.join(backendDir, f);
                const base = f.toLowerCase().replace(/[^a-z0-9]/g, '');
                let matched = base.includes(needle);
                if (!matched) {
                    try {
                        const content = fs.readFileSync(full, 'utf-8').toLowerCase();
                        matched = content.includes(String(appName || '').toLowerCase());
                    } catch (_) {}
                }
                if (matched) backendFiles.push(full);
            });
        }

        const targets = [appPath, scriptSrcPath, ...logFiles]
            .map((p) => path.resolve(p))
            .filter((p, idx, arr) => arr.indexOf(p) === idx);

        const existing = targets.filter((p) => fs.existsSync(p));
        const missing = targets.filter((p) => !fs.existsSync(p));

        res.json({
            success: true,
            appName,
            running,
            port,
            targets: existing,
            backendFiles,
            missing
        });
    });

    router.post('/uninstall', async (req, res) => {
        const { appName, targets } = req.body || {};
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const settings = readSettings(settingFile) || {};
        const appCfg = settings && settings.apps ? settings.apps[appName] : null;
        if (!appCfg) {
            return res.status(404).json({ success: false, error: `未找到应用配置: ${appName}` });
        }

        const port = parseInt(appCfg.port, 10) || 0;
        if (port > 0 && await isPortInUse(port)) {
            return res.status(409).json({ success: false, error: '正在运行，请先停止App', running: true, port });
        }

        const safeTargets = Array.isArray(targets) ? targets.map((x) => String(x || '').trim()).filter(Boolean) : [];
        const workspaceRoot = path.resolve(managerDir, '..');
        const deleted = [];
        const failed = [];
        const skipped = [];

        safeTargets.forEach((rawPath) => {
            const resolved = path.resolve(rawPath);
            if (!resolved.startsWith(workspaceRoot)) {
                skipped.push({ path: rawPath, reason: '路径不在 AppWorkspace 下' });
                return;
            }
            if (!fs.existsSync(resolved)) {
                skipped.push({ path: resolved, reason: '路径不存在' });
                return;
            }
            try {
                fs.rmSync(resolved, { recursive: true, force: true });
                deleted.push(resolved);
            } catch (e) {
                failed.push({ path: resolved, error: e.message });
            }
        });

        if (!settings.apps) settings.apps = {};
        delete settings.apps[appName];
        fs.writeFileSync(settingFile, JSON.stringify(settings, null, 2), 'utf-8');

        if (failed.length > 0) {
            return res.status(500).json({
                success: false,
                appName,
                deleted,
                skipped,
                failed,
                error: '部分文件删除失败，配置已清理'
            });
        }

        res.json({ success: true, appName, deleted, skipped, configRemoved: true });
    });

    return router;
}

module.exports = { createAppRuntimeRouter };
