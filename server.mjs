/**
 * server.mjs — ADB 预装应用管理器 HTTP 入口：全部 REST API、public/ 静态服务、--demo 演示模式。
 * 零第三方依赖，仅 node: 内置模块；所有 /api/* 统一 JSON 响应，错误带中文说明。
 */
import { createServer } from 'node:http';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  PKG_RE, SERIAL_RE,
  resolveAdb, getAdbVersion, listDevices, collectPackageSets,
  uninstallOne, restoreOne, formatCommand,
} from './lib/adb.mjs';
import {
  loadConfig, saveConfig, addHistory, getHistory, clearHistory,
} from './lib/store.mjs';
import {
  CATALOG, PRESETS, CRITICAL_PACKAGES, VENDOR_LABELS, lookup, detectVendor,
} from './lib/catalog.mjs';
import {
  DEFAULT_EXPORTS_ROOT, getApkPaths, pullPackages, getExportRecords, openExportsDir,
} from './lib/pull.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const VERSION = '1.0.0';
const CACHE_TTL_MS = 60_000;

// lead 协调点 2：CRITICAL_PACKAGES 含 'android' 这类框架标识（无点号，不符合 PKG_RE）。
// 硬阻断只做纯字符串集合比对，绝不过滤/正则化这个集合，也不先用 PKG_RE 校验待比对包。
const CRITICAL_SET = new Set(
  CRITICAL_PACKAGES instanceof Set
    ? [...CRITICAL_PACKAGES]
    : (Array.isArray(CRITICAL_PACKAGES) ? CRITICAL_PACKAGES : Object.keys(CRITICAL_PACKAGES || {})),
);

// ── CLI 参数 ─────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { demo: false, port: null, adb: null, open: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') out.demo = true;
    else if (a === '--open') out.open = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--port') { const v = Number(argv[++i]); if (Number.isFinite(v)) out.port = v; }
    else if (a.startsWith('--port=')) { const v = Number(a.slice(7)); if (Number.isFinite(v)) out.port = v; }
    else if (a === '--adb') out.adb = argv[++i] ?? null;
    else if (a.startsWith('--adb=')) out.adb = a.slice(6);
  }
  return out;
}
const CLI = parseArgs(process.argv.slice(2));

function resolvePort() {
  const raw = CLI.port ?? process.env.PORT ?? loadConfig().port ?? 8787;
  const p = Number(raw);
  return Number.isInteger(p) && p > 0 && p <= 65535 ? p : 8787;
}
const PORT = resolvePort();
const DEMO = CLI.demo;

// ── 演示数据（约 50 条，结构与真实 /api/apps 完全一致，卸载/恢复在内存模拟） ────
// 字段：pkg, label, vendor, risk, category, note, apkPath, thirdparty, state
const DEMO_RAW = [
  // AOSP / Google 核心
  ['com.android.systemui', '系统界面 SystemUI', 'aosp', 'critical', '系统框架', '卸载后状态栏与锁屏消失，系统反复崩溃', '/system/priv-app/SystemUI/SystemUI.apk', false, 'installed'],
  ['com.android.phone', '电话服务', 'aosp', 'critical', '通信核心', '卸载后移动网络与通话短信全部中断', '/system/priv-app/TeleService/TeleService.apk', false, 'installed'],
  ['com.android.settings', '系统设置', 'aosp', 'critical', '系统框架', '卸载后设置入口消失，系统配置流程中断', '/system/priv-app/Settings/Settings.apk', false, 'installed'],
  ['com.android.providers.settings', '系统设置数据库', 'aosp', 'critical', '系统框架', '卸载后全局配置丢失，系统服务启动报错', '/system/priv-app/SettingsProvider/SettingsProvider.apk', false, 'installed'],
  ['com.android.server.telecom', '通话管理服务', 'aosp', 'critical', '通信核心', '卸载后拨号与来电流程中断', '/system/priv-app/Telecom/Telecom.apk', false, 'installed'],
  ['com.android.packageinstaller', '应用安装器', 'aosp', 'critical', '系统框架', '卸载后 APK 安装与权限授予流程中断', '/system/priv-app/PackageInstaller/PackageInstaller.apk', false, 'installed'],
  ['com.android.permissioncontroller', '权限控制器', 'aosp', 'critical', '系统框架', '卸载后运行时权限弹窗消失', '/system/priv-app/PermissionController/PermissionController.apk', false, 'installed'],
  ['com.android.vending', 'Google Play 商店', 'google', 'high', '应用商店', '卸载后无法通过商店安装与更新应用', '/system/priv-app/Phonesky/Phonesky.apk', false, 'installed'],
  ['com.google.android.gms', 'Google Play 服务', 'google', 'high', '框架服务', '卸载后推送、定位与帐号登录受影响', '/system/priv-app/GmsCore/GmsCore.apk', false, 'installed'],
  ['com.google.android.gsf', 'Google 服务框架', 'google', 'high', '框架服务', '卸载后 GMS 相关功能连锁失效', '/system/priv-app/GoogleServicesFramework/GoogleServicesFramework.apk', false, 'installed'],
  ['com.android.webview', 'Android System WebView', 'aosp', 'high', '系统组件', '卸载后应用内嵌网页无法加载', '/system/app/WebViewGoogle/WebViewGoogle.apk', false, 'installed'],
  // Google 服务
  ['com.google.android.googlequicksearchbox', 'Google 搜索', 'google', 'medium', '搜索', '卸载后桌面搜索框与语音入口消失', '/system/priv-app/Velvet/Velvet.apk', false, 'installed'],
  ['com.google.android.apps.messaging', 'Google 信息', 'google', 'medium', '短信', '卸载后需另装短信应用', '/system/app/messaging/messaging.apk', false, 'installed'],
  ['com.google.android.apps.photos', 'Google 相册', 'google', 'low', '相册', '卸载后云端照片备份停用', '/system/app/Photos/Photos.apk', false, 'installed'],
  ['com.google.android.youtube', 'YouTube', 'google', 'low', '视频', '卸载后预装视频入口消失', '/system/app/YouTube/YouTube.apk', false, 'installed'],
  ['com.google.android.apps.maps', 'Google 地图', 'google', 'low', '地图', '卸载后预装地图入口消失', '/system/app/Maps/Maps.apk', false, 'installed'],
  // 小米 / Redmi
  ['com.miui.bugreport', '小米反馈', 'xiaomi', 'low', '系统服务', '卸载后无法提交反馈，无其他影响', '/system/priv-app/MiuiBugReport/MiuiBugReport.apk', false, 'installed'],
  ['com.miui.analytics', '小米广告分析', 'xiaomi', 'medium', '广告与统计', '卸载后广告推荐与数据上报停用', '/system/priv-app/AnalyticsCore/AnalyticsCore.apk', false, 'installed'],
  ['com.miui.systemAdSolution', '小米系统广告', 'xiaomi', 'medium', '广告与统计', '卸载后系统级广告位减少', '/system/priv-app/SystemAdSolution/SystemAdSolution.apk', false, 'installed'],
  ['com.xiaomi.mipicks', '小米应用商店', 'xiaomi', 'medium', '应用商店', '卸载后可改用其他应用商店', '/system/priv-app/MiPicks/MiPicks.apk', false, 'installed'],
  ['com.miui.video', '小米视频', 'xiaomi', 'low', '视频', '卸载后在线视频入口消失', '/system/app/MiuiVideo/MiuiVideo.apk', false, 'installed'],
  ['com.miui.player', '小米音乐', 'xiaomi', 'low', '音乐', '卸载后在线音乐入口消失', '/system/app/MiuiMusic/MiuiMusic.apk', false, 'installed'],
  ['com.miui.notes', '小米笔记', 'xiaomi', 'low', '工具', '卸载后便签功能停用', '/system/app/Notes/Notes.apk', false, 'installed'],
  ['com.miui.compass', '小米指南针', 'xiaomi', 'low', '工具', '卸载后指南针工具消失', '/system/app/Compass/Compass.apk', false, 'installed'],
  ['com.miui.weather2', '小米天气', 'xiaomi', 'low', '天气', '卸载后天气与桌面小组件停用', '/system/priv-app/MiuiWeather/MiuiWeather.apk', false, 'installed'],
  ['com.miui.securitycenter', '小米安全中心', 'xiaomi', 'high', '安全', '卸载后权限管理、清理与拦截能力受影响', '/system/priv-app/MiuiSecurityCenter/MiuiSecurityCenter.apk', false, 'installed'],
  ['com.miui.gallery', '小米相册', 'xiaomi', 'low', '相册', '卸载后本地相册入口消失', '/system/priv-app/MiuiGallery/MiuiGallery.apk', false, 'installed'],
  ['com.miui.yellowpage', '小米黄页', 'xiaomi', 'low', '工具', '演示数据：已为用户 0 卸载，可点恢复还原', '/system/app/YellowPage/YellowPage.apk', false, 'uninstalled'],
  ['com.miui.fm', '小米收音机', 'xiaomi', 'low', '工具', '演示数据：已停用', '/system/app/FM/FM.apk', false, 'disabled'],
  // 华为 / 荣耀
  ['com.huawei.appmarket', '华为应用市场', 'huawei', 'medium', '应用商店', '卸载后可改用其他应用商店', '/system/priv-app/HwAppMarket/HwAppMarket.apk', false, 'installed'],
  ['com.huawei.health', '华为运动健康', 'huawei', 'low', '健康', '卸载后运动记录同步停用', '/system/app/Health/Health.apk', false, 'installed'],
  ['com.huawei.hwid', '华为帐号', 'huawei', 'medium', '帐号服务', '卸载后华为云服务登录受影响', '/system/priv-app/HwID/HwID.apk', false, 'installed'],
  ['com.huawei.browser', '华为浏览器', 'huawei', 'low', '浏览器', '卸载后预装浏览器消失', '/system/app/Browser/Browser.apk', false, 'installed'],
  ['com.huawei.hifolder', '华为精品推荐', 'huawei', 'low', '推广', '演示数据：已停用', '/system/app/HiFolder/HiFolder.apk', false, 'disabled'],
  // OPPO / 一加 / realme
  ['com.oppo.market', 'OPPO 软件商店', 'oppo', 'medium', '应用商店', '卸载后可改用其他应用商店', '/system/priv-app/OppoMarket/OppoMarket.apk', false, 'installed'],
  ['com.coloros.weather2', 'OPPO 天气', 'oppo', 'low', '天气', '卸载后天气服务停用', '/system/app/Weather/Weather.apk', false, 'installed'],
  ['com.heytap.music', 'HeyTap 音乐', 'oppo', 'low', '音乐', '卸载后在线音乐入口消失', '/system/app/HeytapMusic/HeytapMusic.apk', false, 'installed'],
  // vivo / iQOO
  ['com.vivo.appstore', 'vivo 应用商店', 'vivo', 'medium', '应用商店', '卸载后可改用其他应用商店', '/system/priv-app/VivoAppStore/VivoAppStore.apk', false, 'installed'],
  ['com.vivo.weather', 'vivo 天气', 'vivo', 'low', '天气', '卸载后天气服务停用', '/system/app/VivoWeather/VivoWeather.apk', false, 'installed'],
  // 三星
  ['com.sec.android.app.sbrowser', '三星浏览器', 'samsung', 'low', '浏览器', '卸载后预装浏览器消失', '/system/app/SBrowser/SBrowser.apk', false, 'installed'],
  ['com.samsung.android.app.withtv', '三星视频', 'samsung', 'low', '视频', '卸载后预装视频入口消失', '/system/app/WithTV/WithTV.apk', false, 'installed'],
  // 国内常见预装（/data/app 第三方分区）
  ['com.baidu.searchbox', '百度搜索', 'other', 'low', '搜索', '卸载后预装搜索入口消失', '/data/app/~~demo/com.baidu.searchbox-1/base.apk', true, 'installed'],
  ['com.tencent.mobileqq', 'QQ', 'other', 'low', '社交', '卸载后预装 QQ 消失，可自行安装', '/data/app/~~demo/com.tencent.mobileqq-1/base.apk', true, 'installed'],
  ['com.eg.android.AlipayGphone', '支付宝', 'other', 'low', '支付', '卸载后预装支付宝消失，可自行安装', '/data/app/~~demo/com.eg.android.AlipayGphone-1/base.apk', true, 'installed'],
  ['com.autonavi.minimap', '高德地图', 'other', 'low', '地图', '卸载后预装地图消失，可自行安装', '/data/app/~~demo/com.autonavi.minimap-1/base.apk', true, 'installed'],
  ['com.sina.weibo', '微博', 'other', 'low', '社交', '卸载后预装微博消失', '/data/app/~~demo/com.sina.weibo-1/base.apk', true, 'installed'],
  ['com.jingdong.app.mall', '京东', 'other', 'low', '购物', '卸载后预装京东消失', '/data/app/~~demo/com.jingdong.app.mall-1/base.apk', true, 'installed'],
  ['com.taobao.taobao', '淘宝', 'other', 'low', '购物', '卸载后预装淘宝消失', '/data/app/~~demo/com.taobao.taobao-1/base.apk', true, 'installed'],
];

const DEMO_DEVICE = {
  serial: 'DEMO-PIXEL7-0001',
  state: 'device',
  model: 'Pixel 7（演示设备）',
  product: 'demo_oriole',
  device: 'oriole',
  transportId: '1',
};

/** 演示模式的可变设备状态：pkg -> { label, vendor, risk, category, note, apkPath, thirdparty, state } */
const DEMO_STATE = new Map();
for (const [pkg, label, vendor, risk, category, note, apkPath, thirdparty, state] of DEMO_RAW) {
  DEMO_STATE.set(pkg, { label, vendor, risk, category, note, apkPath, thirdparty, state });
}

// ── 运行时状态 ───────────────────────────────────────────────────────────────

let ADB = { path: null, version: null, error: null };
let SELECTED_SERIAL = loadConfig().lastSerial || null;
let APPS_CACHE = { key: '', at: 0, data: null }; // data: { apps, stats }

function invalidateApps() { APPS_CACHE = { key: '', at: 0, data: null }; }

async function refreshAdb() {
  if (DEMO) {
    ADB = { path: 'demo://mock-adb', version: 'demo', error: null };
    return;
  }
  const cfg = loadConfig();
  const r = resolveAdb({ cliAdb: CLI.adb, envAdb: process.env.ADB_PATH, configAdb: cfg.adbPath });
  if (!r.adbPath) {
    ADB = { path: null, version: null, error: r.adbError };
    return;
  }
  const version = await getAdbVersion(r.adbPath, cfg.timeoutMs);
  ADB = {
    path: r.adbPath,
    version,
    error: version ? null : 'adb 版本探测失败，请确认该路径是可执行的 adb 程序',
  };
}

function healthPayload() {
  return {
    ok: true,
    version: VERSION,
    adbPath: ADB.path,
    adbVersion: ADB.version,
    port: PORT,
    demo: DEMO,
    adbError: DEMO ? null : ADB.error,
    config: { timeoutMs: loadConfig().timeoutMs },
    exportsDir: DEFAULT_EXPORTS_ROOT,
  };
}

/** 当前设备列表（demo 返回内置假设备；真机读 adb devices -l）。 */
async function currentDevices() {
  if (DEMO) return { ok: true, adbPath: ADB.path, adbVersion: ADB.version, devices: [DEMO_DEVICE] };
  if (!ADB.path) {
    return { ok: false, error: ADB.error || '未找到 adb，请在设置中指定 adb.exe 路径', adbPath: null, adbVersion: null, devices: [] };
  }
  const r = await listDevices(ADB.path, loadConfig().timeoutMs);
  if (!r.ok) return { ok: false, error: r.error, adbPath: ADB.path, adbVersion: ADB.version, devices: [] };
  return { ok: true, adbPath: ADB.path, adbVersion: ADB.version, devices: r.devices };
}

function pickSerial(devices) {
  if (SELECTED_SERIAL && devices.some((d) => d.serial === SELECTED_SERIAL && d.state === 'device')) {
    return SELECTED_SERIAL;
  }
  const first = devices.find((d) => d.state === 'device');
  return first ? first.serial : null;
}

async function requireSerial() {
  const devices = await currentDevices();
  if (!devices.ok) return { error: devices.error, devices };
  const serial = pickSerial(devices.devices);
  if (!serial) return { error: '未检测到已授权设备，请在手机上确认 USB 调试授权后刷新', devices };
  return { serial, devices, error: null };
}

// ── 应用组装 ─────────────────────────────────────────────────────────────────

const PARTITION_RULES = [
  ['/system_ext/', 'system_ext'],
  ['/system/', 'system'],
  ['/vendor/', 'vendor'],
  ['/product/', 'product'],
  ['/odm/', 'odm'],
  ['/oem/', 'oem'],
  ['/apex/', 'apex'],
  ['/data/app/', 'data/app'],
];

function partitionOf(apkPath) {
  const p = String(apkPath || '');
  for (const [prefix, name] of PARTITION_RULES) if (p.startsWith(prefix)) return name;
  return 'unknown';
}

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
function compareApps(a, b) {
  const ra = RISK_ORDER[a.risk] ?? 4;
  const rb = RISK_ORDER[b.risk] ?? 4;
  if (ra !== rb) return ra - rb;
  return a.pkg.localeCompare(b.pkg);
}

/** stats 统计设备全量应用（不随 scope 变化），便于前端展示「共 N 个」概览。 */
function computeStats(apps) {
  let system = 0, thirdparty = 0, uninstalled = 0;
  for (const a of apps) {
    if (a.state === 'uninstalled') uninstalled++;
    if (a.thirdparty) thirdparty++; else system++;
  }
  return { total: apps.length, system, thirdparty, uninstalled };
}

function filterByScope(apps, scope) {
  switch (scope) {
    case 'system': return apps.filter((a) => !a.thirdparty);
    case 'thirdparty': return apps.filter((a) => a.thirdparty);
    case 'disabled': return apps.filter((a) => a.state === 'disabled');
    case 'uninstalled': return apps.filter((a) => a.state === 'uninstalled');
    default: return apps.slice(); // all 及未知值
  }
}

function buildDemoApps() {
  const apps = [];
  for (const [pkg, m] of DEMO_STATE) {
    apps.push({
      pkg,
      label: m.label,
      vendor: m.vendor,
      risk: m.risk,
      category: m.category,
      note: m.note,
      dangerous: m.risk === 'critical' || m.risk === 'high',
      known: true,
      apkPath: m.apkPath,
      partition: partitionOf(m.apkPath),
      isSystem: !m.thirdparty,
      state: m.state,
      thirdparty: m.thirdparty,
    });
  }
  apps.sort(compareApps);
  return { ok: true, apps, stats: computeStats(apps) };
}

async function buildRealApps(serial) {
  const sets = await collectPackageSets(ADB.path, serial, loadConfig().timeoutMs);
  if (!sets.ok) return { ok: false, error: sets.error };
  const pkgs = new Set([...sets.all.keys(), ...sets.uninstalled]);
  const apps = [];
  for (const pkg of pkgs) {
    if (!PKG_RE.test(pkg)) continue; // 采集结果同样做白名单过滤
    const info = lookup(pkg);
    const risk = info.risk || 'unknown';
    const thirdparty = sets.thirdparty.has(pkg);
    const apkPath = sets.all.get(pkg) || '';
    const state = sets.uninstalled.has(pkg)
      ? 'uninstalled'
      : (sets.disabled.has(pkg) ? 'disabled' : 'installed');
    apps.push({
      pkg,
      label: info.label || pkg,
      vendor: info.vendor || detectVendor(pkg),
      risk,
      category: info.category || '未分类',
      note: info.note || '',
      dangerous: Boolean(info.dangerous) || risk === 'critical' || risk === 'high',
      known: Boolean(info.known),
      apkPath,
      partition: partitionOf(apkPath),
      isSystem: !thirdparty,
      state,
      thirdparty,
    });
  }
  apps.sort(compareApps);
  return { ok: true, apps, stats: sets.stats || computeStats(apps) };
}

async function getApps(scope, refresh) {
  const got = await requireSerial();
  if (got.error) return fail(got.error);
  const { serial, devices } = got;
  const dev = devices.devices.find((d) => d.serial === serial) || devices.devices[0] || {};
  const device = { serial, model: dev.model || dev.product || '' };
  const key = `${DEMO ? 'demo' : 'real'}|${serial}`;
  const now = Date.now();
  if (!refresh && APPS_CACHE.data && APPS_CACHE.key === key && now - APPS_CACHE.at < CACHE_TTL_MS) {
    return { ok: true, device, stats: APPS_CACHE.data.stats, apps: filterByScope(APPS_CACHE.data.apps, scope) };
  }
  const built = DEMO ? buildDemoApps() : await buildRealApps(serial);
  if (!built.ok) return fail(built.error || '采集应用列表失败');
  // real 模式 stats 直接取 adb 四个集合大小（与 -f / -f -3 / -f -s / -u 行数一致）；
  // demo 模式由 apps 派生。两者都不随 scope 过滤变化。
  const data = { apps: built.apps, stats: built.stats || computeStats(built.apps) };
  APPS_CACHE = { key, at: now, data };
  return { ok: true, device, stats: data.stats, apps: filterByScope(data.apps, scope) };
}

/** 卸载时记录 apkPath 到历史，供 restore 的第三段回退使用。 */
function findKnownApkPath(pkg) {
  if (DEMO) return DEMO_STATE.get(pkg)?.apkPath || '';
  if (APPS_CACHE.data) return APPS_CACHE.data.apps.find((a) => a.pkg === pkg)?.apkPath || '';
  return '';
}
function historyApkPath(pkg) {
  return getHistory().find((h) => h.pkg === pkg && h.apkPath)?.apkPath || '';
}

// ── 演示模式下的内存模拟 ─────────────────────────────────────────────────────

function demoUninstallOne(serial, pkg, keepData) {
  const shellCmd = keepData
    ? ['pm', 'uninstall', '-k', '--user', '0', pkg]
    : ['pm', 'uninstall', '--user', '0', pkg];
  const command = formatCommand(['-s', serial, 'shell', ...shellCmd]);
  const meta = DEMO_STATE.get(pkg);
  if (!meta) return { ok: false, message: '设备上未找到该应用', command };
  if (meta.state === 'uninstalled') return { ok: false, message: '该应用已为用户卸载，无需重复操作', command };
  meta.state = 'uninstalled';
  return { ok: true, message: 'Success', command };
}

function demoRestoreOne(serial, pkg) {
  const command = formatCommand(['-s', serial, 'shell', 'cmd', 'package', 'install-existing', pkg]);
  const meta = DEMO_STATE.get(pkg);
  if (!meta) return { ok: false, message: '设备上未找到该应用', command, attempts: [] };
  meta.state = 'installed';
  const message = `Package ${pkg} installed for user: 0`;
  return { ok: true, message, command, attempts: [{ command, message, ok: true }] };
}

// ── HTTP 基础工具 ────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(message, status = 200) { super(message); this.status = status; }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function fail(error, detail) {
  const out = { ok: false, error };
  if (detail !== undefined) out.detail = detail;
  return out;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new HttpError('请求体过大');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError('请求体不是合法的 JSON');
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

// ── 各 API 处理函数 ──────────────────────────────────────────────────────────

async function handleDevices(res) {
  const r = await currentDevices();
  if (!r.ok) {
    return sendJson(res, 200, {
      ok: false, error: r.error, adbPath: r.adbPath, adbVersion: r.adbVersion, devices: [],
    });
  }
  return sendJson(res, 200, { ok: true, adbPath: r.adbPath, adbVersion: r.adbVersion, devices: r.devices });
}

function readPackageList(body) {
  if (!Array.isArray(body.packages) || body.packages.length === 0) {
    return { error: '请提供要处理的包名列表' };
  }
  if (body.packages.length > 300) return { error: '单次最多处理 300 个包名' };
  return { list: body.packages };
}

async function handleUninstall(req, res) {
  const body = await readBody(req);
  const parsed = readPackageList(body);
  if (parsed.error) return sendJson(res, 200, fail(parsed.error));
  const keepData = body.keepData !== false;
  const force = body.force === true;
  const got = await requireSerial();
  if (got.error) return sendJson(res, 200, fail(got.error));
  const { serial } = got;
  const timeoutMs = loadConfig().timeoutMs;
  const results = [];

  for (const raw of parsed.list) {
    const pkg = String(raw ?? '').trim();
    const info = lookup(pkg);
    // lead 协调点 2：critical 硬阻断先做纯字符串集合比对，不依赖 PKG_RE；
    // 通过阻断后才对即将下发给 adb 的包名做正则白名单校验。
    if (!force && (CRITICAL_SET.has(pkg) || info.risk === 'critical')) {
      results.push({ pkg, ok: false, message: '核心组件，已阻止（需 force）', command: null });
      continue;
    }
    if (!PKG_RE.test(pkg)) {
      results.push({ pkg, ok: false, message: '包名格式不合法，已跳过', command: null });
      continue;
    }
    const r = DEMO
      ? demoUninstallOne(serial, pkg, keepData)
      : await uninstallOne(ADB.path, serial, pkg, keepData, timeoutMs);
    results.push({ pkg, ok: r.ok, message: r.message, command: r.command });
    if (r.ok) {
      addHistory({
        pkg, label: info.label || pkg, action: 'uninstall',
        ok: true, message: r.message, serial,
        apkPath: findKnownApkPath(pkg), command: r.command,
      });
    }
  }
  invalidateApps();
  return sendJson(res, 200, { ok: true, results });
}

async function handleRestore(req, res) {
  const body = await readBody(req);
  const parsed = readPackageList(body);
  if (parsed.error) return sendJson(res, 200, fail(parsed.error));
  const got = await requireSerial();
  if (got.error) return sendJson(res, 200, fail(got.error));
  const { serial } = got;
  const timeoutMs = loadConfig().timeoutMs;
  const results = [];

  for (const raw of parsed.list) {
    const pkg = String(raw ?? '').trim();
    if (!PKG_RE.test(pkg)) {
      results.push({ pkg, ok: false, message: '包名格式不合法，已跳过', command: null });
      continue;
    }
    const apkPath = findKnownApkPath(pkg) || historyApkPath(pkg);
    const r = DEMO
      ? demoRestoreOne(serial, pkg)
      : await restoreOne(ADB.path, serial, pkg, apkPath, timeoutMs);
    results.push({
      pkg, ok: r.ok, message: r.message, command: r.command,
      ...(r.attempts ? { attempts: r.attempts } : {}),
    });
    if (r.ok) {
      const info = lookup(pkg);
      addHistory({
        pkg, label: info.label || pkg, action: 'restore',
        ok: true, message: r.message, serial, command: r.command,
      });
    }
  }
  invalidateApps();
  return sendJson(res, 200, { ok: true, results });
}

function handleConfigGet(res) {
  const cfg = loadConfig();
  return sendJson(res, 200, {
    ok: true,
    config: { adbPath: cfg.adbPath ?? ADB.path, timeoutMs: cfg.timeoutMs, port: PORT },
  });
}

async function handleConfigPost(req, res) {
  const body = await readBody(req);
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'adbPath')) {
    const raw = String(body.adbPath ?? '').trim().replace(/^["']|["']$/g, '');
    // demo 模式跳过文件存在性校验（契约要求）
    if (!DEMO && raw && !existsSync(raw)) {
      return sendJson(res, 200, fail('指定的 adb 路径不存在，请检查后重试'));
    }
    patch.adbPath = raw || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'timeoutMs')) {
    const t = Number(body.timeoutMs);
    if (!Number.isFinite(t) || t < 1000 || t > 120000) {
      return sendJson(res, 200, fail('超时时间需在 1000 ~ 120000 毫秒之间'));
    }
    patch.timeoutMs = Math.round(t);
  }
  if (Object.keys(patch).length === 0) return sendJson(res, 200, fail('没有需要更新的配置项'));
  saveConfig(patch);
  await refreshAdb();
  invalidateApps();
  return sendJson(res, 200, { ok: true, health: healthPayload() });
}

// lead 协调点 1：vendorLabels 直接复用 catalog.mjs 的 VENDOR_LABELS，不另写一份。
function handleCatalog(res) {
  return sendJson(res, 200, {
    ok: true,
    catalog: CATALOG,
    presets: PRESETS,
    critical: [...CRITICAL_SET],
    vendorLabels: VENDOR_LABELS,
  });
}

async function handleDeviceSelect(req, res) {
  const body = await readBody(req);
  const serial = String(body.serial ?? '').trim();
  if (!SERIAL_RE.test(serial)) return sendJson(res, 200, fail('设备序列号格式不合法'));
  const devices = await currentDevices();
  if (!devices.ok) return sendJson(res, 200, fail(devices.error));
  if (!devices.devices.some((d) => d.serial === serial)) {
    return sendJson(res, 200, fail('未找到该设备，请刷新设备列表后重试'));
  }
  SELECTED_SERIAL = serial;
  saveConfig({ lastSerial: serial });
  invalidateApps();
  return sendJson(res, 200, { ok: true });
}

// ── APK 提取（业务逻辑见 lib/pull.mjs，此处仅做路由与参数校验） ──────────────

async function handleApkPaths(req, res, url) {
  const pkg = String(url.searchParams.get('pkg') ?? '').trim();
  if (!PKG_RE.test(pkg)) return sendJson(res, 200, fail('包名格式不合法'));
  const got = await requireSerial();
  if (got.error) return sendJson(res, 200, fail(got.error));
  const r = await getApkPaths({
    adbPath: ADB.path, serial: got.serial, pkg,
    demo: DEMO, timeoutMs: loadConfig().timeoutMs,
  });
  return sendJson(res, 200, r);
}

async function handleApkPull(req, res) {
  const body = await readBody(req);
  const parsed = readPackageList(body);
  if (parsed.error) return sendJson(res, 200, fail(parsed.error));
  const got = await requireSerial();
  if (got.error) return sendJson(res, 200, fail(got.error));
  const r = await pullPackages({
    adbPath: ADB.path,
    serial: got.serial,
    packages: parsed.list,
    outputDir: Object.prototype.hasOwnProperty.call(body, 'outputDir') ? body.outputDir : null,
    skipExisting: body.skipExisting !== false,
    demo: DEMO,
    timeoutMs: loadConfig().timeoutMs,
  });
  return sendJson(res, 200, r);
}

function handleApkExports(res) {
  return sendJson(res, 200, getExportRecords({ demo: DEMO }));
}

async function handleApkOpen(req, res) {
  const body = await readBody(req);
  const r = openExportsDir({
    path: Object.prototype.hasOwnProperty.call(body, 'path') ? body.path : null,
    demo: DEMO,
  });
  return sendJson(res, 200, r);
}

// ── 静态资源 ─────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return sendJson(res, 400, fail('请求路径不合法')); }
  const normalized = rel.replace(/\\/g, '/');
  const relPath = normalized === '' || normalized === '/' ? '/index.html' : normalized;
  let target = resolve(PUBLIC_DIR, '.' + relPath);
  // 目录穿越防护：解析后必须仍位于 public/ 内。
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + sep)) {
    return sendJson(res, 403, fail('禁止访问该路径'));
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    // 无扩展名的路径回退到 index.html，方便前端做前端路由。
    if (!extname(relPath)) {
      const idx = join(PUBLIC_DIR, 'index.html');
      if (!existsSync(idx)) return sendJson(res, 404, fail('页面不存在'));
      target = idx;
    } else {
      return sendJson(res, 404, fail('资源不存在'));
    }
  }
  const ext = extname(target).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  if ((req.method || '').toUpperCase() === 'HEAD') { res.end(); return; }
  const stream = createReadStream(target);
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 500, fail('读取静态资源失败'));
    else res.end();
  });
  stream.pipe(res);
}

// ── 路由 ─────────────────────────────────────────────────────────────────────

async function routeApi(req, res, url, method, pathname) {
  switch (`${method} ${pathname}`) {
    case 'GET /api/health': return sendJson(res, 200, healthPayload());
    case 'GET /api/devices': return handleDevices(res);
    case 'GET /api/apps': return sendJson(res, 200, await getApps(url.searchParams.get('scope') || 'all', url.searchParams.get('refresh') === '1'));
    case 'POST /api/uninstall': return handleUninstall(req, res);
    case 'POST /api/restore': return handleRestore(req, res);
    case 'GET /api/history': return sendJson(res, 200, { ok: true, items: getHistory() });
    case 'DELETE /api/history': clearHistory(); return sendJson(res, 200, { ok: true });
    case 'GET /api/config': return handleConfigGet(res);
    case 'POST /api/config': return handleConfigPost(req, res);
    case 'GET /api/catalog': return handleCatalog(res);
    case 'POST /api/device/select': return handleDeviceSelect(req, res);
    case 'GET /api/apk/paths': return handleApkPaths(req, res, url);
    case 'POST /api/apk/pull': return handleApkPull(req, res);
    case 'GET /api/apk/exports': return handleApkExports(res);
    case 'POST /api/apk/open': return handleApkOpen(req, res);
    default: return sendJson(res, 200, fail(`接口不存在：${method} ${pathname}`));
  }
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const method = (req.method || 'GET').toUpperCase();
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url, method, url.pathname);
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    if (res.headersSent) { try { res.end(); } catch { /* 连接已断开 */ } return; }
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof HttpError ? err.message : `服务内部错误：${err?.message || '未知异常'}`;
    try { sendJson(res, status, fail(message)); } catch { /* 连接已断开 */ }
  }
}

/** 启动后自动打开浏览器，全部用 argv 数组，不拼 shell 字符串。 */
function openBrowser(url) {
  const opts = { detached: true, stdio: 'ignore' };
  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn(process.env.ComSpec || process.env.COMSPEC || 'cmd.exe', ['/c', 'start', '', url], { ...opts, windowsHide: true });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [url], opts);
    } else {
      child = spawn('xdg-open', [url], opts);
    }
    child.on('error', () => { /* 打开失败不影响服务 */ });
    child.unref();
  } catch { /* 打开失败不影响服务 */ }
}

async function main() {
  if (CLI.help) {
    console.log('用法：node server.mjs [--demo] [--port <n>] [--adb <path>] [--open]');
    return;
  }
  await refreshAdb();
  const server = createServer(handler);
  server.on('clientError', (_err, socket) => {
    try { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); } catch { /* 忽略 */ }
  });
  server.on('error', (err) => {
    console.error(`服务启动失败：${err.message}`);
    process.exitCode = 1;
  });
  server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`ADB 预装应用管理器 ${VERSION} 已启动：${url}`);
    console.log(`模式：${DEMO ? '演示模式（无需 adb / 真机）' : '正常模式'}；ADB：${ADB.path || '未找到'}${ADB.version ? ` (${ADB.version})` : ''}`);
    if (!DEMO && ADB.error) console.log(`提示：${ADB.error}`);
    if (CLI.open) openBrowser(url);
  });
}

main().catch((err) => {
  console.error(`启动异常：${err?.stack || err}`);
  process.exitCode = 1;
});
