/**
 * lib/adb.mjs — ADB 可执行文件定位与子进程封装。
 * 约定：adb 路径作为可执行文件、参数用数组传递、绝不拼 shell 字符串；统一超时、UTF-8 解码、捕获 stdout/stderr。
 */
import { existsSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 包名白名单：至少两段，每段以字母/数字/下划线开头，杜绝命令注入字符。 */
export const PKG_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
/** 设备 serial 白名单：只接受 adb devices -l 实测输出中的合法字符。 */
export const SERIAL_RE = /^[A-Za-z0-9._:-]+$/;
export const DEFAULT_TIMEOUT_MS = 15000;

const MAX_BUFFER = 16 * 1024 * 1024;

// ── adb 路径解析 ──────────────────────────────────────────────────────────────

/** PATH 中的 adb：Windows 用 where，其他用 which；返回首个结果或 null。 */
function adbFromPath() {
  try {
    const tool = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(tool, ['adb'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const first = String(out).split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || 'adb';
  } catch {
    return null;
  }
}

/** 契约第 4 步：常见安装目录探测。 */
function commonAdbCandidates() {
  const home = homedir();
  if (process.platform === 'win32') {
    const profile = process.env.USERPROFILE || home;
    const local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return [
      join(profile, 'Downloads', 'platform-tools-latest-windows', 'platform-tools', 'adb.exe'),
      join(local, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
      'C:\\platform-tools\\adb.exe',
    ];
  }
  return [
    join(home, 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    join(home, 'Android', 'Sdk', 'platform-tools', 'adb'),
    '/usr/bin/adb',
    '/opt/platform-tools/adb',
  ];
}

/**
 * 按契约顺序解析 adb 路径：
 * 1) CLI --adb / 环境变量 ADB_PATH  2) data/config.json 的 adbPath
 * 3) PATH 中的 adb（where/which）    4) 常见目录探测  5) 未找到 → adbError
 * @returns {{adbPath: string|null, adbError: string|null, source: string}}
 */
export function resolveAdb({ cliAdb, envAdb, configAdb } = {}) {
  const clean = (v) => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '') : '');

  // 1) CLI / 环境变量：用户显式指定，路径无效时给出明确提示，不再向下回退。
  for (const raw of [cliAdb, envAdb]) {
    const p = clean(raw);
    if (!p) continue;
    if (!existsSync(p)) {
      return { adbPath: null, adbError: `指定的 adb 路径不存在：${p}`, source: 'cli/env' };
    }
    return { adbPath: p, adbError: null, source: 'cli/env' };
  }

  // 2) data/config.json：配置可能是历史遗留的失效路径，允许继续尝试 PATH 与常见目录。
  const fromConfig = clean(configAdb);
  let configWarning = null;
  if (fromConfig) {
    if (existsSync(fromConfig)) return { adbPath: fromConfig, adbError: null, source: 'config' };
    configWarning = `配置中的 adb 路径不存在：${fromConfig}`;
  }

  // 3) PATH
  const fromEnv = adbFromPath();
  if (fromEnv) return { adbPath: fromEnv, adbError: null, source: 'PATH' };

  // 4) 常见目录
  for (const candidate of commonAdbCandidates()) {
    if (existsSync(candidate)) return { adbPath: candidate, adbError: null, source: 'probe' };
  }

  // 5) 全部落空
  return {
    adbPath: null,
    adbError: configWarning || '未找到 adb，请在设置中指定 adb.exe 路径，或把 platform-tools 加入 PATH',
    source: 'not-found',
  };
}

// ── 子进程执行 ────────────────────────────────────────────────────────────────

/**
 * 以 execFile 数组参数执行 adb；永不因非零退出码抛异常，统一返回结构化结果。
 * @returns {Promise<{ok:boolean, stdout:string, stderr:string, code:number|null, error:string|null}>}
 */
export function execAdb(adbPath, args, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!adbPath) return Promise.resolve({ ok: false, stdout: '', stderr: '', code: null, error: 'adb 路径为空' });
  const list = (Array.isArray(args) ? args : []).map(String);
  const timeout = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(adbPath, list, {
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      if (err) {
        resolve({
          ok: false,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: typeof stderr === 'string' ? stderr : '',
          code: typeof err.code === 'number' ? err.code : null,
          error: err.message || 'adb 执行失败',
        });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '', code: 0, error: null });
      }
    });
  });
}

/** 把 adb 参数数组格式化为日志/前端展示用的命令行（可执行文件统一显示为 adb）。 */
export function formatCommand(args) {
  return ['adb', ...(Array.isArray(args) ? args : []).map(String)].join(' ');
}

/** 读取 adb version，返回例如 '1.0.41'；探测失败返回 null。 */
export async function getAdbVersion(adbPath, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!adbPath) return null;
  const r = await execAdb(adbPath, ['version'], Math.min(timeoutMs, 10000));
  if (!r.stdout) return null;
  const m = r.stdout.match(/Android Debug Bridge version\s+([\d.]+)/i)
    || r.stdout.match(/\bversion\s+([\d.]+)/i);
  return m ? m[1] : null;
}

// ── 设备列表 ──────────────────────────────────────────────────────────────────

/** 解析 `adb devices -l`：serial state product:x model:y device:z transport_id:n。 */
export function parseDevices(text) {
  const devices = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^List of devices/i.test(line) || line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    if (!SERIAL_RE.test(serial)) continue; // 只接受白名单内的 serial
    const state = parts[1];
    const fields = {};
    let key = null;
    for (let i = 2; i < parts.length; i++) {
      const token = parts[i];
      const m = token.match(/^([A-Za-z_]+):(.*)$/);
      if (m) {
        key = m[1];
        fields[key] = m[2];
      } else if (key) {
        // 少数设备把 model 值里的空格原样输出（如 model:Pixel 7），合并到上一个字段。
        fields[key] += ' ' + token;
      }
    }
    devices.push({
      serial,
      state,
      model: (fields.model || '').replace(/_/g, ' '),
      product: fields.product || '',
      device: fields.device || '',
      transportId: fields.transport_id || fields.transportId || '',
    });
  }
  return devices;
}

/** 读取设备列表。 */
export async function listDevices(adbPath, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const r = await execAdb(adbPath, ['devices', '-l'], timeoutMs);
  if (!r.ok && !r.stdout) {
    return { ok: false, devices: [], error: r.error || r.stderr || 'adb devices 执行失败' };
  }
  return { ok: true, devices: parseDevices(r.stdout), error: null };
}

// ── 应用列表采集 ──────────────────────────────────────────────────────────────

/** `pm list packages ...` 单行解析：带 -f 时为 `package:/path=pkg`，否则 `package:pkg`。 */
export function parsePackageLine(line) {
  const body = String(line).replace(/^package:/, '').trim();
  const eq = body.indexOf('=');
  if (eq >= 0) return { apkPath: body.slice(0, eq).trim(), pkg: body.slice(eq + 1).trim() };
  return { apkPath: '', pkg: body };
}

/** 对指定 serial 执行一条 pm list packages，返回 package: 行。 */
export async function pmList(adbPath, serial, extraArgs = [], timeoutMs = DEFAULT_TIMEOUT_MS) {
  const args = ['-s', serial, 'shell', 'pm', 'list', 'packages', ...extraArgs];
  const r = await execAdb(adbPath, args, timeoutMs);
  if (!r.ok && !r.stdout) {
    return { ok: false, lines: [], error: r.error || r.stderr || 'pm list packages 执行失败' };
  }
  const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith('package:'));
  return { ok: true, lines, error: null };
}

/**
 * 组合 5 条采集命令得到应用集合：
 * - -f 全部已安装（含 apk 路径）、-f -3 第三方、-f -s 系统、-d 已停用、-u 含已卸载全集。
 * 全集(-u) 减去 已安装集(-f) 即为「已为用户卸载」集合。
 */
export async function collectPackageSets(adbPath, serial, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const specs = [['-f'], ['-f', '-3'], ['-f', '-s'], ['-d'], ['-u']];
  const results = await Promise.all(specs.map((s) => pmList(adbPath, serial, s, timeoutMs)));
  const failed = results.find((r) => !r.ok);
  if (failed) return { ok: false, error: failed.error || '采集应用列表失败' };

  const toSet = (lines) => {
    const set = new Set();
    for (const line of lines) {
      const { pkg } = parsePackageLine(line);
      if (PKG_RE.test(pkg)) set.add(pkg);
    }
    return set;
  };

  const all = new Map(); // pkg -> apkPath
  for (const line of results[0].lines) {
    const { pkg, apkPath } = parsePackageLine(line);
    if (PKG_RE.test(pkg)) all.set(pkg, apkPath);
  }
  const thirdparty = toSet(results[1].lines);
  const system = toSet(results[2].lines);
  const disabled = toSet(results[3].lines);
  const withUninstalled = toSet(results[4].lines);
  const uninstalled = new Set();
  for (const pkg of withUninstalled) if (!all.has(pkg)) uninstalled.add(pkg);

  return { ok: true, all, thirdparty, system, disabled, uninstalled, error: null };
}

// ── 卸载 / 恢复 ───────────────────────────────────────────────────────────────

/** 单包卸载：keepData=true 加 -k；成功判定看输出是否含 Success。 */
export async function uninstallOne(adbPath, serial, pkg, keepData = true, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const shellCmd = keepData
    ? ['pm', 'uninstall', '-k', '--user', '0', pkg]
    : ['pm', 'uninstall', '--user', '0', pkg];
  const args = ['-s', serial, 'shell', ...shellCmd];
  const command = formatCommand(args);
  const r = await execAdb(adbPath, args, timeoutMs);
  const out = `${r.stdout}\n${r.stderr}`.trim();
  const ok = r.ok && /\bsuccess\b/i.test(out);
  return { ok, message: out || (ok ? 'Success' : (r.error || '卸载失败')), command };
}

const RESTORE_FAIL = /\bfailure\b|\berror\b|\bexception\b|not found|not installed|install_failed|unknown package|cannot|unable/i;
const RESTORE_OK = /\bsuccess\b|installed for user|package .* installed|\binstalled\b/i;

function restoreLooksOk(out) {
  if (RESTORE_FAIL.test(out)) return false;
  return RESTORE_OK.test(out);
}

/**
 * 单包恢复，按契约顺序逐条回退：
 * 1) cmd package install-existing  2) pm install-existing  3) pm install -r --user 0 <apkPath>（有路径才尝试）。
 * 任一步输出含成功标志即返回；全失败返回最后一条命令与输出，并附 attempts 供日志展示。
 */
export async function restoreOne(adbPath, serial, pkg, apkPath = '', timeoutMs = DEFAULT_TIMEOUT_MS) {
  const steps = [
    ['cmd', 'package', 'install-existing', pkg],
    ['pm', 'install-existing', pkg],
  ];
  if (apkPath) steps.push(['pm', 'install', '-r', '--user', '0', apkPath]);

  const attempts = [];
  let last = { ok: false, message: '恢复失败', command: '', attempts };
  for (const shellCmd of steps) {
    const args = ['-s', serial, 'shell', ...shellCmd];
    const command = formatCommand(args);
    const r = await execAdb(adbPath, args, timeoutMs);
    const out = `${r.stdout}\n${r.stderr}`.trim();
    const ok = r.ok && restoreLooksOk(out);
    const message = out || (r.ok ? 'Success' : (r.error || '恢复失败'));
    attempts.push({ command, message, ok });
    last = { ok, message: ok ? (out || 'Success') : message, command, attempts: [...attempts] };
    if (ok) return last;
  }
  return last;
}
