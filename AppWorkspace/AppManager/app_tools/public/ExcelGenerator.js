const fs = require('fs');
const path = require('path');

// [优化] 移除顶部的 require('xlsx')，避免启动时卡顿
// let XLSX = require('xlsx'); <--- 删掉这行

// 内部缓存变量
let _xlsxCache = null;

// 辅助函数：按需加载
function loadXLSX() {
    if (_xlsxCache) return _xlsxCache;
    try {
        console.log("[ExcelGenerator] 正在初始化 Excel 引擎 (Lazy Load)...");
        _xlsxCache = require('xlsx');
        return _xlsxCache;
    } catch (e) {
        return null;
    }
}

function exportExcel(exportPath, fileConfigs) {
    // [优化] 在调用时才加载
    const XLSX = loadXLSX();
    if (!XLSX) throw new Error("XLSX module is not installed. (npm install xlsx)");

    if (!fs.existsSync(exportPath)) {
        fs.mkdirSync(exportPath, { recursive: true });
    }

    const results = [];

    fileConfigs.forEach(file => {
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(file.dataMatrix);
        const sheetName = file.sheetName || "Sheet1";
        
        XLSX.utils.book_append_sheet(wb, ws, sheetName);

        const finalFileName = `${file.fileName}.xlsx`;
        const fullPath = path.join(exportPath, finalFileName);

        XLSX.writeFile(wb, fullPath);
        results.push(finalFileName);
    });

    return results;
}

module.exports = { 
    exportExcel, 
    // 检查是否可用（尝试加载一次）
    isEnabled: () => !!loadXLSX() 
};