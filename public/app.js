// 职责说明：ADB 预装应用管理器前端状态、筛选、批量操作与日志展示。
(function () {
  'use strict';

  // 契约端点集中定义，便于自检。
  const API = {
    health: '/api/health',
    devices: '/api/devices',
    apps: '/api/apps?scope=all',
    appsRefresh: '/api/apps?scope=all&refresh=1',
    uninstall: '/api/uninstall',
    restore: '/api/restore',
    config: '/api/config',
    catalog: '/api/catalog',
    selectDevice: '/api/device/select',
    apkPaths: '/api/apk/paths?pkg=',
    apkPull: '/api/apk/pull',
    apkExports: '/api/apk/exports',
    apkOpen: '/api/apk/open'
  };

  const PAGE_SIZE = 50;
  const NL = String.fromCharCode(10);
  const DQ = String.fromCharCode(34);
  const SQ = String.fromCharCode(39);
  const PATH_SEP = String.fromCharCode(92);
  const PENDING_AUTH = String.fromCharCode(117, 110, 97, 117, 116, 104, 111, 114, 105, 122, 101, 100);
  const STORAGE_THEME = 'adbAppManager.theme';
  const STORAGE_SERIAL = 'adbAppManager.lastSerial';
  const STORAGE_EXPORT_DIR = 'adbAppManager.exportDir';

  const FALLBACK_VENDOR_LABELS = {
    xiaomi: '小米 / Redmi',
    huawei: '华为 / 荣耀',
    oppo: 'OPPO / 一加 / realme',
    vivo: 'vivo / iQOO',
    samsung: '三星',
    google: 'Google',
    aosp: 'AOSP',
    other: '其他'
  };

  const PARTITION_LABELS = {
    system: 'system / 系统',
    system_ext: 'system_ext / 系统扩展',
    vendor: 'vendor / 厂商',
    product: 'product / 产品',
    odm: 'odm / ODM',
    oem: 'oem / OEM',
    apex: 'apex / APEX',
    'data/app': 'data/app / 用户安装',
    unknown: 'unknown / 未知'
  };

  const STATE_LABELS = {
    installed: '已安装',
    uninstalled: '已卸载',
    disabled: '已停用'
  };

  const DEVICE_STATE_LABELS = {
    device: '已连接',
    offline: '离线',
    recovery: '恢复模式',
    sideload: '侧载模式',
    'no permissions': '权限待确认'
  };
  DEVICE_STATE_LABELS[PENDING_AUTH] = '待授权';

  const RISK_LABELS = {
    critical: 'critical · 禁止',
    high: '高风险',
    medium: '中等',
    low: '低风险',
    unknown: '未知'
  };

  const SOURCE_OPTIONS = [
    { key: 'all', label: '全部' },
    { key: 'system', label: '系统预装' },
    { key: 'thirdparty', label: '第三方' },
    { key: 'uninstalled', label: '已卸载' },
    { key: 'disabled', label: '已停用' }
  ];

  const RISK_OPTIONS = [
    { key: 'critical', label: 'critical · 禁止' },
    { key: 'high', label: '高风险' },
    { key: 'medium', label: '中等' },
    { key: 'low', label: '低风险' },
    { key: 'unknown', label: '未知' }
  ];

  const SORT_HEADER_TO_MODE = {
    label: 'label-asc',
    pkg: 'pkg-asc',
    partition: 'partition-asc',
    vendor: 'vendor-asc',
    risk: 'risk-asc',
    state: 'state-asc'
  };

  const FALLBACK_CRITICAL = [
    'android',
    'com.android.systemui',
    'com.android.phone',
    'com.android.settings',
    'com.android.providers.settings',
    'com.android.server.telecom',
    'com.android.launcher3',
    'com.android.inputmethod.latin',
    'com.android.packageinstaller',
    'com.android.permissioncontroller',
    'com.android.shell'
  ];

  function fallbackPresets() {
    return [
      {
        key: 'xiaomi',
        name: '小米 / Redmi 精简',
        description: '保留电话、短信、相机与基础服务，清理常见推广与附加工具。',
        vendor: 'xiaomi',
        packages: [
          'com.miui.bugreport', 'com.miui.analytics', 'com.miui.cloudservice', 'com.miui.gallery',
          'com.miui.video', 'com.miui.notes', 'com.miui.compass', 'com.miui.calculator',
          'com.miui.weather2', 'com.miui.screenrecorder', 'com.miui.cleanmaster',
          'com.miui.voiceassist', 'com.miui.smsextra', 'com.miui.yellowpage',
          'com.miui.virtualsim', 'com.miui.freeform', 'com.miui.misound',
          'com.xiaomi.mipicks', 'com.xiaomi.vipaccount', 'com.xiaomi.gamecenter',
          'com.miui.systemAdSolution', 'com.miui.hybrid'
        ]
      },
      {
        key: 'huawei',
        name: '华为 / 荣耀 精简',
        description: '面向日常使用，保留账户、相机、华为分享与基础工具链。',
        vendor: 'huawei',
        packages: [
          'com.huawei.android.tips', 'com.huawei.vassistant', 'com.huawei.hwid',
          'com.huawei.hwreader', 'com.huawei.hwvplayer', 'com.huawei.hwmusic',
          'com.huawei.appmarket', 'com.huawei.hwcloudphoto', 'com.huawei.hwhealth',
          'com.huawei.hwrecorder', 'com.huawei.hwthememanager', 'com.huawei.hwweather',
          'com.huawei.hwcalculator', 'com.huawei.hwcompass', 'com.huawei.hwmirror',
          'com.huawei.hwdownload', 'com.huawei.hwlp', 'com.huawei.hwvoip',
          'com.huawei.android.hwpay', 'com.huawei.android.pushagent',
          'com.huawei.hwsearch', 'com.huawei.hwstartupguide'
        ]
      },
      {
        key: 'oppo',
        name: 'OPPO / 一加 / realme 精简',
        description: '保留系统更新、钱包与相机，处理商店、浏览器与娱乐入口。',
        vendor: 'oppo',
        packages: [
          'com.oppo.market', 'com.oppo.browser', 'com.oppo.music', 'com.oppo.video',
          'com.oppo.reader', 'com.oppo.community', 'com.oppo.store', 'com.oppo.themestore',
          'com.oppo.gamecenter', 'com.oppo.assistantscreen', 'com.oppo.smartsidebar',
          'com.coloros.weather', 'com.coloros.calculator', 'com.coloros.compass',
          'com.coloros.recorder', 'com.coloros.health', 'com.coloros.backuprestore',
          'com.coloros.phonemanager', 'com.coloros.cloud', 'com.coloros.floatassistant',
          'com.heytap.music', 'com.heytap.reader', 'com.nearme.gamecenter'
        ]
      },
      {
        key: 'vivo',
        name: 'vivo / iQOO 精简',
        description: '以低风险附加应用为主，保留相册、联系人与系统工具。',
        vendor: 'vivo',
        packages: [
          'com.vivo.appstore', 'com.vivo.browser', 'com.vivo.music', 'com.vivo.video',
          'com.vivo.reader', 'com.vivo.game', 'com.vivo.weather', 'com.vivo.calculator',
          'com.vivo.compass', 'com.vivo.recorder', 'com.vivo.health', 'com.vivo.thememanager',
          'com.vivo.cloud', 'com.vivo.assistant', 'com.vivo.smartshot',
          'com.vivo.vivoshare', 'com.vivo.easyshare', 'com.vivo.minitouch',
          'com.vivo.floatingball', 'com.vivo.globaltouch', 'com.iqoo.game',
          'com.iqoo.secure', 'com.vivo.services'
        ]
      },
      {
        key: 'samsung',
        name: '三星精简',
        description: '保留 Knox、相机与系统组件，清理预装内容与区域服务。',
        vendor: 'samsung',
        packages: [
          'com.samsung.android.app.notes', 'com.samsung.android.app.reminder',
          'com.samsung.android.app.spage', 'com.samsung.android.app.watchmanager',
          'com.samsung.android.bixby.agent', 'com.samsung.android.bixby.service',
          'com.samsung.android.calendar', 'com.samsung.android.email.provider',
          'com.samsung.android.game.gametools', 'com.samsung.android.game.gos',
          'com.samsung.android.globalpost', 'com.samsung.android.hmt.vrsvc',
          'com.samsung.android.lool', 'com.samsung.android.mdecservice',
          'com.samsung.android.samsungpass', 'com.samsung.android.scloud',
          'com.samsung.android.stickercenter', 'com.samsung.android.themecenter',
          'com.samsung.android.videolist', 'com.samsung.android.voicewakeup',
          'com.sec.android.app.sbrowser', 'com.sec.android.app.myfiles'
        ]
      },
      {
        key: 'google',
        name: 'Google 附加服务精简',
        description: '处理 Google 附加应用，核心服务与 Play 商店保持原样。',
        vendor: 'google',
        packages: [
          'com.google.android.apps.photos', 'com.google.android.apps.maps',
          'com.google.android.youtube', 'com.google.android.apps.messaging',
          'com.google.android.apps.docs', 'com.google.android.apps.tachyon',
          'com.google.android.apps.wellbeing', 'com.google.android.apps.nbu.files',
          'com.google.android.apps.fitness', 'com.google.android.apps.translate',
          'com.google.android.apps.books', 'com.google.android.apps.magazines',
          'com.google.android.apps.music', 'com.google.android.apps.movies',
          'com.google.android.apps.plus', 'com.google.android.apps.cloudprint',
          'com.google.android.apps.adm', 'com.google.android.apps.setupwizard',
          'com.google.android.apps.restore', 'com.google.android.tts',
          'com.google.android.apps.enterprise.dmagent', 'com.google.android.apps.inputmethod.hindi'
        ]
      },
      {
        key: 'domestic',
        name: '国内常见预装精简',
        description: '覆盖资讯、视频、输入法、生活服务类常见预装入口。',
        vendor: 'other',
        packages: [
          'com.baidu.browser.apps', 'com.baidu.searchbox', 'com.baidu.map',
          'com.tencent.mm', 'com.tencent.mobileqq', 'com.tencent.news',
          'com.taobao.taobao', 'com.jingdong.app.mall', 'com.xunmeng.pinduoduo',
          'com.sankuai.meituan', 'com.autonavi.minimap', 'com.ctrip.android.view',
          'com.Qunar', 'cn.wps.moffice_eng', 'com.iflytek.inputmethod',
          'com.qiyi.video', 'com.youku.phone', 'tv.danmaku.bili',
          'com.sina.weibo', 'com.sohu.newsclient', 'com.qihoo360.mobilesafe',
          'com.sogou.inputmethod', 'com.netease.cloudmusic'
        ]
      }
    ];
  }

  function freshBatch() {
    return { active: false, action: '', actionLabel: '', total: 0, done: 0, results: [] };
  }

  function freshApk() {
    return { active: false, total: 0, done: 0, results: [], root: '', currentIndex: 0, currentPkg: '', currentLabel: '', history: [], historyVisible: false };
  }

  const state = {
    health: null,
    config: { timeoutMs: 15000 },
    devices: [],
    currentSerial: '',
    apps: [],
    stats: {},
    device: null,
    catalog: {},
    presets: fallbackPresets(),
    vendorLabels: Object.assign({}, FALLBACK_VENDOR_LABELS),
    critical: new Set(FALLBACK_CRITICAL),
    search: '',
    sourceFilters: new Set(['all']),
    riskFilters: new Set(),
    vendorFilters: new Set(),
    sort: 'risk-asc',
    currentPage: 1,
    selected: new Set(),
    busy: false,
    loading: new Map(),
    logs: [],
    batch: freshBatch(),
    pendingUninstall: null,
    modal: null,
    theme: 'dark',
    exportDir: '',
    apk: freshApk()
  };

  const dom = {};
  const $ = (id) => document.getElementById(id);
  let loadingSeq = 0;

  const HTML_ESCAPE = {};
  HTML_ESCAPE['&'] = '&amp;';
  HTML_ESCAPE['<'] = '&lt;';
  HTML_ESCAPE['>'] = '&gt;';
  HTML_ESCAPE[DQ] = '&quot;';
  HTML_ESCAPE[SQ] = '&#39;';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>\"']/g, (ch) => HTML_ESCAPE[ch]);
  }

  function compactPath(path) {
    const normalized = String(path || '').replaceAll(PATH_SEP, '/');
    const parts = normalized.split('/').filter(Boolean);
    return parts.slice(-2).join('/') || '未找到 adb';
  }

  function formatOutput(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch (err) { return String(value); }
  }

  function formatTime(iso) {
    try { return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }); } catch (err) { return iso; }
  }

  function numberOr(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function formatBytes(value) {
    const sizeValue = numberOr(value, 0);
    if (sizeValue <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(sizeValue) / Math.log(1024)));
    const scaled = sizeValue / Math.pow(1024, index);
    const text = index === 0 ? String(Math.round(scaled)) : scaled.toFixed(scaled >= 10 ? 1 : 2);
    return text + ' ' + units[index];
  }

  function shortHash(value) {
    return String(value || '').slice(0, 12) || '—';
  }

  function readExportDir() {
    try { return localStorage.getItem(STORAGE_EXPORT_DIR) || ''; } catch (err) { return ''; }
  }

  function actionIcon(type) {
    const icons = {};
    icons.uninstall = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'/><path d='M10 11v5M14 11v5'/></svg>`;
    icons.restore = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M3 12a9 9 0 1 0 3-6.7L3 8'/><path d='M3 3v5h5'/></svg>`;
    icons.pull = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M12 3v12M7 10l5 5 5-5'/><path d='M5 21h14'/><path d='M4 7V4h16v3'/></svg>`;
    icons.copy = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><rect x='9' y='9' width='11' height='11' rx='2'/><path d='M5 15V5a2 2 0 0 1 2-2h8'/></svg>`;
    return icons[type] || icons.copy;
  }

  function vendorLabel(key) {
    return state.vendorLabels[key] || FALLBACK_VENDOR_LABELS[key] || key || '其他';
  }

  function partitionLabel(key) {
    return PARTITION_LABELS[key] || PARTITION_LABELS.unknown;
  }

  function stateLabel(key) {
    return STATE_LABELS[key] || '未知';
  }

  function deviceStateLabel(key) {
    return DEVICE_STATE_LABELS[key] || key || '未知';
  }

  function riskLabel(key) {
    return RISK_LABELS[key] || RISK_LABELS.unknown;
  }

  function iconSvg(type) {
    const icons = {};
    icons.success = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M20 6L9 17l-5-5'/></svg>`;
    icons.error = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round'><circle cx='12' cy='12' r='9'/><path d='M12 8v5M12 16h.01'/></svg>`;
    icons.info = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round'><circle cx='12' cy='12' r='9'/><path d='M12 11v5M12 8h.01'/></svg>`;
    icons.warn = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round'><path d='M12 3l9 16H3l9-16Z'/><path d='M12 9v5M12 17h.01'/></svg>`;
    icons.close = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round'><path d='M6 6l12 12M18 6L6 18'/></svg>`;
    return icons[type] || icons.info;
  }

  function emptyIcon(kind) {
    const icons = {};
    icons.adb = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><path d='M4 7h16v10H4z'/><path d='M8 11h8M8 15h5'/></svg>`;
    icons.device = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><rect x='7' y='2.8' width='10' height='18.4' rx='2.2'/><path d='M10 5.4h4M10.5 18.6h3'/></svg>`;
    icons['pending-auth'] = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'><rect x='5' y='10' width='14' height='10' rx='2'/><path d='M8 10V7a4 4 0 0 1 8 0v3M12 14v2'/></svg>`;
    icons.filter = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='M20 20l-3.6-3.6'/></svg>`;
    icons.error = `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round'><circle cx='12' cy='12' r='9'/><path d='M12 8v5M12 16h.01'/></svg>`;
    return icons[kind] || icons.info || icons.adb;
  }

  function showToast(type, title, message) {
    const titles = { success: '操作成功', error: '请求失败', info: '提示', warn: '提醒' };
    const safeType = titles[type] ? type : 'info';
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + safeType;
    toast.setAttribute('role', 'status');
    toast.dataset.type = safeType;
    toast.innerHTML = `<div class='toast-icon'>${iconSvg(safeType)}</div><div class='toast-body'><strong>${escapeHtml(title || titles[safeType])}</strong><span>${escapeHtml(message || '')}</span></div><button type='button' class='toast-close' data-toast-close aria-label='关闭通知'>${iconSvg('close')}</button>`;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4200);
  }

  function renderGlobalLoading() {
    const texts = Array.from(state.loading.values());
    dom.globalLoading.hidden = texts.length === 0;
    dom.globalLoadingText.textContent = texts[texts.length - 1] || '正在加载本机服务…';
  }

  function setTableLoading(flag, text) {
    dom.loadingOverlay.hidden = !flag;
    dom.loadingText.textContent = text || '正在采集应用清单…';
  }

  // 统一请求层：loading、ok:false error 读取与 toast。
  async function apiFetch(path, options, requestOptions) {
    const opts = requestOptions || {};
    const silent = !!opts.silent;
    const token = ++loadingSeq;
    state.loading.set(token, opts.loadingText || '正在加载本机服务…');
    renderGlobalLoading();
    const init = Object.assign({}, options || {});
    init.headers = Object.assign({ Accept: 'application/json' }, (options && options.headers) || {});
    if (init.body && !init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
    try {
      let response;
      try {
        response = await fetch(path, init);
      } catch (err) {
        const netErr = new Error('本机服务连接中断，请检查启动窗口');
        netErr.toasted = !silent;
        if (!silent) showToast('error', '请求失败', netErr.message);
        throw netErr;
      }
      let data;
      try {
        data = await response.json();
      } catch (err) {
        const parseErr = new Error('服务返回格式异常，请检查本机服务窗口');
        parseErr.toasted = !silent;
        if (!silent) showToast('error', '请求失败', parseErr.message);
        throw parseErr;
      }
      if (!data || typeof data !== 'object') {
        const shapeErr = new Error('服务返回空响应，请稍后重试');
        shapeErr.toasted = !silent;
        if (!silent) showToast('error', '请求失败', shapeErr.message);
        throw shapeErr;
      }
      if (!response.ok || data.ok === false) {
        const message = typeof data.error === 'string' && data.error.trim() ? data.error : '请求返回错误';
        const apiErr = new Error(message);
        apiErr.detail = data.detail;
        apiErr.status = response.status;
        apiErr.toasted = !silent;
        if (!silent) showToast('error', '请求失败', message);
        throw apiErr;
      }
      return data;
    } finally {
      state.loading.delete(token);
      renderGlobalLoading();
    }
  }

  function updateControls() {
    document.querySelectorAll('.mutation').forEach((el) => { el.disabled = state.busy; });
    dom.deviceSelect.disabled = state.busy;
    dom.sortSelect.disabled = state.busy;
  }

  async function withBusy(label, fn) {
    if (state.busy) {
      showToast('info', '稍候', '已有任务进行中');
      return null;
    }
    state.busy = true;
    updateControls();
    try {
      return await fn();
    } catch (err) {
      if (!err || !err.toasted) showToast('error', '操作中断', (err && err.message) || '请稍后重试');
      return null;
    } finally {
      state.busy = false;
      updateControls();
      renderWorkspace();
    }
  }

  function renderThemeButtons() {
    if (!dom.themeDarkBtn) return;
    dom.themeDarkBtn.classList.toggle('active', state.theme === 'dark');
    dom.themeLightBtn.classList.toggle('active', state.theme === 'light');
    dom.themeBtn.setAttribute('title', state.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
  }

  function readTheme() {
    try { return localStorage.getItem(STORAGE_THEME) === 'light' ? 'light' : 'dark'; } catch (err) { return 'dark'; }
  }

  function applyTheme(theme) {
    state.theme = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    try { localStorage.setItem(STORAGE_THEME, state.theme); } catch (err) {}
    renderThemeButtons();
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    showToast('success', '主题已切换', state.theme === 'dark' ? '当前为深色主题' : '当前为浅色主题');
  }

  function toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  function renderStaticFilters() {
    dom.sourceFilters.innerHTML = SOURCE_OPTIONS.map((item) => `<button type='button' class='chip${item.key === 'all' ? ' active' : ''}' data-source='${item.key}'>${escapeHtml(item.label)}</button>`).join('');
    dom.riskFilters.innerHTML = RISK_OPTIONS.map((item) => `<label class='check-item'><input type='checkbox' data-risk='${item.key}'><span>${escapeHtml(item.label)}</span><em>${escapeHtml(item.key)}</em></label>`).join('');
  }

  function renderVendorFilters() {
    const counts = {};
    state.apps.forEach((app) => {
      const key = app.vendor || 'other';
      counts[key] = (counts[key] || 0) + 1;
    });
    const keys = Array.from(new Set(Object.keys(FALLBACK_VENDOR_LABELS).concat(Object.keys(state.vendorLabels)).concat(Object.keys(counts))));
    keys.sort((a, b) => vendorLabel(a).localeCompare(vendorLabel(b), 'zh-CN'));
    dom.vendorFilters.innerHTML = keys.map((key) => `<label class='check-item'><input type='checkbox' data-vendor='${escapeHtml(key)}'><span>${escapeHtml(vendorLabel(key))}</span><em>${numberOr(counts[key], 0)}</em></label>`).join('');
  }

  function renderPresets() {
    const presets = state.presets && state.presets.length ? state.presets : fallbackPresets();
    dom.presetCount.textContent = presets.length + ' 组';
    dom.presetList.innerHTML = presets.map((preset, index) => {
      const key = String(preset.key || index);
      const count = Array.isArray(preset.packages) ? preset.packages.length : 0;
      return `<button type='button' class='preset-card mutation' data-preset='${escapeHtml(key)}'><div class='preset-top'><span class='preset-name'>${escapeHtml(preset.name || key)}</span><span class='pill'>${count} 包</span></div><p class='preset-desc'>${escapeHtml(preset.description || '点击勾选方案内仍已安装的包')}</p><div class='preset-meta'><span>${escapeHtml(vendorLabel(preset.vendor))}</span><span>低 / 中风险</span><span>核心组件已过滤</span></div></button>`;
    }).join('');
  }

  function renderHealth() {
    const health = state.health || {};
    const demo = !!health.demo;
    const adbPath = health.adbPath || '';
    let title;
    let subtitle;
    let tone;
    if (demo) {
      title = '演示数据';
      subtitle = 'ADB 模拟 · 离线流程';
      tone = 'is-demo';
    } else if (!adbPath || health.adbError) {
      title = '未找到 adb';
      subtitle = '前往设置填写路径';
      tone = 'is-danger';
    } else {
      title = compactPath(adbPath);
      subtitle = 'ADB ' + (health.adbVersion || '版本未知');
      tone = 'is-ok';
    }
    dom.adbBadge.className = 'status-badge ' + tone;
    dom.adbBadge.title = adbPath || (demo ? '演示模式' : '未找到 adb');
    dom.adbBadge.innerHTML = `<span class='status-dot'></span><div class='status-copy'><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>`;
    dom.demoBadge.hidden = !demo;
    if (dom.defaultExportsDir) dom.defaultExportsDir.textContent = health.exportsDir || 'exports/<serial>';
  }

  function renderDeviceSelect() {
    if (!state.devices.length) {
      dom.deviceSelect.innerHTML = `<option value=''>暂无设备</option>`;
      dom.deviceSelect.value = '';
      return;
    }
    dom.deviceSelect.innerHTML = state.devices.map((d) => {
      const serial = d.serial || '';
      const model = d.model || d.product || d.device || '';
      const text = (model ? model + ' · ' : '') + serial + ' · ' + deviceStateLabel(d.state);
      return `<option value='${escapeHtml(serial)}'>${escapeHtml(text)}</option>`;
    }).join('');
    const exists = state.devices.some((d) => d.serial === state.currentSerial);
    dom.deviceSelect.value = exists ? state.currentSerial : (state.devices[0] && state.devices[0].serial) || '';
  }

  function renderEmptyState(kind, detail) {
    const cards = {
      adb: {
        title: '未找到 adb',
        detail: '本机服务已完成 ADB 路径探测，路径仍待填写。',
        steps: [
          '下载或定位本机 platform-tools 中的 adb 可执行文件',
          '点击「打开设置」填写完整路径，或使用「自动探测」',
          '保存后重新刷新设备列表与应用清单',
          '确认设备已连接，并开启 USB 调试'
        ]
      },
      device: {
        title: '无设备',
        detail: '设备列表为空，按下列顺序完成连接与调试授权。',
        steps: [
          '手机开启开发者选项：设置 → 关于手机 → 连续点按版本号',
          '进入开发者选项，启用 USB 调试',
          '使用数据线连接电脑，解锁手机屏幕',
          '确认 RSA 授权弹窗，回到本页重新刷新'
        ]
      },
      'pending-auth': {
        title: '设备待授权',
        detail: '设备已连接，调试授权仍待确认。',
        steps: [
          '解锁手机屏幕，保持 USB 连接',
          '确认 RSA 授权弹窗，可勾选「一律允许」',
          '如弹窗已消失，重新插拔数据线或重启 ADB 服务',
          '点击「重新刷新」读取已授权设备',
          'adb 路径异常时点击「打开设置」'
        ]
      },
      filter: {
        title: '当前筛选下暂无应用',
        detail: '试试重置筛选、清空搜索词或切换来源。',
        steps: ['清空搜索框', '点击左侧「重置」恢复筛选条件', '切换来源为「全部」']
      },
      error: {
        title: '服务连接异常',
        detail: '本机服务返回了业务错误，按提示处理后重试。',
        steps: ['检查启动窗口中的错误信息', '确认设备状态为 device', '点击「重新刷新」重新采集']
      }
    };
    dom.emptyState.hidden = false;
    dom.contentPanel.hidden = true;
    if (kind === 'loading') {
      dom.emptyState.innerHTML = `<div class='empty-card'><span class='spinner large'></span><h2>正在连接本机服务</h2><p>读取 ADB 状态、设备列表与应用目录中…</p></div>`;
      return;
    }
    const card = cards[kind] || cards.error;
    const detailHtml = detail ? '本机服务返回：' + escapeHtml(detail) : escapeHtml(card.detail);
    const stepsHtml = card.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('');
    dom.emptyState.innerHTML = `<div class='empty-card'><span class='empty-icon'>${emptyIcon(kind)}</span><h2>${escapeHtml(card.title)}</h2><p>${detailHtml}</p><h3>排查步骤</h3><ul class='empty-steps'>${stepsHtml}</ul><div class='empty-actions'><button type='button' class='btn btn-primary mutation' data-empty-action='settings'>打开设置</button><button type='button' class='btn btn-ghost mutation' data-empty-action='refresh'>重新刷新</button></div></div>`;
  }

  function showContent() {
    dom.emptyState.hidden = true;
    dom.contentPanel.hidden = false;
  }

  function renderStats() {
    const stats = state.stats || {};
    const total = numberOr(stats.total, state.apps.length);
    const system = numberOr(stats.system, state.apps.filter((a) => a.isSystem === true || a.thirdparty === false).length);
    const thirdparty = numberOr(stats.thirdparty, state.apps.filter((a) => a.thirdparty === true || a.partition === 'data/app').length);
    const uninstalled = numberOr(stats.uninstalled, state.apps.filter((a) => a.state === 'uninstalled').length);
    const danger = state.apps.filter((a) => a.risk === 'critical' || a.risk === 'high').length;
    const filtered = getFilteredApps().length;
    const model = (state.device && (state.device.model || state.device.serial)) || state.currentSerial || '本机设备';
    dom.statsRow.innerHTML = [
      { label: '应用总数', value: total, hint: '当前设备清单', cls: 'accent' },
      { label: '系统预装', value: system, hint: 'system / vendor 分区', cls: '' },
      { label: '第三方', value: thirdparty, hint: 'data/app 与用户安装', cls: '' },
      { label: '已卸载', value: uninstalled, hint: 'user 0 卸载记录', cls: '' },
      { label: '危险项', value: danger, hint: 'critical + high', cls: 'warn' },
      { label: '已选 / 当前显示', value: state.selected.size + ' / ' + filtered, hint: escapeHtml(model), cls: 'danger' }
    ].map((item) => `<div class='stat-card ${item.cls}'><span class='label'>${escapeHtml(item.label)}</span><span class='value'>${escapeHtml(item.value)}</span><span class='hint'>${escapeHtml(item.hint)}</span></div>`).join('');
  }

  function matchesSource(app) {
    if (!state.sourceFilters.size || state.sourceFilters.has('all')) return true;
    return Array.from(state.sourceFilters).some((key) => {
      if (key === 'system') return app.isSystem === true || app.thirdparty === false;
      if (key === 'thirdparty') return app.thirdparty === true || app.partition === 'data/app';
      if (key === 'uninstalled') return app.state === 'uninstalled';
      if (key === 'disabled') return app.state === 'disabled';
      return false;
    });
  }

  function getFilteredApps() {
    const q = state.search.trim().toLowerCase();
    return state.apps.filter((app) => {
      if (q) {
        const haystack = [app.label || '', app.pkg || '', app.note || '', app.category || '', vendorLabel(app.vendor)].join(' ').toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      if (!matchesSource(app)) return false;
      if (state.riskFilters.size && !state.riskFilters.has(app.risk || 'unknown')) return false;
      if (state.vendorFilters.size && !state.vendorFilters.has(app.vendor || 'other')) return false;
      return true;
    });
  }

  function sortApps(list) {
    const rank = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
    const stateRank = { installed: 0, disabled: 1, uninstalled: 2 };
    const copy = list.slice();
    const labelOf = (a) => String(a.label || a.pkg || '');
    const pkgOf = (a) => String(a.pkg || '');
    const partitionOf = (a) => String(a.partition || 'unknown');
    const vendorOf = (a) => vendorLabel(a.vendor || 'other');
    const riskOf = (a) => rank[a.risk] == null ? rank.unknown : rank[a.risk];
    const stateOf = (a) => stateRank[a.state] == null ? 9 : stateRank[a.state];
    copy.sort((a, b) => {
      switch (state.sort) {
        case 'risk-desc': return riskOf(b) - riskOf(a) || pkgOf(a).localeCompare(pkgOf(b));
        case 'label-asc': return labelOf(a).localeCompare(labelOf(b), 'zh-CN') || pkgOf(a).localeCompare(pkgOf(b));
        case 'label-desc': return labelOf(b).localeCompare(labelOf(a), 'zh-CN') || pkgOf(a).localeCompare(pkgOf(b));
        case 'pkg-asc': return pkgOf(a).localeCompare(pkgOf(b));
        case 'pkg-desc': return pkgOf(b).localeCompare(pkgOf(a));
        case 'partition-asc': return partitionOf(a).localeCompare(partitionOf(b)) || pkgOf(a).localeCompare(pkgOf(b));
        case 'vendor-asc': return vendorOf(a).localeCompare(vendorOf(b), 'zh-CN') || pkgOf(a).localeCompare(pkgOf(b));
        case 'state-asc': return stateOf(a) - stateOf(b) || pkgOf(a).localeCompare(pkgOf(b));
        case 'risk-asc':
        default: return riskOf(a) - riskOf(b) || pkgOf(a).localeCompare(pkgOf(b));
      }
    });
    return copy;
  }

  function getPageData() {
    const filtered = sortApps(getFilteredApps());
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.currentPage = Math.min(Math.max(1, state.currentPage), pages);
    const start = (state.currentPage - 1) * PAGE_SIZE;
    return { filtered, pages, page: state.currentPage, start, pageApps: filtered.slice(start, start + PAGE_SIZE) };
  }

  function riskBadge(risk) {
    const safe = RISK_LABELS[risk] ? risk : 'unknown';
    const critical = safe === 'critical';
    return `<span class='risk-badge risk-${safe}'>${escapeHtml(RISK_LABELS[safe])}${critical ? ` <span class='forbidden-tag'>禁止</span>` : ''}</span>`;
  }

  function stateBadge(key) {
    const safe = STATE_LABELS[key] ? key : 'installed';
    return `<span class='state-badge state-${safe}'>${escapeHtml(STATE_LABELS[safe])}</span>`;
  }

  function renderAppRow(app) {
    const pkg = app.pkg || '';
    const label = app.label || pkg;
    const note = [app.category || '', app.note || '', app.known === false ? '目录未命中' : ''].filter(Boolean).join(' · ');
    const selected = state.selected.has(pkg);
    const critical = app.risk === 'critical' || state.critical.has(pkg);
    const disabled = state.busy ? 'disabled' : '';
    return `<tr class='${selected ? 'is-selected' : ''} ${critical ? 'is-critical' : ''}'><td class='check-cell'><input type='checkbox' data-select='${escapeHtml(pkg)}' ${selected ? 'checked' : ''} ${disabled}></td><td><div class='app-name'>${escapeHtml(label)}</div><div class='app-note'>${escapeHtml(note)}</div></td><td><code class='pkg-code' title='${escapeHtml(pkg)}'>${escapeHtml(pkg)}</code></td><td><span class='partition-badge'>${escapeHtml(partitionLabel(app.partition))}</span></td><td><span class='vendor-badge'>${escapeHtml(vendorLabel(app.vendor))}</span></td><td>${riskBadge(app.risk)}</td><td>${stateBadge(app.state)}</td><td><div class='row-actions'><button type='button' class='icon-action danger mutation' data-row-action='uninstall' data-pkg='${escapeHtml(pkg)}' title='卸载' data-tooltip='卸载' aria-label='卸载' ${disabled}>${actionIcon('uninstall')}</button><button type='button' class='icon-action primary mutation' data-row-action='restore' data-pkg='${escapeHtml(pkg)}' title='恢复' data-tooltip='恢复' aria-label='恢复' ${disabled}>${actionIcon('restore')}</button><button type='button' class='icon-action extract mutation' data-row-action='pull' data-pkg='${escapeHtml(pkg)}' title='提取 APK' data-tooltip='提取 APK' aria-label='提取 APK' ${disabled}>${actionIcon('pull')}</button><button type='button' class='icon-action ghost mutation' data-row-action='copy' data-pkg='${escapeHtml(pkg)}' title='复制包名' data-tooltip='复制包名' aria-label='复制包名' ${disabled}>${actionIcon('copy')}</button></div></td></tr>`;
  }

  function updateSortIndicators() {
    dom.tableHead.querySelectorAll('button[data-sort]').forEach((button) => {
      const mode = SORT_HEADER_TO_MODE[button.dataset.sort];
      if (!mode) return;
      const prefix = mode.split('-')[0];
      const indicator = button.querySelector('.sort-indicator');
      indicator.textContent = state.sort.indexOf(prefix) === 0 ? (state.sort.endsWith('-desc') ? '↓' : '↑') : '';
    });
  }

  function renderApps() {
    const pageData = getPageData();
    dom.resultSummary.textContent = '筛选后 ' + pageData.filtered.length + ' 项 · 当前页 ' + pageData.pageApps.length + ' 项 · 每页 ' + PAGE_SIZE;
    dom.pageInfo.textContent = '第 ' + pageData.page + ' / ' + pageData.pages + ' 页';
    dom.prevPageBtn.disabled = state.busy || pageData.page <= 1;
    dom.nextPageBtn.disabled = state.busy || pageData.page >= pageData.pages;
    dom.selectAllCheckbox.disabled = state.busy || pageData.pageApps.length === 0;
    dom.selectAllCheckbox.checked = pageData.pageApps.length > 0 && pageData.pageApps.every((app) => state.selected.has(app.pkg));
    dom.selectAllCheckbox.indeterminate = !dom.selectAllCheckbox.checked && pageData.pageApps.some((app) => state.selected.has(app.pkg));
    dom.appsTbody.innerHTML = pageData.pageApps.map(renderAppRow).join('');
    dom.tableEmpty.hidden = pageData.pageApps.length > 0;
    updateSortIndicators();
  }

  function renderFilterStates() {
    dom.searchInput.value = state.search;
    dom.sortSelect.value = state.sort;
    dom.sourceFilters.querySelectorAll('[data-source]').forEach((button) => {
      button.classList.toggle('active', state.sourceFilters.has(button.dataset.source));
    });
    dom.riskFilters.querySelectorAll('[data-risk]').forEach((input) => {
      input.checked = state.riskFilters.has(input.dataset.risk);
    });
    dom.vendorFilters.querySelectorAll('[data-vendor]').forEach((input) => {
      input.checked = state.vendorFilters.has(input.dataset.vendor);
    });
  }

  function renderBatchProgress() {
    const show = state.batch.active || state.batch.results.length > 0;
    dom.batchProgress.hidden = !show;
    if (!show) return;
    const pct = state.batch.total ? Math.round((state.batch.done / state.batch.total) * 100) : 0;
    dom.batchActionLabel.textContent = state.batch.actionLabel || '批量操作进度';
    dom.progressText.textContent = state.batch.done + ' / ' + state.batch.total + (state.batch.active ? ' · 正在执行' : ' · 已完成');
    dom.progressBar.style.width = pct + '%';
    dom.batchResults.innerHTML = state.batch.results.map((result) => {
      const cls = result.skipped ? 'is-skipped' : (result.ok ? 'is-ok' : 'is-error');
      const status = result.skipped ? '跳过' : (result.ok ? '成功' : '失败');
      return `<div class='batch-result ${cls}'><span class='result-status'>${status}</span><code>${escapeHtml(result.pkg)}</code><span class='result-msg' title='${escapeHtml(result.message || '')}'>${escapeHtml(result.message || '')}</span></div>`;
    }).join('');
  }

  function renderBatchBar() {
    const visible = state.selected.size > 0 || state.batch.active || state.batch.results.length > 0;
    dom.batchBar.hidden = !visible;
    dom.selectedCount.textContent = '已选 ' + state.selected.size + ' 项';
    dom.batchUninstallBtn.disabled = state.busy || state.selected.size === 0;
    dom.batchRestoreBtn.disabled = state.busy || state.selected.size === 0;
    dom.batchApkPullBtn.disabled = state.busy || state.selected.size === 0;
    dom.exportPresetBtn.disabled = state.busy || state.selected.size === 0;
    dom.clearSelectionBtn.disabled = state.busy || (!state.selected.size && !state.batch.results.length);
    renderBatchProgress();
  }

  function renderWorkspace() {
    renderStats();
    updateControls();
    renderApps();
    renderBatchBar();
    renderFilterStates();
  }

  function renderAll() {
    renderHealth();
    renderDeviceSelect();
    renderVendorFilters();
    renderWorkspace();
    renderLogs();
  }

  function addLog(action, result) {
    const entry = {
      at: new Date().toISOString(),
      action: action === 'restore' ? '恢复' : (action === 'extract' ? '提取 APK' : '卸载'),
      pkg: result.pkg || '',
      ok: !!result.ok,
      skipped: !!result.skipped,
      command: result.command || '',
      output: formatOutput(result.output != null ? result.output : result.message || '')
    };
    state.logs.unshift(entry);
    if (state.logs.length > 200) state.logs.length = 200;
    renderLogs();
  }

  function renderLogs() {
    dom.logCount.textContent = state.logs.length + ' 条';
    dom.copyLogBtn.disabled = state.logs.length === 0;
    dom.clearLogBtn.disabled = state.logs.length === 0;
    if (!state.logs.length) {
      dom.logBody.innerHTML = `<div class='log-empty'>暂无执行记录。批量卸载、恢复或提取 APK 后，这里会展示实际 adb 命令与输出。</div>`;
      return;
    }
    dom.logBody.innerHTML = state.logs.map((entry) => {
      const cls = entry.skipped ? 'is-skipped' : (entry.ok ? '' : 'is-error');
      const status = entry.skipped ? '跳过' : (entry.ok ? '成功' : '失败');
      return `<div class='log-entry ${cls}'><div class='log-entry-head'><strong>${escapeHtml(status)}</strong><span>${escapeHtml(entry.action)}</span><code>${escapeHtml(entry.pkg)}</code><span>${escapeHtml(formatTime(entry.at))}</span></div><div class='log-command'><span class='prompt'>$</span><code>${escapeHtml(entry.command || '本次未返回命令')}</code></div><pre class='log-output'>${escapeHtml(entry.output || '')}</pre></div>`;
    }).join('');
  }

  function copyLogs() {
    if (!state.logs.length) return;
    const text = state.logs.slice().reverse().map((entry) => {
      const status = entry.skipped ? '跳过' : (entry.ok ? '成功' : '失败');
      return '[' + formatTime(entry.at) + '] [' + status + '] ' + entry.pkg + NL + '$ ' + (entry.command || '本次未返回命令') + NL + (entry.output || '');
    }).join(NL + NL);
    copyText(text).then(() => showToast('success', '日志已复制', '共 ' + state.logs.length + ' 条执行记录'));
  }

  function clearLogs() {
    state.logs = [];
    renderLogs();
    showToast('success', '日志已清空', '执行记录已从本页移除');
  }

  function toggleLogDrawer() {
    const collapsed = dom.logDrawer.classList.toggle('collapsed');
    const open = !collapsed;
    document.body.classList.toggle('log-open', open);
    dom.logToggle.setAttribute('aria-expanded', String(open));
  }

  function freshResult(pkg, item) {
    const source = item && typeof item === 'object' ? item : {};
    const output = source.output != null ? source.output : (source.stdout != null ? source.stdout : (source.stderr != null ? source.stderr : (source.detail != null ? source.detail : source.message)));
    return {
      pkg: source.pkg || pkg,
      ok: !!source.ok,
      message: source.message || '服务未返回逐包结果',
      command: source.command || '',
      output: output || '',
      skipped: false
    };
  }

  function uninstallOne(pkg) {
    return apiFetch(API.uninstall, {
      method: 'POST',
      body: JSON.stringify({ packages: [pkg], keepData: true, force: false })
    }, { loadingText: '正在卸载 ' + pkg }).then((data) => freshResult(pkg, data && Array.isArray(data.results) ? data.results[0] : null));
  }

  function restoreOne(pkg) {
    return apiFetch(API.restore, {
      method: 'POST',
      body: JSON.stringify({ packages: [pkg] })
    }, { loadingText: '正在恢复 ' + pkg }).then((data) => freshResult(pkg, data && Array.isArray(data.results) ? data.results[0] : null));
  }

  function pushBatchResult(result, action) {
    state.batch.results.push(result);
    state.batch.done = Math.min(state.batch.total, state.batch.done + 1);
    renderBatchProgress();
    addLog(action, result);
  }

  function runBatch(action, packages, skipped) {
    if (state.busy) {
      showToast('info', '稍候', '已有任务进行中');
      return Promise.resolve(null);
    }
    const selected = Array.from(new Set(packages || []));
    const skippedList = Array.from(new Set(skipped || []));
    if (!selected.length && !skippedList.length) {
      showToast('info', '请先选择应用', '已选列表为空');
      return Promise.resolve(null);
    }
    return withBusy(action === 'uninstall' ? '正在批量卸载' : '正在批量恢复', async () => {
      state.batch = freshBatch();
      state.batch.active = true;
      state.batch.action = action;
      state.batch.actionLabel = action === 'uninstall' ? '批量卸载进度' : '批量恢复进度';
      state.batch.total = skippedList.length + selected.length;
      renderBatchBar();
      for (const pkg of skippedList) {
        pushBatchResult({ pkg, ok: false, skipped: true, message: '核心组件或取消勾选项已跳过', command: '', output: '' }, action);
      }
      for (const pkg of selected) {
        let result;
        try {
          result = action === 'uninstall' ? await uninstallOne(pkg) : await restoreOne(pkg);
        } catch (err) {
          result = { pkg, ok: false, message: (err && err.message) || '本机服务请求中断', command: '', output: '', skipped: false };
        }
        pushBatchResult(result, action);
      }
      state.batch.active = false;
      state.selected.clear();
      try {
        await loadApps(false, { silent: true });
      } catch (err) {
        showToast('error', '应用清单刷新失败', (err && err.message) || '请稍后重试');
      }
      renderWorkspace();
      const success = state.batch.results.filter((r) => r.ok && !r.skipped).length;
      const failed = state.batch.results.filter((r) => !r.ok && !r.skipped).length;
      const skippedCount = state.batch.results.filter((r) => r.skipped).length;
      showToast('success', '批量操作完成', '成功 ' + success + ' 项，失败 ' + failed + ' 项，跳过 ' + skippedCount + ' 项');
      return true;
    });
  }

  function findApp(pkg) {
    return state.apps.find((app) => app.pkg === pkg) || { pkg, label: pkg, vendor: 'other', risk: 'unknown', note: '', category: '', dangerous: false, known: false };
  }

  function isCriticalApp(app) {
    return !!app && (app.risk === 'critical' || state.critical.has(app.pkg));
  }

  function isDangerApp(app) {
    return !!app && (isCriticalApp(app) || app.risk === 'high' || app.dangerous === true);
  }

  function renderDangerList(dangerApps) {
    dom.dangerList.innerHTML = dangerApps.map((app) => {
      const critical = isCriticalApp(app);
      const checked = critical ? '' : 'checked';
      const disabled = critical ? 'disabled' : '';
      const risk = critical ? 'critical' : (app.risk === 'high' ? 'high' : 'unknown');
      const note = critical ? '核心组件 · 本次跳过' : (app.note || '高风险组件 · 卸载后相关功能会变化');
      return `<label class='danger-item ${critical ? 'is-forbidden' : ''}'><input type='checkbox' data-danger-pkg='${escapeHtml(app.pkg)}' ${checked} ${disabled}><div><span class='danger-name'>${escapeHtml(app.label || app.pkg)} ${critical ? `<span class='forbidden-tag'>禁止</span>` : ''}</span><code class='danger-pkg'>${escapeHtml(app.pkg)}</code><span class='danger-note'>${escapeHtml(note)}</span></div><span class='risk-badge risk-${risk}'>${escapeHtml(RISK_LABELS[risk])}</span></label>`;
    }).join('');
  }

  function updateDangerButton() {
    const chosen = Array.from(dom.dangerList.querySelectorAll('input[data-danger-pkg]')).filter((input) => input.checked && !input.disabled).map((input) => input.dataset.dangerPkg);
    const pending = state.pendingUninstall;
    const finalCount = pending ? pending.nonDangerPkgs.length + chosen.length : chosen.length;
    const phraseOk = dom.dangerConfirmInput.value.trim() === '确认卸载';
    const ready = dom.riskAck.checked && phraseOk && finalCount > 0;
    dom.dangerStartBtn.disabled = !ready;
    if (finalCount === 0) {
      dom.dangerHint.textContent = '选中项仅含核心组件，请返回调整选择。';
    } else if (!ready) {
      dom.dangerHint.textContent = '请勾选风险确认并输入「确认卸载」。';
    } else {
      dom.dangerHint.textContent = '核心组件已排除；高风险项与其余选中项将逐包卸载。';
    }
  }

  function openDangerModal(pkgs) {
    if (state.busy) return;
    closeModals();
    const apps = pkgs.map(findApp);
    const dangerApps = apps.filter(isDangerApp);
    const dangerPkgSet = new Set(dangerApps.map((app) => app.pkg));
    const nonDangerPkgs = pkgs.filter((pkg) => !dangerPkgSet.has(pkg));
    if (!dangerApps.length) {
      runBatch('uninstall', pkgs, []);
      return;
    }
    state.pendingUninstall = { packages: pkgs.slice(), nonDangerPkgs, dangerApps };
    renderDangerList(dangerApps);
    dom.riskAck.checked = false;
    dom.dangerConfirmInput.value = '';
    dom.dangerStartBtn.disabled = true;
    dom.dangerModal.hidden = false;
    state.modal = 'danger';
    updateDangerButton();
    setTimeout(() => dom.dangerConfirmInput.focus(), 0);
  }

  function startDangerUninstall() {
    if (state.busy || !state.pendingUninstall) return;
    const pending = state.pendingUninstall;
    const chosen = Array.from(dom.dangerList.querySelectorAll('input[data-danger-pkg]')).filter((input) => input.checked && !input.disabled).map((input) => input.dataset.dangerPkg);
    const finalPackages = Array.from(new Set(pending.nonDangerPkgs.concat(chosen)));
    const skipped = pending.packages.filter((pkg) => finalPackages.indexOf(pkg) === -1);
    closeModals();
    runBatch('uninstall', finalPackages, skipped);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {}
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (err) {}
    area.remove();
    return true;
  }

  function copyPackage(pkg) {
    copyText(pkg).then(() => showToast('success', '包名已复制', pkg));
  }

  function openExportsFolder(path) {
    if (state.busy) {
      showToast('info', '稍候', '已有任务进行中');
      return Promise.resolve(null);
    }
    return withBusy('正在打开导出文件夹', async () => {
      const data = await apiFetch(API.apkOpen, { method: 'POST', body: JSON.stringify({ path: path || null }) }, { loadingText: '正在打开导出文件夹' });
      showToast('success', '已请求系统文件管理器', data.root || data.path || path || '导出目录');
      return data;
    });
  }

  function openApkHistory() {
    if (state.busy) return;
    openApkModal({ history: true });
    loadApkExports();
  }

  function openApkModal(options) {
    const opts = options || {};
    closeModals();
    if (opts.reset) {
      const history = state.apk.history;
      const root = state.apk.root || (state.health && state.health.exportsDir) || '';
      state.apk = freshApk();
      state.apk.history = history;
      state.apk.root = root;
      state.apk.historyVisible = !!opts.history;
    }
    if (opts.history) state.apk.historyVisible = true;
    dom.apkModal.hidden = false;
    state.modal = 'apk';
    renderApkModal();
  }

  function renderApkModal() {
    const apk = state.apk;
    const pct = apk.total ? Math.round((apk.done / apk.total) * 100) : 0;
    if (apk.active) {
      const index = Math.min(apk.done + 1, apk.total);
      dom.apkProgressText.textContent = '正在提取第 ' + index + '/' + apk.total + ' 个' + (apk.currentLabel ? ' · ' + apk.currentLabel : '');
    } else if (apk.total) {
      const success = apk.results.filter((item) => item.ok).length;
      const failed = apk.results.length - success;
      dom.apkProgressText.textContent = '提取完成 · 成功 ' + success + ' 项，失败 ' + failed + ' 项';
    } else {
      dom.apkProgressText.textContent = '准备提取 APK';
    }
    dom.apkProgressCount.textContent = apk.done + ' / ' + apk.total;
    dom.apkProgressBar.style.width = pct + '%';
    dom.apkRootText.textContent = apk.root || (state.health && state.health.exportsDir) || '等待提取结果…';
    dom.apkResults.innerHTML = apk.results.length ? apk.results.map(renderApkResult).join('') : `<div class='apk-empty'>尚未执行提取。选择应用后点击「提取 APK」开始。</div>`;
    dom.apkHistorySection.hidden = !apk.historyVisible;
    renderApkHistory();
  }

  function renderApkResult(result) {
    const files = Array.isArray(result.files) ? result.files : [];
    const count = numberOr(result.count, files.length || numberOr(result.pathCount, 0));
    const split = !!result.split || count > 1 || files.some((file) => file.split);
    const dir = result.dir || state.apk.root || (state.health && state.health.exportsDir) || '';
    const status = result.ok ? '成功' : '失败';
    const cls = result.ok ? 'is-ok' : 'is-error';
    const filesHtml = files.length ? files.map((file) => `<div class='apk-file'><span class='apk-file-name' title='${escapeHtml(file.name || '')}'>${escapeHtml(file.name || '未命名文件')}</span><span>${formatBytes(file.size)}</span><code title='${escapeHtml(file.sha256 || '')}'>SHA-256 ${shortHash(file.sha256)}</code>${file.skipped ? `<span class='apk-skip'>已跳过</span>` : ''}</div>`).join('') : `<div class='apk-empty small'>本次未返回文件明细。</div>`;
    const splitHint = split ? (result.ok ? `<div class='apk-split-hint'><strong>该应用由 ${count} 个分片组成，已全部提取</strong><span>安装回手机提示命令</span><code class='apk-install-cmd'>adb install-multiple &lt;该目录下所有 .apk&gt;</code></div>` : `<div class='apk-split-hint'><strong>该应用由 ${count} 个分片组成，请查看失败原因。</strong></div>`) : '';
    const errorHtml = result.error ? `<div class='apk-error'>${escapeHtml(result.error)}</div>` : '';
    return `<article class='apk-result ${cls}'><div class='apk-result-head'><div class='apk-result-title'><strong>${escapeHtml(result.label || result.pkg)}</strong><code>${escapeHtml(result.pkg)}</code></div><span class='apk-status'>${status}</span></div><div class='apk-result-meta'><span>${count} 个分片</span><span>${formatBytes(result.totalBytes)}</span><span>${files.length} 个文件</span></div><code class='apk-dir' title='${escapeHtml(dir)}'>${escapeHtml(dir || '等待返回目录')}</code>${errorHtml}<div class='apk-file-list'>${filesHtml}</div>${splitHint}</article>`;
  }

  function renderApkHistory() {
    if (!state.apk.history.length) {
      dom.apkHistoryList.innerHTML = `<div class='apk-empty small'>暂无导出记录。</div>`;
      return;
    }
    dom.apkHistoryList.innerHTML = state.apk.history.map((item) => {
      const files = Array.isArray(item.files) ? item.files : [];
      const dir = item.dir || state.apk.root || (state.health && state.health.exportsDir) || '';
      const fileHtml = files.length ? `<div class='apk-history-files'>${files.map((file) => `<span title='${escapeHtml(file.sha256 || '')}'>${escapeHtml(file.name || '未命名文件')} · ${shortHash(file.sha256)}</span>`).join('')}</div>` : '';
      return `<div class='apk-history-item'><div class='apk-history-head'><strong>${escapeHtml(item.label || item.pkg)}</strong><button type='button' class='btn btn-ghost btn-sm mutation apk-open-path' data-apk-open-path='${escapeHtml(dir)}'>打开此目录</button></div><div class='apk-history-meta'><span>${escapeHtml(item.pkg)}</span><span>${escapeHtml(item.serial || '本机设备')}</span><span>${numberOr(item.count, files.length)} 个分片</span><span>${formatBytes(item.totalBytes)}</span><span>${escapeHtml(formatTime(item.at))}</span></div><code class='apk-dir' title='${escapeHtml(dir)}'>${escapeHtml(dir || '等待返回目录')}</code>${fileHtml}</div>`;
    }).join('');
  }

  function loadApkExports() {
    if (state.busy) {
      showToast('info', '稍候', '已有任务进行中');
      return Promise.resolve(null);
    }
    return withBusy('正在读取导出记录', async () => {
      const data = await apiFetch(API.apkExports, {}, { loadingText: '正在读取导出记录' });
      state.apk.history = Array.isArray(data.items) ? data.items : [];
      state.apk.root = data.root || state.apk.root;
      state.apk.historyVisible = true;
      renderApkModal();
      showToast('success', '导出记录已更新', '共 ' + state.apk.history.length + ' 条');
      return data;
    });
  }

  function normalizeApkResult(pkg, item, pathInfo, outputDir) {
    const source = item && typeof item === 'object' ? item : {};
    const files = Array.isArray(source.files) ? source.files : [];
    const pathCount = numberOr(pathInfo && pathInfo.count, 0);
    const count = numberOr(source.count, files.length || pathCount);
    return {
      pkg: source.pkg || pkg,
      label: source.label || findApp(pkg).label || pkg,
      ok: !!source.ok,
      dir: source.dir || outputDir || '',
      count,
      totalBytes: numberOr(source.totalBytes, files.reduce((sum, file) => sum + numberOr(file.size, 0), 0)),
      files,
      split: !!(pathInfo && pathInfo.split) || count > 1 || files.some((file) => file.split),
      pathCount,
      paths: pathInfo && Array.isArray(pathInfo.paths) ? pathInfo.paths : [],
      error: source.error || ''
    };
  }

  function addApkLog(result) {
    const files = Array.isArray(result.files) ? result.files : [];
    if (!files.length) {
      addLog('extract', { pkg: result.pkg, ok: !!result.ok, skipped: false, command: '', output: result.error || '未返回文件明细' });
      return;
    }
    files.forEach((file) => {
      addLog('extract', {
        pkg: result.pkg,
        ok: !file.skipped && !!result.ok,
        skipped: !!file.skipped,
        command: file.command || '',
        output: [file.name, formatBytes(file.size), file.sha256].filter(Boolean).join(' · ')
      });
    });
  }

  async function pullOneApk(pkg, index, total) {
    const label = findApp(pkg).label || pkg;
    let pathInfo = null;
    try {
      pathInfo = await apiFetch(API.apkPaths + encodeURIComponent(pkg), {}, { silent: true, loadingText: '正在读取第 ' + index + '/' + total + ' 个 APK 路径 · ' + label });
    } catch (err) {
      showToast('warn', '路径读取未完成', (err && err.message) || '请稍后重试');
    }
    const data = await apiFetch(API.apkPull, {
      method: 'POST',
      body: JSON.stringify({ packages: [pkg], outputDir: state.exportDir || null, skipExisting: true })
    }, { loadingText: '正在提取第 ' + index + '/' + total + ' 个 · ' + label });
    const item = data && Array.isArray(data.results) ? data.results[0] : null;
    if (!item) {
      return { data, result: { pkg, label, ok: false, dir: data && data.outputDir ? data.outputDir : '', count: 0, totalBytes: 0, files: [], split: false, pathCount: pathInfo ? numberOr(pathInfo.count, 0) : 0, paths: [], error: '服务未返回逐包提取结果' } };
    }
    return { data, result: normalizeApkResult(pkg, item, pathInfo, data && data.outputDir) };
  }

  function startApkPull(packages) {
    if (state.busy) {
      showToast('info', '稍候', '已有任务进行中');
      return Promise.resolve(null);
    }
    const pkgs = Array.from(new Set(packages || []));
    if (!pkgs.length) {
      showToast('info', '请先选择应用', '已选列表为空');
      return Promise.resolve(null);
    }
    openApkModal({ reset: true });
    return withBusy('正在提取 APK', async () => {
      state.apk.active = true;
      state.apk.total = pkgs.length;
      state.apk.done = 0;
      state.apk.results = [];
      state.apk.root = state.exportDir || (state.health && state.health.exportsDir) || '';
      state.apk.currentIndex = 1;
      state.apk.currentPkg = pkgs[0];
      state.apk.currentLabel = findApp(pkgs[0]).label || pkgs[0];
      renderApkModal();
      for (let i = 0; i < pkgs.length; i += 1) {
        const pkg = pkgs[i];
        const label = findApp(pkg).label || pkg;
        state.apk.currentIndex = i + 1;
        state.apk.currentPkg = pkg;
        state.apk.currentLabel = label;
        renderApkModal();
        let result;
        try {
          const pulled = await pullOneApk(pkg, i + 1, pkgs.length);
          if (pulled.data && pulled.data.outputDir) state.apk.root = pulled.data.outputDir;
          result = pulled.result;
        } catch (err) {
          result = { pkg, label, ok: false, dir: '', count: 0, totalBytes: 0, files: [], split: false, pathCount: 0, paths: [], error: (err && err.message) || '本机服务请求中断' };
        }
        state.apk.results.push(result);
        state.apk.done = i + 1;
        renderApkModal();
        addApkLog(result);
      }
      state.apk.active = false;
      state.apk.currentIndex = pkgs.length;
      renderApkModal();
      const success = state.apk.results.filter((item) => item.ok).length;
      const failed = state.apk.results.length - success;
      showToast('success', 'APK 提取完成', '成功 ' + success + ' 项，失败 ' + failed + ' 项');
      return true;
    });
  }

  function onBatchApkPull() {
    if (state.busy) return;
    const packages = Array.from(state.selected);
    if (!packages.length) {
      showToast('info', '请先选择应用', '已选列表为空');
      return;
    }
    startApkPull(packages);
  }

  function onApkHistoryClick(event) {
    const button = event.target.closest('[data-apk-open-path]');
    if (!button) return;
    openExportsFolder(button.dataset.apkOpenPath || null);
  }

  function exportPreset() {
    if (state.busy) return;
    const packages = Array.from(state.selected);
    if (!packages.length) {
      showToast('info', '请先选择应用', '导出内容为空');
      return;
    }
    const payload = {
      name: '自定义方案',
      description: '由 ADB 预装应用管理器导出，共 ' + packages.length + ' 个包',
      createdAt: new Date().toISOString(),
      source: 'ADB 预装应用管理器',
      packages
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = 'preset-' + stamp + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('success', '方案已导出', '共 ' + packages.length + ' 个包名');
  }

  function clearSelection() {
    if (state.busy) return;
    state.selected.clear();
    state.batch = freshBatch();
    renderWorkspace();
    showToast('info', '选择已清空', '已选列表与批量结果已重置');
  }

  function applyPreset(key) {
    if (state.busy) return;
    const preset = state.presets.find((item) => String(item.key) === String(key)) || fallbackPresets().find((item) => String(item.key) === String(key));
    if (!preset) return;
    const installed = new Set(state.apps.filter((app) => app.state !== 'uninstalled').map((app) => app.pkg));
    const matched = (preset.packages || []).filter((pkg) => installed.has(pkg));
    matched.forEach((pkg) => state.selected.add(pkg));
    renderWorkspace();
    showToast(matched.length ? 'success' : 'info', '方案已应用', '已勾选 ' + matched.length + ' 个仍安装的应用');
    if (dom.tableWrap) dom.tableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (window.matchMedia('(max-width: 980px)').matches) closeSidebar();
  }

  function clearFilters() {
    state.search = '';
    state.sourceFilters = new Set(['all']);
    state.riskFilters = new Set();
    state.vendorFilters = new Set();
    state.sort = 'risk-asc';
    state.currentPage = 1;
    renderWorkspace();
  }

  function normalizePresets(raw) {
    let list = [];
    if (Array.isArray(raw)) {
      list = raw.map((preset, index) => Object.assign({ key: String(index) }, preset || {}));
    } else if (raw && typeof raw === 'object') {
      list = Object.keys(raw).map((key) => Object.assign({ key }, raw[key] || {}));
    }
    list = list.map((preset, index) => Object.assign({ key: String(index), name: '预设方案', description: '', vendor: 'other', packages: [] }, preset));
    if (list.length < 6) list = list.concat(fallbackPresets());
    const seen = new Set();
    list = list.filter((preset) => {
      const key = String(preset.key);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return list.slice(0, Math.max(7, list.length));
  }

  function handleSettledFailures(settled, labels) {
    settled.forEach((item, index) => {
      if (item.status !== 'rejected') return;
      const err = item.reason;
      if (err && err.toasted) return;
      showToast('error', (labels[index] || '请求') + '读取失败', (err && err.message) || '请稍后重试');
    });
  }

  function isAdbMissing() {
    const health = state.health || {};
    return !health.demo && (!health.adbPath || !!health.adbError);
  }

  function chooseReadyDevice() {
    let saved = '';
    try { saved = localStorage.getItem(STORAGE_SERIAL) || ''; } catch (err) {}
    if (saved && state.devices.some((d) => d.serial === saved && d.state === 'device')) return saved;
    const first = state.devices.find((d) => d.state === 'device');
    return first ? first.serial : '';
  }

  function hasPendingAuthDevice() {
    return state.devices.some((d) => d.state === PENDING_AUTH || d.state === 'no permissions');
  }

  async function selectDevice(serial, options) {
    const opts = options || {};
    try {
      await apiFetch(API.selectDevice, { method: 'POST', body: JSON.stringify({ serial }) }, { silent: !!opts.silent, loadingText: '正在切换设备' });
      state.currentSerial = serial;
      try { localStorage.setItem(STORAGE_SERIAL, serial); } catch (err) {}
      renderDeviceSelect();
      if (!opts.silent) showToast('success', '设备已切换', serial);
      return true;
    } catch (err) {
      if (!opts.silent) showToast('error', '设备切换未完成', (err && err.message) || '请稍后重试');
      return false;
    }
  }

  function pruneSelection() {
    const existing = new Set(state.apps.map((app) => app.pkg));
    Array.from(state.selected).forEach((pkg) => { if (!existing.has(pkg)) state.selected.delete(pkg); });
  }

  async function loadApps(force, options) {
    const opts = options || {};
    setTableLoading(true, force ? '正在强制重采应用清单…' : '正在采集应用清单…');
    try {
      const data = await apiFetch(force ? API.appsRefresh : API.apps, {}, { silent: !!opts.silent, loadingText: '正在采集应用清单' });
      state.apps = Array.isArray(data.apps) ? data.apps : [];
      state.stats = data.stats || {};
      state.device = data.device || null;
      pruneSelection();
      state.currentPage = 1;
      renderVendorFilters();
      showContent();
      renderWorkspace();
      return data;
    } catch (err) {
      state.apps = [];
      state.stats = {};
      renderWorkspace();
      const message = (err && err.message) || '';
      if (/未检测到|授权|设备/i.test(message)) renderEmptyState(hasPendingAuthDevice() ? 'pending-auth' : 'device', message);
      else renderEmptyState('error', message);
      throw err;
    } finally {
      setTableLoading(false);
    }
  }

  async function refreshAll(options) {
    const opts = options || {};
    const force = !!opts.force;
    return withBusy('正在刷新本机状态', async () => {
      const settled = await Promise.allSettled([
        apiFetch(API.health, {}, { loadingText: '正在检查 ADB 状态' }),
        apiFetch(API.devices, {}, { loadingText: '正在读取设备列表' }),
        apiFetch(API.catalog, {}, { loadingText: '正在读取应用目录' }),
        apiFetch(API.config, {}, { loadingText: '正在读取本机配置' })
      ]);
      handleSettledFailures(settled, ['ADB 状态', '设备列表', '应用目录', '本机配置']);
      const health = settled[0].status === 'fulfilled' ? settled[0].value : (state.health || {});
      const devicesData = settled[1].status === 'fulfilled' ? settled[1].value : { devices: [] };
      const catalogData = settled[2].status === 'fulfilled' ? settled[2].value : {};
      const configData = settled[3].status === 'fulfilled' ? settled[3].value : {};
      state.health = health;
      state.devices = Array.isArray(devicesData.devices) ? devicesData.devices : [];
      state.config = Object.assign({}, state.config, configData.config || {});
      state.catalog = catalogData.catalog || {};
      state.vendorLabels = Object.assign({}, FALLBACK_VENDOR_LABELS, catalogData.vendorLabels || {});
      state.critical = new Set(Array.isArray(catalogData.critical) && catalogData.critical.length ? catalogData.critical : FALLBACK_CRITICAL);
      state.presets = normalizePresets(catalogData.presets);
      renderPresets();
      renderVendorFilters();
      renderHealth();
      renderDeviceSelect();
      renderWorkspace();
      if (isAdbMissing()) {
        renderEmptyState('adb', state.health && state.health.adbError ? state.health.adbError : '');
        return;
      }
      const ready = chooseReadyDevice();
      if (!ready) {
        renderEmptyState(hasPendingAuthDevice() ? 'pending-auth' : 'device');
        return;
      }
      const ok = await selectDevice(ready, { silent: true });
      if (!ok) {
        renderEmptyState('device');
        showToast('warn', '设备切换未完成', '请检查设备状态后重试');
        return;
      }
      await loadApps(force);
    });
  }

  async function postConfig(patch) {
    const data = await apiFetch(API.config, { method: 'POST', body: JSON.stringify(patch) }, { loadingText: '正在保存设置' });
    if (data && data.health) {
      state.health = data.health;
      state.config = Object.assign({}, state.config, data.health.config || {});
      renderHealth();
    }
    return data;
  }

  function readTimeout() {
    const value = Number(dom.timeoutInput.value);
    if (!Number.isFinite(value) || value < 1000 || value > 120000) {
      showToast('error', '超时范围', '请输入 1000–120000 毫秒');
      return null;
    }
    return Math.round(value);
  }

  async function autoDetectAdb() {
    if (state.busy) return;
    let ok = false;
    await withBusy('正在探测 ADB', async () => {
      const timeout = readTimeout();
      if (timeout == null) return;
      const data = await postConfig({ timeoutMs: timeout });
      const health = (data && data.health) || state.health || {};
      dom.adbPathInput.value = health.adbPath || '';
      dom.timeoutInput.value = String((health.config && health.config.timeoutMs) || timeout);
      dom.settingsStatus.textContent = health.adbPath ? '探测完成，已读取 ADB 路径。' : '探测完成，路径仍为空，请手动填写。';
      showToast(health.adbPath ? 'success' : 'info', '自动探测完成', health.adbPath || '本机服务已完成路径探测');
      const devices = await apiFetch(API.devices, {}, { loadingText: '正在刷新设备列表' });
      state.devices = Array.isArray(devices.devices) ? devices.devices : [];
      renderDeviceSelect();
      ok = true;
    });
    if (ok) await refreshAll({ force: false });
  }

  async function saveSettings() {
    if (state.busy) return;
    const timeout = readTimeout();
    if (timeout == null) return;
    const adbPath = dom.adbPathInput.value.trim();
    const exportDir = dom.exportDirInput.value.trim();
    const localChanged = exportDir !== state.exportDir;
    state.exportDir = exportDir;
    try { localStorage.setItem(STORAGE_EXPORT_DIR, exportDir); } catch (err) {}
    const currentTimeout = numberOr((state.config && state.config.timeoutMs) || (state.health && state.health.config && state.health.config.timeoutMs), 15000);
    const patches = [];
    if (adbPath) patches.push({ adbPath });
    if (timeout !== currentTimeout) patches.push({ timeoutMs: timeout });
    if (!patches.length) {
      closeModals();
      showToast(localChanged ? 'success' : 'info', localChanged ? '设置已保存' : '设置无变化', localChanged ? '导出目录已记录在本页，提取时将作为 outputDir 使用' : 'ADB 路径与超时保持当前值');
      return;
    }
    const result = await withBusy('正在保存设置', async () => {
      for (const patch of patches) await postConfig(patch);
      dom.settingsStatus.textContent = '设置已保存，正在刷新状态…';
      return true;
    });
    if (result) {
      closeModals();
      await refreshAll({ force: false });
      showToast('success', '设置已保存', localChanged ? 'ADB 路径、超时与导出目录已生效' : 'ADB 路径与超时已写入本机配置');
    }
  }

  function openSettings() {
    if (state.busy) return;
    closeModals();
    dom.adbPathInput.value = (state.config && state.config.adbPath) || (state.health && state.health.adbPath) || '';
    dom.timeoutInput.value = String((state.config && state.config.timeoutMs) || (state.health && state.health.config && state.health.config.timeoutMs) || 15000);
    dom.exportDirInput.value = state.exportDir || '';
    if (dom.defaultExportsDir) dom.defaultExportsDir.textContent = (state.health && state.health.exportsDir) || 'exports/<serial>';
    dom.settingsStatus.textContent = '';
    renderThemeButtons();
    dom.settingsModal.hidden = false;
    state.modal = 'settings';
    setTimeout(() => dom.adbPathInput.focus(), 0);
  }

  function closeModals() {
    dom.dangerModal.hidden = true;
    dom.settingsModal.hidden = true;
    dom.apkModal.hidden = true;
    dom.riskAck.checked = false;
    dom.dangerConfirmInput.value = '';
    dom.dangerStartBtn.disabled = true;
    state.pendingUninstall = null;
    state.modal = null;
  }

  function closeOnBackdrop(event, modal) {
    if (event.target === modal) closeModals();
  }

  function onToastClose(event) {
    const button = event.target.closest('[data-toast-close]');
    if (!button) return;
    const toast = button.closest('.toast');
    if (toast) toast.remove();
  }

  function onEmptyActionClick(event) {
    const button = event.target.closest('[data-empty-action]');
    if (!button) return;
    if (button.dataset.emptyAction === 'settings') openSettings();
    if (button.dataset.emptyAction === 'refresh') refreshAll({ force: true });
  }

  function onHeaderSortClick(event) {
    if (state.busy) return;
    const button = event.target.closest('button[data-sort]');
    if (!button) return;
    const mode = SORT_HEADER_TO_MODE[button.dataset.sort];
    if (!mode) return;
    state.sort = state.sort === mode ? mode.replace('-asc', '-desc') : mode;
    state.currentPage = 1;
    renderWorkspace();
  }

  function onSortChange(event) {
    if (state.busy) return;
    state.sort = event.target.value;
    state.currentPage = 1;
    renderWorkspace();
  }

  function onSourceClick(event) {
    if (state.busy) return;
    const button = event.target.closest('[data-source]');
    if (!button) return;
    const key = button.dataset.source;
    if (key === 'all') {
      state.sourceFilters = new Set(['all']);
    } else {
      state.sourceFilters.delete('all');
      if (state.sourceFilters.has(key)) state.sourceFilters.delete(key);
      else state.sourceFilters.add(key);
      if (!state.sourceFilters.size) state.sourceFilters.add('all');
    }
    state.currentPage = 1;
    renderWorkspace();
  }

  function onRiskChange(event) {
    if (state.busy) return;
    const input = event.target.closest('input[data-risk]');
    if (!input) return;
    if (input.checked) state.riskFilters.add(input.dataset.risk);
    else state.riskFilters.delete(input.dataset.risk);
    state.currentPage = 1;
    renderWorkspace();
  }

  function onVendorChange(event) {
    if (state.busy) return;
    const input = event.target.closest('input[data-vendor]');
    if (!input) return;
    if (input.checked) state.vendorFilters.add(input.dataset.vendor);
    else state.vendorFilters.delete(input.dataset.vendor);
    state.currentPage = 1;
    renderWorkspace();
  }

  function onSearchInput(event) {
    state.search = event.target.value;
    state.currentPage = 1;
    renderWorkspace();
  }

  function onSelectAllChange(event) {
    if (state.busy) return;
    const pageData = getPageData();
    pageData.pageApps.forEach((app) => {
      if (event.target.checked) state.selected.add(app.pkg);
      else state.selected.delete(app.pkg);
    });
    renderWorkspace();
  }

  function onRowCheckboxChange(event) {
    if (state.busy) return;
    const input = event.target.closest('input[data-select]');
    if (!input) return;
    if (input.checked) state.selected.add(input.dataset.select);
    else state.selected.delete(input.dataset.select);
    renderWorkspace();
  }

  function onRowActionClick(event) {
    if (state.busy) return;
    const button = event.target.closest('button[data-row-action]');
    if (!button) return;
    const pkg = button.dataset.pkg;
    const action = button.dataset.rowAction;
    if (action === 'uninstall') openDangerModal([pkg]);
    else if (action === 'restore') runBatch('restore', [pkg], []);
    else if (action === 'pull') startApkPull([pkg]);
    else if (action === 'copy') copyPackage(pkg);
  }

  function onBatchUninstall() {
    if (state.busy) return;
    const packages = Array.from(state.selected);
    if (!packages.length) {
      showToast('info', '请先选择应用', '已选列表为空');
      return;
    }
    openDangerModal(packages);
  }

  function onBatchRestore() {
    if (state.busy) return;
    const packages = Array.from(state.selected);
    if (!packages.length) {
      showToast('info', '请先选择应用', '已选列表为空');
      return;
    }
    runBatch('restore', packages, []);
  }

  function onDeviceChange(event) {
    if (state.busy) return;
    const serial = event.target.value;
    if (!serial) return;
    withBusy('正在切换设备', async () => {
      const ok = await selectDevice(serial, { silent: true });
      if (!ok) {
        renderEmptyState('device');
        showToast('warn', '设备切换未完成', '请检查设备状态后重试');
        return;
      }
      await loadApps(false);
    });
  }

  function onPresetClick(event) {
    if (state.busy) return;
    const button = event.target.closest('[data-preset]');
    if (!button) return;
    applyPreset(button.dataset.preset);
  }

  function onKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'f') {
      event.preventDefault();
      if (window.matchMedia('(max-width: 980px)').matches) document.body.classList.add('sidebar-open');
      dom.searchInput.focus();
      dom.searchInput.select();
      showToast('info', '已定位到应用搜索');
      return;
    }
    if (event.key === 'Escape') {
      closeModals();
      closeSidebar();
    }
  }

  function cacheDom() {
    const ids = [
      'sidebarToggle', 'adbBadge', 'deviceSelect', 'refreshBtn', 'demoBadge', 'themeBtn', 'settingsBtn',
      'globalLoading', 'globalLoadingText', 'sidebarBackdrop', 'sidebar', 'sidebarCloseBtn', 'searchInput',
      'sourceFilters', 'riskFilters', 'vendorFilters', 'clearFiltersBtn', 'presetCount', 'presetList',
      'emptyState', 'contentPanel', 'statsRow', 'resultSummary', 'sortSelect', 'selectAllCheckbox',
      'pageInfo', 'prevPageBtn', 'nextPageBtn', 'loadingOverlay', 'loadingText', 'appsTable',
      'appsTableHead', 'appsTbody', 'tableEmpty', 'batchBar', 'selectedCount', 'batchUninstallBtn',
      'batchRestoreBtn', 'exportPresetBtn', 'clearSelectionBtn', 'batchProgress', 'batchActionLabel',
      'progressBar', 'progressText', 'batchResults', 'logDrawer', 'logToggle', 'logCount', 'copyLogBtn',
      'clearLogBtn', 'logBody', 'dangerModal', 'dangerCloseBtn', 'dangerList', 'riskAck',
      'dangerConfirmInput', 'dangerHint', 'dangerCancelBtn', 'dangerStartBtn', 'settingsModal',
      'settingsCloseBtn', 'adbPathInput', 'autoDetectBtn', 'timeoutInput', 'themeDarkBtn',
      'themeLightBtn', 'settingsStatus', 'settingsCancelBtn', 'saveSettingsBtn', 'toastContainer',
      'apkExportsBtn', 'batchApkPullBtn', 'exportDirInput', 'defaultExportsDir', 'settingsOpenExportsBtn',
      'apkModal', 'apkCloseBtn', 'apkProgressText', 'apkProgressCount', 'apkProgressBar', 'apkRootText',
      'apkOpenFolderBtn', 'apkHistoryBtn', 'apkResults', 'apkHistorySection', 'apkHistoryList', 'apkCancelBtn'
    ];
    ids.forEach((id) => { dom[id] = $(id); });
    dom.tableHead = dom.appsTableHead;
    dom.tableWrap = document.querySelector('.table-wrap');
  }

  function bindEvents() {
    dom.refreshBtn.addEventListener('click', () => refreshAll({ force: true }));
    dom.apkExportsBtn.addEventListener('click', openApkHistory);
    dom.themeBtn.addEventListener('click', toggleTheme);
    dom.settingsBtn.addEventListener('click', openSettings);
    dom.sidebarToggle.addEventListener('click', toggleSidebar);
    dom.sidebarCloseBtn.addEventListener('click', closeSidebar);
    dom.sidebarBackdrop.addEventListener('click', closeSidebar);
    dom.deviceSelect.addEventListener('change', onDeviceChange);
    dom.searchInput.addEventListener('input', onSearchInput);
    dom.clearFiltersBtn.addEventListener('click', clearFilters);
    dom.sourceFilters.addEventListener('click', onSourceClick);
    dom.riskFilters.addEventListener('change', onRiskChange);
    dom.vendorFilters.addEventListener('change', onVendorChange);
    dom.presetList.addEventListener('click', onPresetClick);
    dom.sortSelect.addEventListener('change', onSortChange);
    dom.selectAllCheckbox.addEventListener('change', onSelectAllChange);
    dom.prevPageBtn.addEventListener('click', () => { if (state.busy) return; state.currentPage -= 1; renderWorkspace(); });
    dom.nextPageBtn.addEventListener('click', () => { if (state.busy) return; state.currentPage += 1; renderWorkspace(); });
    dom.appsTbody.addEventListener('change', onRowCheckboxChange);
    dom.appsTbody.addEventListener('click', onRowActionClick);
    dom.tableHead.addEventListener('click', onHeaderSortClick);
    dom.batchUninstallBtn.addEventListener('click', onBatchUninstall);
    dom.batchRestoreBtn.addEventListener('click', onBatchRestore);
    dom.batchApkPullBtn.addEventListener('click', onBatchApkPull);
    dom.exportPresetBtn.addEventListener('click', exportPreset);
    dom.clearSelectionBtn.addEventListener('click', clearSelection);
    dom.logToggle.addEventListener('click', toggleLogDrawer);
    dom.copyLogBtn.addEventListener('click', copyLogs);
    dom.clearLogBtn.addEventListener('click', clearLogs);
    dom.emptyState.addEventListener('click', onEmptyActionClick);
    dom.dangerCloseBtn.addEventListener('click', closeModals);
    dom.dangerCancelBtn.addEventListener('click', closeModals);
    dom.dangerModal.addEventListener('click', (event) => closeOnBackdrop(event, dom.dangerModal));
    dom.riskAck.addEventListener('change', updateDangerButton);
    dom.dangerConfirmInput.addEventListener('input', updateDangerButton);
    dom.dangerList.addEventListener('change', updateDangerButton);
    dom.dangerStartBtn.addEventListener('click', startDangerUninstall);
    dom.settingsCloseBtn.addEventListener('click', closeModals);
    dom.settingsCancelBtn.addEventListener('click', closeModals);
    dom.settingsModal.addEventListener('click', (event) => closeOnBackdrop(event, dom.settingsModal));
    dom.autoDetectBtn.addEventListener('click', autoDetectAdb);
    dom.settingsOpenExportsBtn.addEventListener('click', () => openExportsFolder(state.exportDir || null));
    dom.saveSettingsBtn.addEventListener('click', saveSettings);
    dom.apkCloseBtn.addEventListener('click', closeModals);
    dom.apkCancelBtn.addEventListener('click', closeModals);
    dom.apkModal.addEventListener('click', (event) => closeOnBackdrop(event, dom.apkModal));
    dom.apkOpenFolderBtn.addEventListener('click', () => openExportsFolder(state.apk.root || null));
    dom.apkHistoryBtn.addEventListener('click', loadApkExports);
    dom.apkHistoryList.addEventListener('click', onApkHistoryClick);
    dom.themeDarkBtn.addEventListener('click', () => applyTheme('dark'));
    dom.themeLightBtn.addEventListener('click', () => applyTheme('light'));
    dom.toastContainer.addEventListener('click', onToastClose);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', () => { if (window.innerWidth > 980) closeSidebar(); });
  }

  function init() {
    cacheDom();
    state.exportDir = readExportDir();
    applyTheme(readTheme());
    bindEvents();
    renderStaticFilters();
    renderPresets();
    renderVendorFilters();
    renderEmptyState('loading');
    renderLogs();
    renderWorkspace();
    refreshAll({ force: false, initial: true });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
