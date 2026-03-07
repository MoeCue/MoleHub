const fs = require('fs');
const path = require('path');

function ensureLogsDir(logsDir) {
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
}

function safeAppName(appName) {
    return String(appName || '')
        .replace(/[^a-zA-Z0-9_.-]/g, '_')
        .slice(0, 80) || 'unknown_app';
}

function tsForFile() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function makeLogFilePath(logsDir, appName, action) {
    ensureLogsDir(logsDir);
    return path.join(logsDir, `${safeAppName(appName)}-${action}-${tsForFile()}.log`);
}

function writeActionLog(logsDir, appName, action, lines) {
    try {
        const logFile = makeLogFilePath(logsDir, appName, action);
        const content = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
        fs.writeFileSync(logFile, content, 'utf-8');
        return path.basename(logFile);
    } catch (_) {
        return null;
    }
}

function getLatestLogByApp(logsDir, appName) {
    ensureLogsDir(logsDir);
    const prefix = `${safeAppName(appName)}-`;
    const files = fs.readdirSync(logsDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.log'))
        .map((f) => ({
            file: f,
            fullPath: path.join(logsDir, f),
            mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0] : null;
}

function getLatestLogAny(logsDir) {
    ensureLogsDir(logsDir);
    const files = fs.readdirSync(logsDir)
        .filter((f) => f.endsWith('.log'))
        .map((f) => ({
            file: f,
            fullPath: path.join(logsDir, f),
            mtime: fs.statSync(path.join(logsDir, f)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);
    return files.length ? files[0] : null;
}

function stripAnsi(text) {
    return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

module.exports = {
    ensureLogsDir,
    safeAppName,
    makeLogFilePath,
    writeActionLog,
    getLatestLogByApp,
    getLatestLogAny,
    stripAnsi
};
