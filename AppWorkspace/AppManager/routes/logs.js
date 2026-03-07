const fs = require('fs');
const path = require('path');
const express = require('express');

function createLogsRouter(deps) {
    const {
        logsDir,
        managerLogs,
        ensureLogsDir,
        getLatestLogByApp,
        getLatestLogAny,
        stripAnsi
    } = deps;

    const router = express.Router();

    router.get('/logs/latest', (req, res) => {
        const appName = req.query.appName;
        if (!appName) return res.status(400).json({ success: false, error: 'appName 不能为空' });

        const latest = getLatestLogByApp(logsDir, appName) || getLatestLogAny(logsDir);
        if (!latest) return res.json({ success: true, appName, file: null, content: '' });

        const content = stripAnsi(fs.readFileSync(latest.fullPath, 'utf-8'));
        res.json({
            success: true,
            appName,
            file: latest.file,
            content,
            updatedAt: new Date(latest.mtime).toISOString()
        });
    });

    router.get('/logs/manager', (req, res) => {
        res.json({
            success: true,
            content: managerLogs.join('\n'),
            count: managerLogs.length
        });
    });

    router.post('/logs/clear', (req, res) => {
        try {
            ensureLogsDir(logsDir);
            const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
            let deleted = 0;
            files.forEach((f) => {
                const full = path.join(logsDir, f);
                if (fs.existsSync(full)) {
                    fs.unlinkSync(full);
                    deleted += 1;
                }
            });
            res.json({ success: true, deleted });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    return router;
}

module.exports = { createLogsRouter };
