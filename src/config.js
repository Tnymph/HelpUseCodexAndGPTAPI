'use strict';
/**
 * 全局配置：本项目的全部"魔法值"集中在这里。
 * 来源：skills\04-本机软件与文件地址清单.md（2026-10-11 本机实测）。
 */
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

const baseConfig = {
  PROJECT_ROOT,
  STATE_DIR: path.join(PROJECT_ROOT, 'state'),

  // .cmd 启动器的窗口标题（程序B 靠它识别"项目相关 cmd 窗口"）
  WINDOW_TITLES: { start: 'GPT-Proxy-Start', stop: 'GPT-Proxy-Stop' },

  chatgpt: {
    aumid: 'OpenAI.Codex_2p2nqsd0c76g0!App',
    launchArg: 'shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App',
    // 关闭范围：ChatGPT 应用本体 + Codex 相关进程
    processNames: ['ChatGPT.exe', 'Codex.exe', 'codex.exe'],
    startupTaskRegKey:
      'HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\SystemAppData\\OpenAI.Codex_2p2nqsd0c76g0\\App',
    startupTaskStateEnabled: 2,           // 已启用（需关闭）
    startupTaskStateDisabledByUser: 1,    // 用户已禁用（目标状态）
  },

  clash: {
    appExe: 'E:\\Clash Verge\\clash-verge.exe',
    appProcess: 'clash-verge.exe',
    coreProcess: 'verge-mihomo.exe',
    serviceName: 'clash_verge_service',
    // 程序B 在提权时注册的"启动服务"助手任务；程序A 用非管理员身份触发它把服务拉起来
    serviceStartTask: 'GPTProxy-StartClashService',
    mixedPort: 7897,
    dataDir: path.join(APPDATA, 'io.github.clash-verge-rev.clash-verge-rev'),
    pipePrefix: 'verge-mihomo-',
    // 自定义节点 / 代理组（ASCII 名称，避免编码问题）
    nodeName: 'GPT-US-Static',
    groupName: 'GPT-US',
    // 代理组策略：
    //   'select'   = 严格只用美国静态 IP（当前设置）：组里只有静态节点，选择被程序钉死；
    //                静态通道不通时 GPT 会直接连不上，绝不用其它任何 IP
    //   'fallback' = 静态 IP 优先；健康检查暂时不通时自动回退到订阅美国节点（可用性优先）
    groupType: 'select',
    healthCheckUrl: 'https://www.gstatic.com/generate_204',
    healthCheckInterval: 60,
    tunAdapterName: 'Meta',
    // 订阅扩展文件（见 skills\03）
    slotProxies: 'pYSK1srNIfYO.yaml',
    slotRules: 'rQPkKclEsQ5L.yaml',
    slotGroups: 'gKPowEnXWzil.yaml',
    // 兜底用的订阅美国节点（运行时按 /proxies 动态匹配，这里是匹配规则）
    usBackupMatchers: [/US\s*10/, /US\s*7/, /US\s*9/, /US\s*5/, /US\s*14/, /US\s*15/, /\bUS\b/],
    // 强制走美国静态 IP 的规则（顺序敏感：进程规则在前）
    rules: [
      'PROCESS-NAME,ChatGPT.exe,GPT-US',
      'PROCESS-NAME,Codex.exe,GPT-US',
      'PROCESS-NAME,codex.exe,GPT-US',
      'DOMAIN-SUFFIX,chatgpt.com,GPT-US',
      'DOMAIN-SUFFIX,openai.com,GPT-US',
      'DOMAIN-SUFFIX,oaistatic.com,GPT-US',
      'DOMAIN-SUFFIX,oaiusercontent.com,GPT-US',
      // 专用出口校验域名：经 Clash 走 GPT-US 组，返回的即是"当前生效路径"的出口 IP
      'DOMAIN-SUFFIX,ipinfo.io,GPT-US',
    ],
  },

  roxy: {
    appExe: 'E:\\RoxyBrowser\\RoxyBrowser.exe',
    appProcess: 'RoxyBrowser.exe',
    chromeProcess: 'RoxyChrome.exe',
    roxynetProcess: 'roxynet.exe',
    windowName: '261011-1',        // 你的指纹窗口名（示例值，可被 config.local.js 覆盖）
    workspaceId: '',               // Roxy 工作区 ID：属于本机私密参数，见 config.local.example.js
    localHttpPort: 45535,               // Roxy 本地服务（用于确认主程序已起）
    userDataDir: path.join(APPDATA, 'RoxyBrowser'),
    browserCacheDir: path.join(APPDATA, 'RoxyBrowser', 'browser-cache'),
    // lumi.conf 解密参数（AES-256-GCM，硬编码于 Roxy 内核）
    lumiKey: '402ead7d23b43b6d1e0528d4f99c59bd',
    lumiIv: '3a105229aa31',
    expectedStaticIp: '<美国静态IP>',    // 你的美国静态 IP（仅用于提示/比对，不强制）：属本机私密参数
    roxynetProbeTimeoutMs: 20000,
  },

  timeouts: {
    stepWaitMs: 60000,        // 等待"内核就绪"等关键状态的最长时间
    windowWaitMs: 90000,      // 等待 Roxy 窗口打开的较长时间
    appLaunchWaitMs: 60000,   // 等待 ChatGPT 进程出现
    pollIntervalMs: 1500,
    gracefulCloseSec: 6,
  },

  flags: {
    closeCodexProcesses: true,        // 程序B：是否同时关闭 Codex 相关进程
    guardChatGPTAutostart: true,      // 程序A：确保 ChatGPT 开机自启处于"用户禁用"
    deepVerifyEgress: true,           // 程序A：经规则路径实测出口 IP
    verifyUrl: 'https://ipinfo.io/json',
    staticIpProbeUrl: 'https://ipinfo.io/json',
  },
};

/* ---------- 本机私密参数覆盖（不随公开仓库发布） ---------- */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, over) {
  if (!isPlainObject(over)) return base;
  const out = { ...base };
  for (const key of Object.keys(over)) {
    out[key] = isPlainObject(base[key]) && isPlainObject(over[key]) ? deepMerge(base[key], over[key]) : over[key];
  }
  return out;
}

function loadLocalOverrides() {
  try {
    return require('./config.local');
  } catch {
    return {};
  }
}

module.exports = deepMerge(baseConfig, loadLocalOverrides());
