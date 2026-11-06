# USB 调试指南

本指南配合 `adb-app-manager` 使用：让手机在 `adb devices -l` 里稳定显示为 `device`，工具才能拉取应用列表。全程不需要 root。

> 命令示例用 PowerShell；把 `D:\tools\platform-tools\adb.exe` 换成本机的实际 adb 路径，`SERIAL` 换成 `adb devices -l` 输出里的实际序列号。

## 一、通用准备

1. 电脑安装 Android SDK Platform Tools（建议 30.0.0 以上）。
2. 手机与电脑用**支持数据传输**的原装线连接，通知栏把 USB 模式切到「传输文件 / MTP」（停在「仅充电」时部分机型不会弹出授权）。
3. 锁屏密码、指纹或图案提前设好：多数 ROM 要求有锁屏凭据才允许开启 USB 调试。
4. 开发者选项的入口都是「连点版本号 7 次」，输入锁屏密码后提示「您已处于开发者模式」。
5. Windows 上若设备管理器里出现带感叹号的 ADB Interface，先装手机厂商的 USB 驱动或 Google USB Driver。

```powershell
# 确认 adb 可用
& 'D:\tools\platform-tools\adb.exe' version
& 'D:\tools\platform-tools\adb.exe' devices -l
```

## 二、分厂商开启步骤

### 小米 / Redmi（MIUI、HyperOS）

1. `设置 → 我的设备 → 全部参数与信息` → 连点「MIUI 版本」或「OS 版本」7 次。
2. `设置 → 更多设置 → 开发者选项` → 打开「USB 调试」。
3. 建议同时打开「USB 安装」（允许通过 adb 安装应用）；部分机型还有「USB 调试（安全设置）」，需要登录小米账号并插入 SIM 卡才能开启，用于通过 adb 修改系统设置。
4. 连接电脑后通知栏选「传输文件」，等待 RSA 授权弹窗。
5. 装机完成后如出现安装类操作被拦截，可在开发者选项里临时关闭「MIUI 优化」并重启（改回时记得还原）。

### 华为 / 荣耀（EMUI、HarmonyOS、MagicOS）

1. `设置 → 关于手机` → 连点「版本号」7 次；HarmonyOS 部分版本入口是「关于本机 → 版本号」。
2. `设置 → 系统和更新 → 开发人员选项`（荣耀：`设置 → 系统和更新 → 开发人员选项`）→ 打开「USB 调试」。
3. 打开「『仅充电』模式下允许 ADB 调试」，避免 USB 模式切换导致连接掉线。
4. 通知栏 USB 模式选「传输文件」，部分机型需下拉选择「传输文件(MTP)」而不是「仅充电」。
5. 若弹窗一闪而过：`设置 → 系统和更新 → 开发人员选项 → 撤销 USB 调试授权`，重新插拔。

### OPPO / 一加 / realme（ColorOS、OxygenOS、realme UI）

1. `设置 → 关于手机 → 版本信息` → 连点「版本号」7 次；部分 ColorOS 版本会要求输入锁屏密码或图形验证码。
2. `设置 → 其他设置 → 开发者选项`（一加：`设置 → 系统设置 → 开发者选项`）→ 打开「USB 调试」。
3. 打开「禁止权限监控」之外的默认项即可；若需要 adb 修改系统设置，打开「USB 调试（安全设置）」并登录账号。
4. 通知栏把「仅充电」改为「传输文件」，realme UI 首次连接会提示「是否允许 USB 调试」，点允许。
5. 开发者选项里可关闭「自动更新系统夜间」之类干扰项，避免调试过程中设备重启。

### vivo / iQOO（Funtouch OS、OriginOS）

1. `设置 → 系统管理 → 关于手机` → 连点「软件版本号」7 次（部分版本在 `设置 → 我的设备 → 更多参数`）。
2. `设置 → 系统管理 → 开发者选项` → 打开「USB 调试」。
3. OriginOS 需在开发者选项里额外允许「USB 调试」的二次确认弹窗。
4. 通知栏选择「传输文件 / 管理文件」，然后等待 RSA 弹窗。

### 三星（One UI）

1. `设置 → 关于手机 → 软件信息` → 连点「编译编号（Build Number）」7 次。
2. 回到 `设置` 最底部出现「开发者选项」→ 打开「USB 调试」→ 确认弹窗。
3. 连接电脑后下拉通知栏，把 USB 用途从「仅充电」改为「传输文件 / Android Auto」。
4. 首次连接若设备管理器显示 `SAMSUNG_Android` 异常，安装三星 USB 驱动或 Smart Switch 附带的驱动。
5. 部分韩版/美版机型在开发者选项里有「通过 USB 验证应用」，保持默认即可。

### 原生 Android / Pixel / AOSP（含 Android Studio 模拟器）

1. `设置 → 关于手机` → 连点「版本号」7 次。
2. `设置 → 系统 → 开发者选项` → 打开「USB 调试」。
3. 通知栏选「传输文件」，授权 RSA 弹窗。
4. 模拟器通常自动以 `emulator-5554` 出现，不需要 USB 调试开关；`adb devices -l` 里 state 为 `device` 即可。

## 三、RSA 授权弹窗

首次用某台电脑连接时，手机会弹出：

```text
允许 USB 调试吗？
这台计算机的 RSA 密钥指纹：XX:XX:...:XX
[ ] 一律允许使用这台计算机进行调试
        取消   确定
```

- 勾选「一律允许使用这台计算机进行调试」，再点**确定**。此后该电脑免重复弹窗。
- 弹窗只在**解锁状态**出现；锁屏时先解锁再插拔。
- 弹窗没出现时按顺序排查：切换 USB 模式为传输文件 → 重新插拔 → 开发者选项里「撤销 USB 调试授权」→ 重启 adb 服务。

```powershell
& 'D:\tools\platform-tools\adb.exe' kill-server
& 'D:\tools\platform-tools\adb.exe' start-server
& 'D:\tools\platform-tools\adb.exe' devices -l
```

授权完成后 `adb devices -l` 的典型输出：

```text
List of devices attached
R58M1234567           device product:pixel_7 model:Pixel_7 device:oriole transport_id:1
```

## 四、`adb devices -l` 状态含义与排查

| state | 含义 | 处理 |
| --- | --- | --- |
| `device` | 已连接并授权，可正常执行 `adb shell pm ...` | 在工具顶部设备下拉选中它，点刷新 |
| `unauthorized` | RSA 密钥未被手机授权 | 解锁屏幕 → 切 MTP → 重新插拔 → 勾选「一律允许」→ 确定；仍不行则「撤销 USB 调试授权」后重连 |
| `offline` | adb 与设备握手失败，多为版本过旧或连接不稳 | 升级 platform-tools → `adb kill-server` + `adb start-server` → 换线换口 → 重启手机 |
| `no permissions` | Linux 下 udev 规则缺失或用户不在 `plugdev` 组 | 配置 udev 规则后用 `sudo adb kill-server` + `sudo adb start-server`，或临时以 root 运行 adb |
| `recovery` | 设备处于 Recovery 模式 | 重启到系统（`adb reboot`）；此状态下 `pm` 命令不可用 |
| `sideload` | 设备处于 ADB Sideload 模式 | 退出 sideload 或重启到系统 |
| 列表为空 | 驱动、线缆或 USB 模式问题 | 装厂商 USB 驱动、换数据线、通知栏改「传输文件」，Windows 设备管理器确认 ADB Interface 无感叹号 |

补充排查命令：

```powershell
# 端口占用（Windows 5037）
Get-NetTCPConnection -LocalPort 5037 | Select-Object LocalAddress,LocalPort,State,OwningProcess

# 指定某台设备执行，确认 shell 通道正常
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell getprop ro.product.model
& 'D:\tools\platform-tools\adb.exe' -s SERIAL shell pm list packages -3

# 查看工具侧的健康状态（服务已启动）
Invoke-RestMethod 'http://127.0.0.1:8787/api/health' | ConvertTo-Json -Depth 5
Invoke-RestMethod 'http://127.0.0.1:8787/api/devices' | ConvertTo-Json -Depth 5
```

`adb-app-manager` 的设备 serial 只取自 `adb devices -l` 的实际输出，并要求匹配 `[A-Za-z0-9._:-]+`；状态不是 `device` 时界面会给出对应的引导卡片。

## 五、无线调试（Android 11+）

需要 platform-tools 30.0.0 以上、手机 Android 11 及以上、手机与电脑在**同一局域网**。开发者选项里找到「无线调试」。

### 1. 开启与配对

1. 手机 `设置 → 开发者选项 → 无线调试` → 打开开关，确认当前 Wi-Fi。
2. 点「使用配对码配对设备」，屏幕显示**配对地址端口**（例如 `192.168.1.20:37541`）与 6 位配对码。
3. 电脑执行 `adb pair`，按提示输入配对码：

```powershell
& 'D:\tools\platform-tools\adb.exe' pair 192.168.1.20:37541
# 提示 Enter pairing code: 后输入屏幕上的 6 位数字，回车
# Successfully paired to 192.168.1.20:37541 [guid=adb-xxxx]
```

> 配对端口与连接端口**不是同一个**：配对弹窗里的端口用一次，连接用「无线调试」主页面显示的 `IP:端口`（例如 `192.168.1.20:42135`）。

### 2. 连接与验证

```powershell
& 'D:\tools\platform-tools\adb.exe' connect 192.168.1.20:42135
& 'D:\tools\platform-tools\adb.exe' devices -l
# 输出示例：
# 192.168.1.20:42135    device product:... model:... transport_id:2

& 'D:\tools\platform-tools\adb.exe' -s 192.168.1.20:42135 shell pm list packages -3
```

连接成功后在工具顶部设备下拉里选中这条 `IP:端口` 设备即可，USB 线可以拔掉。

### 3. 断开与常见问题

```powershell
& 'D:\tools\platform-tools\adb.exe' disconnect 192.168.1.20:42135
& 'D:\tools\platform-tools\adb.exe' kill-server
```

- `adb pair` 提示 `protocol fault` 或握手失败：升级 platform-tools；确认手机与电脑在同一网段（关闭电脑 VPN / 隔离 Wi-Fi / AP 隔离）。
- 每次手机重启、Wi-Fi 切换或无线调试开关关闭后，连接端口会变，重新看手机上的端口再 `adb connect`。
- 部分 ROM 在「无线调试」里还提供「通过二维码配对」，命令行流程用配对码即可。
- 无线连接相比 USB 更容易 `offline`，做批量卸载这类长操作时优先用数据线。

## 六、连接自检清单

- [ ] `adb version` 正常输出，platform-tools >= 30.0.0
- [ ] 手机开发者选项已开启，USB 调试开关为开
- [ ] 通知栏 USB 模式为「传输文件 / MTP」
- [ ] RSA 弹窗已勾选「一律允许」并确定
- [ ] `adb devices -l` 中目标设备 state 为 `device`
- [ ] `adb -s SERIAL shell getprop ro.product.model` 能返回型号
- [ ] 工具 `/api/health` 里 `adbPath` 有值、`adbError` 为 `null`

满足以上七条后，回到工具点「刷新」，即可看到完整应用列表。更详细的厂商路径以手机实际系统版本为准；界面文案可能随 ROM 版本略有差异。
