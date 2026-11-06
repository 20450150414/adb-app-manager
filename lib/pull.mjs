/**
 * lib/pull.mjs — APK 提取：pm path 多 split 路径解析、adb pull 落盘、流式 SHA-256、
 * 导出记录与目录打开。主要业务逻辑集中在此，server.mjs 只负责路由与参数校验。
 * 全部子进程调用走 lib/adb.mjs 的 execFile 参数数组，绝不拼 shell 字符串。
 */
import { existsSync, mkdirSync, statSync, createReadStream, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve, isAbsolute, basename, sep, parse as parsePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PKG_RE, SERIAL_RE, pmPath, pullFile, formatCommand } from './adb.mjs';
import { lookup } from './catalog.mjs';
import { addExport, getExports } from './store.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** 默认导出根：<项目根>/exports；未指定 outputDir 时再下一层 <serial>。 */
export const DEFAULT_EXPORTS_ROOT = join(ROOT, 'exports');

const NAME_RE = /^[A-Za-z0-9._-]+\.apk$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** demo 模式下的内存导出记录，仅用于自测展示，不落磁盘。 */
const DEMO_EXPORTS = [];

function defaultExportsDir(serial) {
  return join(DEFAULT_EXPORTS_ROOT, serial);
}

/**
 * 输出目录校验：绝对路径、非盘符根、原始串不含 '..'、不含控制字符。
 * @returns {{ok:true, dir:string}|{ok:false, error:string}}
 */
export function validateOutputDir(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, error: '输出目录格式不合法' };
  const original = raw.trim();
  if (original.includes('..')) return { ok: false, error: '输出目录不得包含 .. 路径片段' };
  if (!isAbsolute(original)) return { ok: false, error: '输出目录需为绝对路径' };
  if (CONTROL_RE.test(original)) return { ok: false, error: '输出目录包含非法控制字符' };
  const dir = resolve(original);
  const parsed = parsePath(dir);
  if (!parsed.base || dir === parsed.root) return { ok: false, error: '输出目录不能是盘符根目录' };
  if (dir.split(/[\\/]/).includes('..')) return { ok: false, error: '输出目录不得包含 .. 路径片段' };
  return { ok: true, dir };
}

/** 把 pm path 的 remote 列表整理成前端结构，name 过白名单，不合法回退 partN.apk。 */
export function shapePaths(remotes) {
  const paths = remotes.map((remote, i) => {
    const rawName = basename(remote);
    const name = NAME_RE.test(rawName) ? rawName : `part${i + 1}.apk`;
    return { remote, name, split: false };
  });
  for (const p of paths) {
    // 单项 split=false 仅当 name==='base.apk' 或整包只有单条 APK。
    p.split = !(p.name === 'base.apk' || paths.length === 1);
  }
  return { count: paths.length, split: paths.length > 1, paths };
}

/** demo 内置假 remote（1~3 条，刻意带 ~~ / == 以覆盖路径解析）。 */
function demoRemotes(pkg) {
  const dir = `/data/app/~~DEMO==/${pkg}-DEMO==`;
  const sum = [...pkg].reduce((s, c) => s + c.charCodeAt(0), 0);
  // Chrome / Bard / GMS 这类真实设备上的 split 包强制 3 条，便于 demo 展示 split:true。
  const forceSplit = /chrome|bard|gms|vending|maps|youtube/i.test(pkg);
  const n = forceSplit ? 3 : (sum % 3) + 1;
  const list = [`${dir}/base.apk`];
  if (n >= 2) list.push(`${dir}/split_config.arm64_v8a.apk`);
  if (n >= 3) list.push(`${dir}/split_config.zh.apk`);
  return list;
}

/** 流式 SHA-256：createReadStream + createHash，不把整文件读进内存。 */
function sha256File(filePath) {
  return new Promise((done, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => done(hash.digest('hex')));
  });
}

/** demo 假 sha256：由字符串确定性派生，长度 64 位十六进制。 */
function demoHash(text) {
  return createHash('sha256').update(String(text)).digest('hex');
}

// ── GET /api/apk/paths ───────────────────────────────────────────────────────

/** 取单个包的全部 APK 路径（含 split）；demo 返回内置假数据，不执行 adb。 */
export async function getApkPaths({ adbPath, serial, pkg, demo = false, timeoutMs = 15000 } = {}) {
  if (!PKG_RE.test(pkg)) return { ok: false, error: '包名格式不合法' };
  let remotes;
  if (demo) {
    remotes = demoRemotes(pkg);
  } else {
    if (!SERIAL_RE.test(String(serial || ''))) return { ok: false, error: '设备序列号不合法' };
    const r = await pmPath(adbPath, serial, pkg, timeoutMs);
    if (!r.ok) return { ok: false, error: r.error || '读取 APK 路径失败' };
    if (r.paths.length === 0) return { ok: false, error: '设备上未找到该应用的 APK 路径' };
    remotes = r.paths;
  }
  return { ok: true, pkg, ...shapePaths(remotes), ...(demo ? { demo: true } : {}) };
}

// ── POST /api/apk/pull ───────────────────────────────────────────────────────

/**
 * 批量提取 APK。逐包：pm path → 逐个 adb pull → 流式 sha256 → 写 data/exports.json。
 * 单包失败不影响后续包；demo 模式不执行 adb、不创建目录、不写任何真实文件。
 */
export async function pullPackages({
  adbPath, serial, packages, outputDir = null,
  skipExisting = true, demo = false, timeoutMs = 15000,
} = {}) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return { ok: false, error: '请提供要提取的包名列表' };
  }
  if (packages.length > 300) return { ok: false, error: '单次最多处理 300 个包名' };

  let root;
  if (outputDir === null || outputDir === undefined || outputDir === '') {
    root = defaultExportsDir(serial);
  } else {
    const v = validateOutputDir(outputDir);
    if (!v.ok) return { ok: false, error: v.error };
    root = v.dir;
  }
  if (!demo) mkdirSync(root, { recursive: true });

  const results = [];
  for (const raw of packages) {
    const pkg = String(raw ?? '').trim();
    const label = lookup(pkg).label || pkg;

    if (!PKG_RE.test(pkg)) {
      results.push({ pkg, label, ok: false, dir: '', count: 0, totalBytes: 0, files: [], error: '包名格式不合法，已跳过' });
      continue;
    }

    const dir = join(root, pkg); // pkg 已过 PKG_RE，仅含字母数字点下划线，安全
    const pathsResult = await getApkPaths({ adbPath, serial, pkg, demo, timeoutMs });
    if (!pathsResult.ok) {
      results.push({ pkg, label, ok: false, dir, count: 0, totalBytes: 0, files: [], error: pathsResult.error });
      continue;
    }

    if (!demo) mkdirSync(dir, { recursive: true });
    const files = [];
    const errors = [];
    const details = [];

    for (const p of pathsResult.paths) {
      const localPath = join(dir, p.name);
      const command = formatCommand(['-s', serial, 'pull', p.remote, localPath]);

      // skipExisting：本地已有非空文件直接复用，command 记「已存在，跳过」。
      if (skipExisting && !demo && existsSync(localPath)) {
        const st = statSync(localPath);
        if (st.isFile() && st.size > 0) {
          let sha256 = '';
          try { sha256 = await sha256File(localPath); } catch { /* 保留空串 */ }
          files.push({
            name: p.name, path: localPath, remote: p.remote,
            size: st.size, sha256, skipped: true, command: '已存在，跳过',
          });
          continue;
        }
      }

      if (demo) {
        const size = 1024 * 1024 + ((pkg.length * 7919 + p.name.length * 104729) % (48 * 1024 * 1024));
        files.push({
          name: p.name, path: localPath, remote: p.remote, size,
          sha256: demoHash(`${pkg}|${p.remote}|${p.name}`),
          skipped: false, command,
        });
        continue;
      }

      const pulled = await pullFile(adbPath, serial, p.remote, localPath, timeoutMs);
      if (!existsSync(localPath) || !statSync(localPath).isFile() || statSync(localPath).size === 0) {
        errors.push(`${p.name}：拉取失败`);
        if (pulled.message) details.push(`${p.name}: ${pulled.message}`); // adb 原始输出仅作诊断
        continue;
      }
      const st = statSync(localPath);
      let sha256 = '';
      try { sha256 = await sha256File(localPath); } catch { /* 保留空串 */ }
      files.push({
        name: p.name, path: localPath, remote: p.remote,
        size: st.size, sha256, skipped: false, command: pulled.command,
      });
    }

    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    const ok = files.length > 0;
    const record = { pkg, label, serial, dir, count: files.length, totalBytes, files };
    if (demo) {
      DEMO_EXPORTS.unshift({ ...record, at: new Date().toISOString(), demo: true });
      if (DEMO_EXPORTS.length > 500) DEMO_EXPORTS.length = 500;
    } else {
      addExport(record); // 每包一条记录，原子写，最多 500 条
    }
    results.push({
      pkg, label, ok, dir, count: files.length, totalBytes, files,
      ...(ok ? {} : {
        error: errors.join('；') || '未提取到任何 APK 文件',
        ...(details.length ? { detail: details } : {}),
      }),
    });
  }

  return { ok: true, outputDir: root, results, ...(demo ? { demo: true } : {}) };
}

// ── GET /api/apk/exports ─────────────────────────────────────────────────────

/** 导出记录：真实模式每次从磁盘读、不缓存；demo 返回内存模拟记录。 */
export function getExportRecords({ demo = false } = {}) {
  const items = demo
    ? [...DEMO_EXPORTS].sort((a, b) => String(b.at).localeCompare(String(a.at)))
    : getExports();
  return { ok: true, root: DEFAULT_EXPORTS_ROOT, items, ...(demo ? { demo: true } : {}) };
}

// ── POST /api/apk/open ───────────────────────────────────────────────────────

/** 用系统文件管理器打开目录；spawn 参数数组 + detached + unref，不等待不阻塞。 */
function openWithOS(dir) {
  const opts = { detached: true, stdio: 'ignore' };
  try {
    let child;
    if (process.platform === 'win32') {
      child = spawn('explorer.exe', [dir], { ...opts, windowsHide: true });
    } else if (process.platform === 'darwin') {
      child = spawn('open', [dir], opts);
    } else {
      child = spawn('xdg-open', [dir], opts);
    }
    child.on('error', () => { /* 打开失败不影响响应 */ });
    child.unref();
  } catch { /* 打开失败不影响响应 */ }
}

/**
 * 打开导出目录。path 为空 → 默认导出根（不存在先创建）；给了 path → realpath 校验
 * 必须位于默认导出根或历史使用过的自定义导出根之下，防目录穿越。
 * demo 模式不创建目录、不启动文件管理器。
 */
export function openExportsDir({ path: raw = null, demo = false } = {}) {
  let target = DEFAULT_EXPORTS_ROOT;
  if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
    const original = String(raw).trim();
    if (original.includes('..')) return { ok: false, error: '路径不得包含 .. 路径片段' };
    if (!isAbsolute(original)) return { ok: false, error: '路径需为绝对路径' };
    if (CONTROL_RE.test(original)) return { ok: false, error: '路径包含非法控制字符' };

    let real;
    try { real = realpathSync(original); } catch { real = resolve(original); }
    // 允许的根：默认导出根 + 历史导出记录里实际用过的自定义 outputDir。
    // 自定义目录只有真实提取过才被信任，避免把任意绝对路径当成可打开目标。
    const roots = [DEFAULT_EXPORTS_ROOT];
    if (!demo) {
      for (const rec of getExports()) {
        if (rec && typeof rec.dir === 'string' && rec.dir) {
          const parent = dirname(rec.dir);
          if (isAbsolute(parent) && !parent.includes('..')) roots.push(parent);
        }
      }
    }

    // Windows 路径大小写不敏感，统一小写后比对；realpath 已解析符号链接。
    const norm = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
    const a = norm(real);
    const matched = roots.some((r) => {
      let b;
      try { b = norm(realpathSync(r)); } catch { b = norm(resolve(r)); }
      const prefix = b.endsWith(sep) ? b : b + sep;
      return a === b || a.startsWith(prefix);
    });
    if (!matched) return { ok: false, error: '路径超出导出目录范围，已拒绝打开' };
    target = real;
  }

  if (!demo) {
    mkdirSync(target, { recursive: true });
    openWithOS(target);
  }
  return { ok: true, path: target, ...(demo ? { demo: true } : {}) };
}
