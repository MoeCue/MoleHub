const { spawnSync } = require('child_process');
const net = require('net');

function getListeningPidsByPort(port) {
    if (!port) return [];
    try {
        const psScript = `$port=${parseInt(port, 10)}; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ConvertTo-Json -Compress`;
        const psResult = spawnSync(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
            { encoding: 'utf8', windowsHide: true }
        );
        if (psResult.status === 0 && psResult.stdout) {
            const raw = String(psResult.stdout).trim();
            if (raw) {
                const parsed = JSON.parse(raw);
                const arr = Array.isArray(parsed) ? parsed : [parsed];
                const pids = arr
                    .map((x) => parseInt(x, 10))
                    .filter((x) => Number.isInteger(x) && x > 0);
                if (pids.length > 0) {
                    return Array.from(new Set(pids));
                }
            }
        }
    } catch (_) {}

    try {
        const cmd = `netstat -ano -p tcp | findstr :${port}`;
        const result = spawnSync('cmd.exe', ['/c', cmd], { encoding: 'utf8' });
        if (result.status !== 0 || !result.stdout) return [];
        const lines = String(result.stdout).split(/\r?\n/).filter(Boolean);
        const pids = new Set();
        lines.forEach((line) => {
            if (!/LISTENING|侦听/i.test(line)) return;
            const parts = line.trim().split(/\s+/);
            const pid = parseInt(parts[parts.length - 1], 10);
            if (pid > 0) pids.add(pid);
        });
        return Array.from(pids);
    } catch (_) {
        return [];
    }
}

function killPidTree(pid) {
    if (!pid) return false;
    try {
        const result = spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' });
        return result.status === 0;
    } catch (_) {
        return false;
    }
}

function getProcessCommandLine(pid) {
    if (!pid) return '';
    try {
        const psScript = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if($p){$p.CommandLine}`;
        const result = spawnSync(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
            { encoding: 'utf8', windowsHide: true }
        );
        if (result.status !== 0) return '';
        return String(result.stdout || '').trim();
    } catch (_) {
        return '';
    }
}

function isPidOwnedByTargetPath(pid, targetPath) {
    const cmdline = getProcessCommandLine(pid);
    if (!cmdline) return { matched: false, cmdline: '' };
    const normalizedCmd = cmdline.toLowerCase().replace(/\//g, '\\');
    const normalizedTarget = String(targetPath || '').toLowerCase().replace(/\//g, '\\');
    return { matched: normalizedCmd.includes(normalizedTarget), cmdline };
}

function getNodePidsByAppName(appName) {
    const needle = `\\\\apps\\\\${String(appName || '').toLowerCase()}\\\\`.replace(/'/g, "''");
    if (!needle) return [];
    try {
        const psScript = `$needle='${needle}'; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.ToLower().Replace('/','\\').Contains($needle) } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
        const result = spawnSync(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
            { encoding: 'utf8', windowsHide: true }
        );
        if (result.status !== 0 || !result.stdout) return [];
        const data = JSON.parse(String(result.stdout).trim() || '[]');
        const arr = Array.isArray(data) ? data : [data];
        return arr
            .filter((x) => x && x.ProcessId)
            .map((x) => ({ pid: parseInt(x.ProcessId, 10), cmdline: String(x.CommandLine || '') }))
            .filter((x) => x.pid > 0);
    } catch (_) {
        return [];
    }
}

function canConnectPort(port, host = '127.0.0.1', timeoutMs = 700) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (_) {}
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, host);
    });
}

async function isPortInUse(port) {
    const byNetstat = getListeningPidsByPort(port);
    if (byNetstat.length > 0) {
        return true;
    }
    if (await canConnectPort(port, '127.0.0.1')) {
        return true;
    }
    if (await canConnectPort(port, 'localhost')) {
        return true;
    }
    return new Promise((resolve) => {
        const tester = net.createServer();
        tester.once('error', (err) => {
            if (err && err.code === 'EADDRINUSE') return resolve(true);
            resolve(false);
        });
        tester.once('listening', () => {
            tester.close(() => resolve(false));
        });
        tester.listen(port);
    });
}

async function waitForPortOpen(port, timeoutMs = 20000, intervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const occupied = await isPortInUse(port);
        if (occupied) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

async function waitForPortFree(port, timeoutMs = 8000, intervalMs = 300) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const occupied = await isPortInUse(port);
        if (!occupied) return true;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

module.exports = {
    getListeningPidsByPort,
    killPidTree,
    getProcessCommandLine,
    isPidOwnedByTargetPath,
    getNodePidsByAppName,
    isPortInUse,
    waitForPortOpen,
    waitForPortFree
};
