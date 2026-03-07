const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log("Checking dependencies configuration...");

const configPath = path.join(__dirname, 'modules.json');
if (!fs.existsSync(configPath)) {
    console.error("Error: modules.json not found in AppManager!");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const deps = config.dependencies;
let missingDeps = [];

for (const [pkg, options] of Object.entries(deps)) {
    // 只有 enabled: true 的才检查
    if (options.enabled) {
        try {
            // 尝试解析模块路径，如果报错说明没安装
            require.resolve(pkg);
        } catch (e) {
            console.warn(`[MISSING] ${pkg} (${options.desc})`);
            const versionStr = options.version ? `@${options.version}` : '';
            missingDeps.push(pkg + versionStr);
        }
    }
}

if (missingDeps.length > 0) {
    console.log(`\nInstalling ${missingDeps.length} missing dependencies...`);
    try {
        const cmd = `npm install ${missingDeps.join(' ')}`;
        console.log(`> ${cmd}`);
        // 同步执行安装命令
        execSync(cmd, { stdio: 'inherit', cwd: __dirname });
        console.log("Dependencies fixed.");
    } catch (e) {
        console.error("Installation failed. Please check your network.");
        process.exit(1);
    }
} else {
    console.log("Dependencies check passed.");
}