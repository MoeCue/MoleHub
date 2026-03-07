const fs = require('fs');
const path = require('path');
const express = require('express');

function createToolsRouter() {
    const router = express.Router();

    router.post('/file/save', (req, res) => {
        const { filePath, content, isBinary } = req.body;
        if (!filePath) return res.status(400).json({ error: '文件路径不能为空' });

        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            if (isBinary) {
                fs.writeFileSync(filePath, Buffer.from(content, 'base64'));
            } else {
                const dataToWrite = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
                fs.writeFileSync(filePath, dataToWrite, 'utf-8');
            }

            console.log(`[File Saved] ${filePath}`);
            res.json({ success: true, message: `已保存到 ${filePath}` });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/export/excel-all', (req, res) => {
        try {
            const ExcelGen = require('./public/ExcelGenerator');
            const { exportPath, files } = req.body;
            const results = ExcelGen.exportExcel(exportPath, files);
            console.log(`[Excel] 成功生成 ${results.length} 个文件`);
            res.json({ success: true, count: results.length, message: results.join(', ') });
        } catch (e) {
            console.error('Excel 导出失败:', e);
            res.status(500).json({ error: e.message });
        }
    });

    return router;
}

module.exports = { createToolsRouter };


