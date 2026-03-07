const fs = require('fs');
const path = require('path');
const ExcelGen = require('./app_tools/public/ExcelGenerator');

console.log("=== Standalone Excel Exporter ===");

// 1. 获取输入文件（JSON 备份）
const sourceFile = process.argv[2];
if (!sourceFile) {
    console.error("Usage: node cmd_excel_export.js <path_to_backup.json>");
    process.exit(1);
}

if (!ExcelGen.isEnabled()) {
    console.error("Error: 'xlsx' module is not installed.");
    process.exit(1);
}

// 2. 读取数据
try {
    const raw = fs.readFileSync(sourceFile, 'utf-8');
    const data = JSON.parse(raw);

    // 校验数据完整性
    if (!data.nodes || !data.excelConfigs) {
        throw new Error("Invalid JSON. Please use the 'Full Backup' file.");
    }

    const exportPath = data.config?.excelExportPath || path.join(__dirname, '../ExcelOutput');
    const nodes = data.nodes;
    const excelConfigs = data.excelConfigs;

    console.log(`Source: ${path.basename(sourceFile)}`);
    console.log(`Target: ${exportPath}`);

    // 3. 复刻前端的数据转换逻辑（Node.js 版）
    // 这里把前端生成 Matrix 的逻辑搬到后端脚本中
    function generateMatrix(type) {
        const config = excelConfigs[type];
        if (!config) return null;

        let rawData = [];
        if (type === 'scenes') {
            rawData = nodes;
        } else if (type === 'subscenes') {
            nodes.forEach(n => {
                if (n.subScenes) {
                    n.subScenes.forEach(sub => {
                        rawData.push({ parentId: n.id, parentName: n.name, ...sub });
                    });
                }
            });
        } else if (type === 'conditions') {
            rawData = data.conditions || [];
        }

        const enabledFields = config.fields.filter(f => f.enabled);

        // 生成表头
        const row1 = ["#", config.tableName, ...Array(Math.max(0, enabledFields.length - 2)).fill("")];
        const row2 = ["#", ...enabledFields.map(f => f.flag)];
        const row3 = ["#", ...enabledFields.map(f => f.type)];
        const row4 = ["#", ...enabledFields.map(f => f.exportKey)];
        const row5 = ["#", ...enabledFields.map(f => f.desc)];

        // 生成数据
        const dataRows = rawData.map(row => {
            const r = [""];
            enabledFields.forEach(field => {
                let val = row[field.key];
                
                // 类型转换逻辑
                if (field.key === 'position' && val) val = `${val.x},${val.y}`;
                if (field.type === 'bool') val = val ? 'TRUE' : 'FALSE';
                // 简单的枚举转换（示例）
                if (field.key === 'type' && val === 'default') val = 1;
                if (field.key === 'type' && val === 'hub') val = 99;

                if (val === undefined || val === null) val = "";
                r.push(val);
            });
            return r;
        });

        return [row1, row2, row3, row4, row5, ...dataRows];
    }

    // 4. 执行导出
    const filesToExport = [];
    ['scenes', 'subscenes', 'conditions'].forEach(type => {
        const matrix = generateMatrix(type);
        if (matrix) {
            filesToExport.push({
                fileName: excelConfigs[type].fileName,
                sheetName: excelConfigs[type].sheetName,
                dataMatrix: matrix
            });
        }
    });

    const results = ExcelGen.exportExcel(exportPath, filesToExport);
    console.log(`\nSuccess! Exported ${results.length} files.`);

} catch (e) {
    console.error("Export failed:", e.message);
}
