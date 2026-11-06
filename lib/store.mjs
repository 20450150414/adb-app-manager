/**
 * lib/store.mjs — data/ 目录下 JSON 配置与操作历史的读写；原子写，历史最多保留 500 条。
 * 仅依赖 node: 内置模块，供 server.mjs 与 lib/adb.mjs 共用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const HISTORY_LIMIT = 500;

/** 配置缺省值；loadConfig() 始终在此基础上合并磁盘内容。 */
export const DEFAULT_CONFIG = Object.freeze({
  adbPath: null,
  timeoutMs: 15000,
  port: 8787,
  lastSerial: null,
});

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** 读取 data/<name>.json；文件缺失、为空或解析失败时返回 fallback。 */
export function readJson(name, fallback) {
  try {
    const file = join(DATA_DIR, `${name}.json`);
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

/** 原子写 data/<name>.json：先写同目录临时文件，再 rename 覆盖，避免半截文件。 */
export function writeJson(name, value) {
  ensureDir();
  const file = join(DATA_DIR, `${name}.json`);
  const tmp = join(DATA_DIR, `.${name}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    renameSync(tmp, file);
  } catch (err) {
    // 少数平台 rename 不允许覆盖已存在文件：删除目标后重试一次，仍失败则抛出。
    try { unlinkSync(file); } catch { /* 目标原本不存在，忽略 */ }
    renameSync(tmp, file);
  }
  return value;
}

/** 读取完整配置（含缺省值）。 */
export function loadConfig() {
  const stored = readJson('config', {});
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...stored };
}

/** 合并补丁并写回 data/config.json，返回合并后的完整配置。 */
export function saveConfig(patch) {
  const next = { ...loadConfig(), ...(patch && typeof patch === 'object' ? patch : {}) };
  writeJson('config', next);
  return next;
}

/** 历史记录（新→旧）。 */
export function getHistory() {
  const items = readJson('history', []);
  return Array.isArray(items) ? items : [];
}

/** 追加一条历史到最前面，并裁剪到 500 条。 */
export function addHistory(entry) {
  const items = getHistory();
  const record = {
    pkg: String(entry.pkg ?? ''),
    label: String(entry.label ?? entry.pkg ?? ''),
    action: entry.action === 'restore' ? 'restore' : 'uninstall',
    at: entry.at || new Date().toISOString(),
    ok: entry.ok !== false,
    message: String(entry.message ?? ''),
    serial: String(entry.serial ?? ''),
    ...(entry.apkPath ? { apkPath: String(entry.apkPath) } : {}),
    ...(entry.command ? { command: String(entry.command) } : {}),
  };
  items.unshift(record);
  if (items.length > HISTORY_LIMIT) items.length = HISTORY_LIMIT;
  writeJson('history', items);
  return record;
}

/** 清空历史。 */
export function clearHistory() {
  writeJson('history', []);
  return true;
}
