# ADB 预装应用管理器（adb-app-manager）

一个零第三方依赖、完全离线可用的本地 Web 小工具：通过本机的 `adb.exe` 列出 Android 设备上的系统预装应用，按厂商和风险分级展示，勾选后批量执行 `pm uninstall -k --user 0` 精简，随时可恢复。Windows 双击 `start.bat` 一键启动，浏览器打开 `http://127.0.0.1:8787` 即可使用。

![主界面](docs/screenshots/main.png)

> 上图为 `--demo` 演示模式下的实际界面（内置演示设备与 48 条示例应用）。无需 adb、无需真机即可查看完整流程。

## 功能特性

- **设备与 ADB 状态可视**：顶部状态栏显示 adb 路径、版本、端口、演示模式标记，设备下拉列出 serial / 型号 / 产品名 / transportId。
- **全量应用清单**：合并 `pm list packages -f`、`-3`、`-s`、`-d`、`-u` 五组结果，区分「已安装 / 已卸载 / 已禁用」，标注 APK 路径与来源分区（system / system_ext / vendor / product / odm / oem / apex / data）。
- **中文目录与风险分级**：内置 369 条真实常见包名，给出中文名、厂商、风险徽章、卸载影响说明；未收录的包按包名启发式推断厂商并生成可读名称。
- **筛选 / 搜索 / 排序 / 分页**：按名称与包名即时搜索，来源、风险、厂商多选筛选，每页 50 条。
- **六套预设方案**：小米、华为、OPPO、vivo、三星、Google，一键勾选方案中仍已安装的 low/medium 项。
- **批量卸载与恢复**：逐包调用接口，实时进度条、逐条结果与可复制的实际 adb 命令日志。
- **危险确认**：critical/high 项需勾选「我已了解风险」并输入 `确认卸载`；critical 默认不勾选并带「禁止」标记，`force:false` 时后端硬阻断。
- **操作历史**：`data/history.json` 按时间倒序保留最多 500 条卸载/恢复记录，支持一键清空。
- **演示模式**：内置一台假设备与约 40 条示例应用，卸载与恢复在内存中模拟，方便无设备时验证 UI 与流程。
- **离线可用**：无 npm 依赖、无 CDN 外链，纯原生 HTML/CSS/JS + Node.js 内置模块。

## 原理说明

核心命令是 Android 的用户级卸载：

```text
adb -s <SERIAL> shell pm uninstall -k --user 0 <包名>
```

- `--user 0`：卸载**只对当前用户（user 0）生效**，其他用户/工作资料不受影响。
- `-k`：保留该应用的数据与缓存；界面上「保留数据」开关关闭时去掉 `-k`。
- **system 分区里的 APK 文件没有被删除**，只是为 user 0 打了「已卸载」标记，所以分区不会被改写，也不需要 root。
- 恢复走系统自带的 `cmd package install-existing <包名>`（失败时回退 `pm install-existing`，再回退历史记录里的 `pm install -r --user 0 <apkPath>`），把该用户下的标记撤销即可。

因此这套操作是可逆的：重启、OTA 升级通常不会让已卸载项自动回来；恢复出厂设置则会把 user 0 的卸载标记清掉，所有预装应用重新出现。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | >= 18（ESM，`.mjs` / `"type":"module"`） |
| npm 依赖 | 无，`dependencies` 为空对象 |
| ADB | Android SDK Platform Tools 里的 `adb.exe`（建议 30.0.0 以上，无线调试需要） |
| 手机 | 开启开发者选项与 USB 调试，并在 RSA 授权弹窗点「允许」，详见 [USB 调试指南](docs/USB调试指南.md) |
| 系统 | Windows 为主（提供 `start.bat`），macOS / Linux 用 `start.sh` |
| 浏览器 | 任意现代浏览器，访问 `http://127.0.0.1:8787` |

## 三种启动方式

```powershell
# 方式一：Windows 一键启动（推荐，自动切到脚本目录并打开浏览器）
cd D:\workspace\adb-app-manager
.\start.bat

# 方式二：npm start（等价 node server.mjs）
npm start

# 方式三：演示模式，无需 adb 与真机
npm run demo
node server.mjs --demo --open

# 其它常用参数
node server.mjs --port 9000
node server.mjs --adb 'D:\tools\platform-tools\adb.exe'
node server.mjs --demo --open --port 9000
```

| 参数 / 环境变量 | 作用 |
| --- | --- |
| `--port <n>` / `PORT` | 覆盖默认端口 8787 |
| `--adb <path>` / `ADB_PATH` | 指定 adb 可执行文件 |
| `--open` | 启动后自动打开浏览器 |
| `--demo` | 演示模式，内置假设备与假应用 |

服务默认只监听 `127.0.0.1`，所有 `/api/*` 响应为 JSON（`Content-Type: application/json; charset=utf-8`），静态资源来自 `public/`。

## 首次使用 5 步流程

1. **装 Node 与 platform-tools**：`node --version` 确认 >= 18；解压 platform-tools 到任意目录，例如 `D:\tools\platform-tools\adb.exe`。
2. **手机开启 USB 调试**：连点版本号进入开发者选项，打开 USB 调试，数据线连接后选择「传输文件(MTP)」，按 [USB 调试指南](docs/USB调试指南.md) 完成 RSA 授权。
3. **启动工具**：双击 `start.bat`（或 `npm start`），浏览器自动打开 `http://127.0.0.1:8787`。
4. **确认设备**：顶部状态栏看到 adb 路径与版本，设备下拉选中状态为 `device` 的那台；点「刷新」拉取应用列表。
5. **勾选并卸载**：用左侧预设方案或搜索勾选目标 → 查看每条 note 的风险说明 → 「批量卸载」→ 在确认弹窗完成校验 → 看日志抽屉里的逐条结果与命令。

排错时可直接验证 adb：

```powershell
& 'D:\tools\platform-tools\adb.exe' devices -l
& 'D:\tools\platform-tools\adb.exe' shell pm list packages -3
```

## ADB 路径配置说明

工具按以下顺序解析 adb，命中即停：

1. CLI `--adb <path>` 或环境变量 `ADB_PATH`
2. `data/config.json` 的 `adbPath`
3. PATH 里的 `adb`（用 `where` / `which` 判定）
4. 常见目录探测：Windows 下 `%USERPROFILE%\Downloads\platform-tools-latest-windows\platform-tools\adb.exe`、`%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`、`C:\platform-tools\adb.exe`；macOS / Linux 下 `~/Library/Android/sdk/platform-tools/adb`、`~/Android/Sdk/platform-tools/adb`、`/usr/bin/adb`、`/opt/platform-tools/adb`
5. 都未命中 → `/api/health` 返回 `adbPath:null` 与 `adbError`，界面显示「设置 ADB 路径」引导卡片

配置方式任选其一：

```powershell
# 临时：环境变量仅对当前终端生效
$env:ADB_PATH = 'D:\tools\platform-tools\adb.exe'
npm start

# 临时：命令行参数
node server.mjs --adb 'D:\tools\platform-tools\adb.exe'

# 持久：界面右上角齿轮 → 设置弹窗 → 填 ADB 路径或点「自动探测」→ 保存
# 保存结果写入 data/config.json（已被 .gitignore 忽略）
```

仓库内提供 `config.example.json` 作为字段示例；`data/` 由运行时生成，本地配置不会进版本库。设置弹窗同时可调整子进程超时（1000~120000 ms，默认 15000 ms）与主题。

## 预设方案用法

左侧「预设方案」列出六组，每组 20~45 个包名，只收录 `low` / `medium` 风险项，绝不收录 critical：

| Key | 名称 | 覆盖 |
| --- | --- | --- |
| `xiaomi` | 小米 / Redmi 精简 | MIUI / HyperOS 广告、反馈、在线内容、商城、负一屏 |
| `huawei` | 华为 / 荣耀精简 | 预置影音、书城、天气、生活服务、广告模块 |
| `oppo` | OPPO / 一加 / realme 精简 | ColorOS / realme UI 内容应用、商城、游戏空间、负一屏 |
| `vivo` | vivo / iQOO 精简 | 预置影音、天气、便签、主题、互传 |
| `samsung` | 三星 One UI 精简 | Bixby 系列、主题商店、预置办公与内容应用 |
| `google` | Google 全家桶精简 | Play 影音、办公套件、壁纸与搜索类客户端 |

点击方案 → 自动勾选该方案中仍处于 `installed` 的包并滚动到表格，toast 提示勾选数量；之后仍可手动增减勾选再执行。方案本身不改动设备，只影响界面选择。想导出自定义组合，用批量栏的「导出方案 JSON」。

## 风险分级说明

| 级别 | 含义 | 界面标记 | 后端行为 |
| --- | --- | --- | --- |
| `critical` | 系统框架与核心数据库，卸载会导致开机卡住、桌面崩溃或通信中断 | 禁止（默认不勾选） | `force:false` 时单条返回 `核心组件，已阻止（需 force）` |
| `high` | 强依赖组件，卸载后某项核心能力缺失（相机、拨号、推送、WebView 等） | 危险 | 需勾选确认并输入 `确认卸载`，`dangerous:true` |
| `medium` | 有明显功能影响，如预置浏览器、应用商店、输入法、默认短信 | 提醒 | 正常执行，建议先看 note |
| `low` | 预装内容、广告、在线服务、反馈与商城类 | 安全 | 可直接精简 |
| `unknown` | 未收录于目录的包 | 未知 | 按包名启发式推断厂商，`dangerous:false`，请自行确认 |

`gms` / `vending` / `webview` / 开机向导按契约归为 `high`：提示风险但不在 `CRITICAL_PACKAGES` 硬阻断集合里。每条 note 都以「卸载后」开头写明实际影响，危险项写明后果；勾选前把鼠标停在行上看一眼是最省事的习惯。

## 恢复已卸载应用的步骤

1. 左侧范围筛选切到「已卸载」（后端用 `pm list packages -u` 全集减去已安装集算出）。
2. 勾选要恢复的包 → 「批量恢复」。
3. 后端逐条依次尝试：`cmd package install-existing <pkg>` → `pm install-existing <pkg>` → 历史里有 `apkPath` 且文件仍在时用 `pm install -r --user 0 <apkPath>`；成功后写 `action:"restore"` 历史。
4. 点「刷新」确认状态回到 `installed`；历史抽屉可查看每条命令与输出。

手工恢复（把 `SERIAL` 换成 `adb devices -l` 里的实际 serial）：

```powershell
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell cmd package install-existing com.miui.bugreport
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell pm install-existing com.miui.bugreport
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell pm path com.miui.bugreport
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell pm install -r --user 0 /system/priv-app/MiuiBugReport/MiuiBugReport.apk
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell pm list packages com.miui.bugreport
```

## 常见问题

**设备显示 `unauthorized`**
手机端 RSA 授权弹窗未确认。解锁屏幕 → 切换 USB 模式为「传输文件」→ 重新插拔 → 弹窗勾选「一律允许使用这台计算机进行调试」→ 确定。仍不行就在开发者选项里点「撤销 USB 调试授权」再重连，然后重启 adb 服务：

```powershell
& 'D:\tools\platform-tools\adb.exe' kill-server
& 'D:\tools\platform-tools\adb.exe' start-server
& 'D:\tools\platform-tools\adb.exe' devices -l
```

**设备显示 `offline` 或列表为空**
多为 platform-tools 版本过旧、线缆只供电、USB 模式停在「仅充电」或 5037 端口被占用。升级 platform-tools 到最新版、换一根数据线、选 MTP 模式、重启 adb 服务、重新授权；Windows 下检查手机驱动是否装好。

**找不到 adb / `/api/health` 里 `adbPath:null`**
用设置弹窗填 `adb.exe` 完整路径或点「自动探测」；也可 `--adb`、`$env:ADB_PATH`、`data/config.json` 的 `adbPath` 三选一。保存后接口会重新探测并返回新 health。

```powershell
where.exe adb
& 'D:\tools\platform-tools\adb.exe' version
```

**卸载后开机向导卡住 / 恢复出厂后卡在初始化**
向导类包（`com.google.android.setupwizard`、`com.huawei.hwstartupguide`、`com.sec.android.app.secsetupwizard` 等）被一并卸载时会出现。先恢复向导包：

```powershell
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell cmd package install-existing com.google.android.setupwizard
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell settings put secure user_setup_complete 1
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell settings put global device_provisioned 1
& 'D:\tools\platform-tools\adb.exe' -s SERIAL reboot
```

若仍停在向导页，进 Recovery 恢复出厂设置即可重建 user 0（这也会清掉所有卸载标记）。

**恢复失败 / `install-existing` 报 Failure**
`install-existing` 只对系统分区里仍存在的预装包有效；第三方应用被 `--user 0` 卸载后，用 `pm path <pkg>` 查 APK 路径再 `pm install -r --user 0 <apkPath>`，或直接重装 APK。极少数 ROM 删除了 user 0 的包记录时，恢复出厂设置是最彻底的办法。历史抽屉里的 `apkPath` 字段可直接复制使用。

**请求很慢 / 按钮点了没反应**
采集五组 `pm list packages` 命令可能超过 10 秒，界面有 loading 态与防重复点击；结果缓存 60 秒，`refresh=1` 强制重采，卸载/恢复后自动失效。子进程默认超时 15000 ms，可在设置里调大。

## 目录结构

```text
adb-app-manager/
├── server.mjs                # HTTP 服务与 REST API
├── start.bat / start.sh      # 一键启动脚本
├── package.json              # ESM，零依赖
├── config.example.json       # 本地配置示例
├── README.md
├── LICENSE                   # MIT
├── .gitignore
├── CONTRACT.md               # 团队内部开发契约
├── lib/
│   ├── adb.mjs               # adb 探测与子进程封装
│   ├── store.mjs             # config / history 读写
│   └── catalog.mjs           # 应用目录、预设、风险分级、lookup / detectVendor
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── docs/
│   ├── USB调试指南.md
│   └── screenshots/main.png  # 截图占位
└── data/                     # 运行时生成，已被 .gitignore 忽略
    ├── config.json
    └── history.json
```

## 免责与许可

操作前建议备份数据，卸载影响以每条 note 为准；本项目按 MIT 许可开源，具体条款见 [LICENSE](LICENSE)。

## 许可

MIT License，Copyright (c) 2026 `adb-app-manager contributors`。允许自由使用、复制、修改、合并、出版发行、再授权与销售，只需保留版权声明与许可声明；软件按「原样」提供，不含任何明示或暗示担保。完整文本见 [LICENSE](LICENSE)。
