# MoleHub
鼹鼠工具仓，是一个本地多 App 开发与管理框架，专门适配 Gemini Canvas 生成的前端脚本。你可以把 Canvas 产出的 React/JSX 文件快速接入到项目中，通过管理后台完成新建、部署、启动、日志查看和卸载，不需要频繁手动敲命令。 它把“AI 生成前端 + 本地后端接入 + 一键运行维护”串成统一流程，适合快速迭代多应用。

更新时间：2026-03-07

## 0. 环境前置（必须先安装）

本项目不会自动安装 Node.js。首次使用前，请先安装 Node.js（建议 LTS 版本）：

- 官方下载页：`https://nodejs.org/`

安装完成后，建议在终端确认：
- `node -v`
- `npm -v`

若以上命令不可用，请先修复 Node.js 环境变量，再继续执行 `Manager.bat`。

当前推荐开发环境（以本仓库维护环境为准）：
- 操作系统：Windows（PowerShell）
- Node.js：`v24.13.0`
- npm：`11.6.2`
- 浏览器：推荐使用 `Google Chrome`

说明：
- 在部分 PowerShell 策略下，`npm -v` 可能被执行策略拦截，可改用 `npm.cmd -v`。

---

## 1. 使用定位（先读）

本项目里 **新建/安装/启动/停止/卸载/日志** 都已预制好，一般不需要二次开发。

普通用户通常只需要开发两类文件（示例）：
- 前端脚本：`AppWorkspace/AppScripts/first_demo_frontend.jsx`
- 后端脚本：`AppWorkspace/AppManager/apps/first-demo/first_demo_backend.js`

提示：如果使用 Gemini 的 Canvas 功能，通常可以先得到一个 `first_demo_frontend.jsx`，再借助 AI 生成 `first_demo_backend.js`。

---

## 2. 用户快速启动

1. 双击 `Manager.bat`
2. 打开总控制台：`http://localhost:3000/dashboard.html`  
   - 这是默认地址（`managerPort=3000`）  
   - 若你把 `setting.json` 里的 `managerPort` 改成 `3100`，则地址是：`http://localhost:3100/dashboard.html`
3. 点击 **新建项目**
4. 项目名填：`first-demo`（命名规则见下）
5. 注入脚本选择：`first_demo_frontend.jsx`
6. 点击 **安装/修复**
7. 点击 **启动 APP**

项目名命名规则（强校验）：
- 正则：`^[a-z0-9]+(?:-[a-z0-9]+)*$`
- 仅允许：小写字母、数字、短横线 `-`
- 示例：`first-demo`

---

## 3. setting.json 说明

根目录：`setting.json`

最小示例：

```json
{
  "managerUrl": "http://localhost",
  "managerPort": 3000,
  "paths": {
    "projectDir": "Apps",
    "scriptSrcDir": "AppScriptSrc",
    "injectScriptDir": "AppScripts"
  },
  "newAppDefaults": {
    "tailwindVersion": "3.4.17",
    "dependencies": "lucide-react clsx tailwind-merge framer-motion xlsx"
  },
  "apps": {
    "first-demo": {
      "port": 5173,
      "script": "first_demo_frontend.jsx",
      "scriptEntry": "first-demo/main.jsx",
      "dependencies": "lucide-react clsx tailwind-merge framer-motion xlsx"
    }
  }
}
```

字段详解：
- `managerPort`
  - 管理后台端口。默认 `3000`。
  - 页面地址规则：`http://localhost:<managerPort>/dashboard.html`

- `managerUrl`
  - 管理后台基础地址。默认 `http://localhost`。
  - 与 `managerPort` 组合后，生成前端代理目标地址（用于 Vite `/api` 代理）。
  - 例如：
  - `managerUrl=http://localhost` + `managerPort=3000` -> `http://localhost:3000`
  - `managerUrl=http://127.0.0.1` + `managerPort=3100` -> `http://127.0.0.1:3100`

- `paths.projectDir`
  - App 运行目录名，默认 `Apps`。
  - 例如 `first-demo` 的运行目录为：`AppWorkspace/Apps/first-demo`

- `paths.scriptSrcDir`
  - App 源码目录名，默认 `AppScriptSrc`。
  - 例如源码入口：`AppWorkspace/AppScriptSrc/first-demo/main.jsx`

- `paths.injectScriptDir`
  - 注入脚本目录名，默认 `AppScripts`。
  - 新建项目时下拉脚本列表从该目录读取。

- `newAppDefaults.tailwindVersion`
  - 新建项目弹窗里默认 Tailwind 版本。
  - 后端保存配置时，如果前端没传值，会用这个兜底。

- `newAppDefaults.dependencies`
  - 新建项目弹窗默认依赖库（空格分隔）。
  - 用户可在 UI 里增删。
  - 后端保存配置时，如果前端没传值，会用这个兜底。

- `apps.<appName>`
  - 每个项目的配置对象，`appName` 必须符合命名规则。
  - 常用子字段：
  - `port`：该 App 的 dev server 端口（如 `5173`）
  - `script`：来自 `AppScripts` 的脚本文件名（如 `first_demo_frontend.jsx`）
  - `scriptEntry`：源码入口（通常 `<appName>/main.jsx`）
  - `dependencies`：该 App 额外依赖（空格分隔）
  - `displayName`：可选，控制台显示名称

修改建议：
- 优先在控制台页面编辑 `apps.<appName>`，避免手改 JSON 出错。
- 若你手改了 `setting.json`，建议重启 `Manager.bat` 或刷新控制台页面。
- 若你修改了 `managerUrl` 或 `managerPort`，请对对应 App 执行一次“安装/修复”，以刷新 `vite.config.js` 里的代理配置。

---

## 4. 关键目录结构（重点：AppScripts）

路径约定：
- 文档中的 `<ProjectRoot>` 表示你的项目根目录（即包含 `Manager.bat` 的目录）。

```text
\MoleHub
├─ Manager.bat
├─ setting.json
└─ AppWorkspace
   ├─ AppScripts/                         # 【重点】放 AI 生成的前端 JSX
   │  └─ first_demo_frontend.jsx
   ├─ AppScriptSrc/                       # 新建项目后生成源码入口
   │  └─ first-demo/main.jsx
   ├─ Apps/                               # 安装后生成的运行项目
   │  └─ first-demo/
   ├─ Logs/                               # 启停/安装日志
   └─ AppManager/
      ├─ server.js
      ├─ dashboard.html
      ├─ routes/                          # 预制核心功能路由（通常不改）
      ├─ apps/                            # 【重点】后端插件目录（按 app 分目录）
      │  ├─ first-demo/
      │  │  ├─ first_demo_backend.js
      │  │  └─ extra_api.js               # 同一 app 可放多个脚本
      │  └─ another-app/
      │     └─ another_backend.js
      └─ app_tools/                       # 可选工具（Excel 等）
```

---

## 5. 后端接入规范（用户自定义部分）

你的后端脚本推荐放这里：
- `AppWorkspace/AppManager/apps/<appName>/<scriptName>.js`
- 示例：`AppWorkspace/AppManager/apps/first-demo/first_demo_backend.js`

说明：
- 每个 App 使用独立文件夹，支持一个 App 放多个后端脚本。
- 新建项目保存配置时，会自动创建 `AppWorkspace/AppManager/apps/<appName>/` 目录。

必须满足：
1. `const router = express.Router()`
2. `module.exports = router`
3. 返回统一 JSON：
   - 成功：`{ success: true, ... }`
   - 失败：`{ success: false, error: '...' }`
4. 参数校验失败返回 `400`
5. 服务异常返回 `500`

自动挂载规则：
- 文件路径 `apps/first-demo/first_demo_backend.js`
- 路由前缀 `/api/app/first-demo/first_demo_backend`

### 5.1 前端请求路径规范（必须遵守）

前端调用后端接口时，统一使用**相对路径**，不要写死主机和端口。

推荐：
- `fetch('/api/app/first-demo/first_demo_backend/ping', {...})`

禁止：
- `fetch('http://localhost:3000/api/...')`
- `fetch('http://127.0.0.1:3000/api/...')`

原因：
- `managerPort` 可改（默认 3000），相对路径会自动跟随当前页面端口
- 将来迁移到公网/反向代理时不需要改业务代码
- 避免不同环境（本地/测试/生产）硬编码地址导致请求失败

---

## 6. 新建项目 / 删除项目文件变动（first-demo 示例）

前提：
- 项目名：`first-demo`
- 前端脚本：`first_demo_frontend.jsx`
- 后端脚本：`first_demo_backend.js`

### 6.1 新建 + 安装 + 启动后

会产生/修改：
1. `setting.json`：新增 `apps.first-demo`
2. `AppWorkspace/AppScriptSrc/first-demo/main.jsx`（由 `AppScripts/first_demo_frontend.jsx` 同步）
3. `AppWorkspace/Apps/first-demo/`（Vite 项目）
4. `AppWorkspace/Apps/first-demo/src/App.jsx`（启动时注入）
5. `AppWorkspace/Logs/first-demo-*.log`

### 6.2 删除项目（卸载）

按勾选清理：
- `AppWorkspace/Apps/first-demo`
- `AppWorkspace/AppScriptSrc/first-demo`
- `AppWorkspace/Logs/first-demo-*.log`
- 可选：`AppWorkspace/AppManager/apps/first-demo/first_demo_backend.js`

并清理：
- `setting.json` 中 `apps.first-demo`

---

## 7. AI 提示词（重点：生成 first_demo_backend.js）

说明：`first-demo` / `first_demo_frontend.jsx` / `first_demo_backend.js` 都是示例名，请按你的真实项目名替换。

### 7.0 先给 AI 的项目结构上下文（推荐每次都带）

```text
项目运行结构（请先理解再改代码）：
1) 管理后台入口：AppWorkspace/AppManager/server.js
   - 负责装配路由、加载 apps 目录下插件、启动管理服务
2) 核心路由：AppWorkspace/AppManager/routes/
   - app-runtime.js：新建/安装/启动/停止/卸载等预制流程
   - logs.js：日志读取与清理
3) App 后端插件目录：AppWorkspace/AppManager/apps/<appName>/*.js
   - 自动挂载到 /api/app/<appName>/<scriptName>
4) 前端脚本投放：AppWorkspace/AppScripts/*.jsx
5) App 源码入口：AppWorkspace/AppScriptSrc/<appName>/main.jsx
6) 运行项目目录：AppWorkspace/Apps/<appName>/

约束：
- 不要重构 server.js 和预制流程，除非明确要求
- 优先新增插件脚本，不改动无关文件
```

### 7.1 常用主提示词（推荐直接复制）

```text
你正在修改 MoleHub 项目，请只做最小改动。

已知：
- 当前 App 名称：first-demo
- 前端文件：AppWorkspace/AppScripts/first_demo_frontend.jsx
- 需要新增后端插件文件：AppWorkspace/AppManager/apps/first-demo/first_demo_backend.js

请完成：
1) 创建 first_demo_backend.js，并使用 express.Router
2) 导出 module.exports = router
3) 提供接口：
   - POST /ping
   - POST /save-config
4) 最终接口前缀应为 /api/app/first-demo/first_demo_backend
5) 统一返回 JSON：{ success: true/false, ... }
6) 参数错误返回 400，异常返回 500
7) 补充一个前端 fetch 调用示例

限制：
- 不修改新建/安装/启动/删除/log 预制流程
- 不重构其他无关文件
```

### 7.2 前端脚本生成提示词

```text
请生成 React JSX 单文件页面，文件名 first_demo_frontend.jsx。
要求：
- 默认导出 export default function App()
- 可直接放到 AppWorkspace/AppScripts/first_demo_frontend.jsx
- 不依赖未声明库
```

### 7.3 后端排障提示词

```text
请检查 first_demo_backend.js 为什么没有生效。
请按顺序检查：
1) 文件是否在 AppWorkspace/AppManager/apps/first-demo/
2) 是否 module.exports = router
3) 是否有语法错误
4) 实际挂载路径是否 /api/app/first-demo/first_demo_backend
5) Manager 日志是否有 mounted 信息
并给出最小修复方案。
```