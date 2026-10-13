'use strict';
/**
 * 程序A：一键启动 GPT。
 * 把网络环境准备到"ChatGPT 全程走美国静态 IP"的状态，然后打开 ChatGPT 桌面应用，最后打印验证结果。
 * 步骤顺序（重要）：先把 Clash 与系统代理准备好，再启动 Roxy/打开窗口 ——
 * 因为 roxynet 建立"上游跳板链路"时会用到当时的系统代理，顺序错了静态通道会不通（会自动重启 Roxy 自愈）。
 * 设计与步骤表：skills\06-方案与程序设计.md
 * 用法：node src\start.js [--dry-run]
 */
const config = require('./config');
const log = require('./lib/log');
const lock = require('./lib/lock');
const apps = require('./lib/apps');
const clashApi = require('./lib/clash-api');
const clashProfile = require('./lib/clash-profile');
const roxynet = require('./lib/roxynet');
const systemproxy = require('./lib/systemproxy');
const verify = require('./lib/verify');
const { installWatchdog } = require('./lib/exec');

const DRY_RUN = process.argv.includes('--dry-run');
const facts = {
  proxyPort: null, dirId: null, staticIp: null, staticOrg: null,
  clashChanged: [], delayMs: null, routing: null, appProof: null,
  egress: null, groupNow: null, autostart: null, roxyRestarted: false,
};

function banner() {
  const logFile = log.initLogFile('start');
  log.blank();
  log.plain('============================================================');
  log.plain('  程序A：启动 GPT（自动配置网络代理 → 打开 ChatGPT）');
  if (DRY_RUN) log.plain('  模式：DRY-RUN（只检查与汇报，不做任何修改）');
  log.plain(`  日志文件：${logFile}`);
  log.plain('============================================================');
  log.blank();
}

/** 打印错误与提示，返回退出码 2 */
function fatal(message, hints = []) {
  log.err(message);
  log.details(hints);
  return 2;
}

/* ---------- 步骤 1：环境自检 ---------- */

async function step1Environment() {
  log.step(1, '环境自检');
  log.ok(`项目目录：${config.PROJECT_ROOT}`);
  log.ok(`Node 版本：${process.version}`);
  return true;
}

/* ---------- 步骤 2：Clash 后台服务 ---------- */

async function step2ClashService() {
  log.step(2, '确保 Clash 后台服务在运行');
  const state = await apps.getClashServiceState();
  log.info(`服务状态：${state}`);
  if (state === 'RUNNING') {
    log.ok('后台服务已在运行');
    return true;
  }
  if (state === 'NOTFOUND') {
    log.warn('未找到 Clash Verge 服务（可能未以服务模式安装），TUN 可能不可用');
    return true;
  }
  if (DRY_RUN) {
    log.warn('（dry-run）服务处于停止状态；实际运行时会用助手任务把它拉起来');
    return false;
  }
  const started = await apps.ensureClashServiceRunning();
  if (!started.ok) {
    return fatal(`无法启动 Clash 后台服务：${started.reason}`, [
      '若这是首次使用（还没运行过 stop-gpt.cmd），请先以管理员身份运行一次 stop-gpt.cmd 来注册助手任务',
      '或者手动启动一次 Clash Verge（它会自行拉起服务）',
    ]);
  }
  log.ok('后台服务已启动（无需 UAC）');
  return true;
}

/* ---------- 步骤 3：Clash 应用 + 系统代理(必须先于 Roxy) ---------- */

async function step3ClashAppAndProxy() {
  log.step(3, '确保 Clash Verge 应用、内核与系统代理就绪');
  if (await apps.isClashAppRunning(true)) {
    log.ok('Clash Verge 已在运行');
  } else if (DRY_RUN) {
    log.warn('（dry-run）Clash Verge 未运行；实际运行时会自动启动');
  } else {
    log.info('Clash Verge 未运行，正在启动 ...');
    apps.launchClash();
    const up = await verify.waitFor('内核端口 7897', config.timeouts.stepWaitMs, () => verify.checkPort(config.clash.mixedPort));
    if (!up) return fatal('Clash Verge 启动后内核未就绪', ['请手动打开 Clash Verge 检查内核状态']);
    log.ok('Clash Verge 已启动，内核就绪');
  }

  const server = `127.0.0.1:${config.clash.mixedPort}`;
  if (DRY_RUN) {
    const on = await verify.checkSystemProxyOn();
    log.warn(`（dry-run）当前系统代理${on ? '已正确' : '需要修正'}（目标：${server}）`);
    return on;
  }
  const r = await systemproxy.ensureOn(server);
  log.ok(r.changed ? `已开启系统代理并指向 ${server}` : `系统代理已是 ${server}`);
  return true;
}

/* ---------- 步骤 4：指纹窗口 ---------- */

/** 是否配置了真实的"预期静态 IP"（占位符则跳过比对） */
function hasRealExpectedIp() {
  const value = config.roxy.expectedStaticIp || '';
  return value.length > 0 && !value.startsWith('<');
}

async function ensureRoxyWindow(dirId) {
  if (!config.roxy.workspaceId) {
    return fatal('缺少 Roxy 工作区 ID，无法自动打开窗口', [
      '把 src\\config.local.example.js 复制为 src\\config.local.js 并填写 workspaceId',
      '或在 Roxy 界面里手动打开该窗口后重试本程序',
    ]);
  }
  const running = await apps.isRoxyAppRunning(true);
  if (running) {
    log.info(`Roxy 在运行但窗口未打开，正在请求打开（dirId=${dirId}）...`);
    apps.openRoxyWindow(dirId);
  } else {
    log.info(`Roxy 未在运行，将带窗口参数首次启动（dirId=${dirId}）...`);
    apps.openRoxyWindow(dirId);
  }
  const up = await verify.waitFor('Roxy 本地服务', config.timeouts.windowWaitMs, () => verify.checkPort(config.roxy.localHttpPort));
  if (!up) return fatal('Roxy 主程序启动后本地服务未就绪', [`请手动打开 ${config.roxy.appExe} 后重试`]);
  return true;
}

async function step4EnsureWindow() {
  log.step(4, `确保指纹窗口「${config.roxy.windowName}」已打开`);
  const dirId = await roxynet.findDirIdByWindowName(config.roxy.windowName);
  if (!dirId) {
    return fatal(`找不到窗口「${config.roxy.windowName}」（本地数据里没有该窗口）`, [
      '请在 Roxy 里确认窗口名，或修改 src\\config.js 中的 windowName',
      '若你改过 Roxy 的缓存目录（设置 → 缓存/数据目录）：请把新位置填进 src\\config.local.js 的 browserCacheDirsExtra 数组后重试',
    ]);
  }
  facts.dirId = dirId;

  const existing = await roxynet.findOpenWindow(dirId, config.roxy.windowName, true);
  if (existing) {
    log.ok(`窗口已打开（dirId=${dirId}，PID=${existing.pid}）`);
    return true;
  }
  if (DRY_RUN) {
    log.warn(`（dry-run）窗口未打开；实际运行时会自动启动 Roxy 并用 dirId=${dirId} 打开窗口`);
    return false;
  }
  const started = await ensureRoxyWindow(dirId);
  if (started !== true) return started;
  const win = await roxynet.waitForWindow(dirId, config.roxy.windowName, config.timeouts.windowWaitMs);
  if (!win) {
    return fatal('窗口打开超时', [
      '请在 Roxy 界面里手动打开该窗口后重试本程序',
      '（可选）在 Roxy 设置里开启本地 API，之后本程序可更可靠地自动开关窗口',
    ]);
  }
  log.ok(`窗口已打开（dirId=${win.dirId}，PID=${win.pid}）`);
  return true;
}

/* ---------- 步骤 5：roxynet 端口 ---------- */

async function detectRoxynetPort() {
  const port = await roxynet.findProxyPort();
  if (!port) return null;
  facts.proxyPort = port;
  return port;
}

async function step5DetectRoxynet() {
  log.step(5, '探测 roxynet 本地代理口（动态端口）');
  const port = await detectRoxynetPort();
  if (!port) {
    return fatal('未找到 roxynet 代理口（roxynet 未运行或窗口未打开）', [
      '确认 Roxy 窗口已打开（窗口打开时 roxynet 会自动运行）',
      `可查看日志：${config.roxy.userDataDir}\\logs\\`,
    ]);
  }
  log.ok(`roxynet 代理口：127.0.0.1:${port}`);
  return true;
}

/* ---------- 步骤 6：静态 IP 通道（带自愈） ---------- */

async function restartRoxyForChain() {
  log.warn('静态通道不通 —— 正在重启 Roxy 以重建走系统代理的上游链路（约 30 秒）...');
  await apps.closeRoxyAll();
  apps.openRoxyWindow(facts.dirId);
  const up = await verify.waitFor('Roxy 本地服务', config.timeouts.windowWaitMs, () => verify.checkPort(config.roxy.localHttpPort));
  if (!up) return false;
  const win = await roxynet.waitForWindow(facts.dirId, config.roxy.windowName, config.timeouts.windowWaitMs);
  if (!win) return false;
  facts.roxyRestarted = true;
  facts.proxyPort = await detectRoxynetPort();
  log.info(`重建后 roxynet 代理口：${facts.proxyPort}`);
  return Boolean(facts.proxyPort);
}

async function step6StaticChannel() {
  log.step(6, '校验美国静态 IP 通道（经 roxynet 请求 ipinfo，最多重试 3 次）');
  if (DRY_RUN || !facts.proxyPort) {
    log.warn('（dry-run）跳过实际请求');
    return false;
  }
  let info = await roxynet.checkStaticEgress(facts.proxyPort, facts.dirId);
  if (!info) {
    const proxyOn = await verify.checkSystemProxyOn();
    const clashUp = await verify.checkPort(config.clash.mixedPort);
    if (proxyOn && clashUp) {
      const rebuilt = await restartRoxyForChain();
      if (rebuilt) info = await roxynet.checkStaticEgress(facts.proxyPort, facts.dirId);
    } else {
      log.warn(`跳过自愈：系统代理${proxyOn ? '正常' : '未开启'}、Clash${clashUp ? '正常' : '未就绪'}`);
    }
  }
  if (!info) {
    if (config.clash.groupType === 'select') {
      log.err('静态 IP 通道不通，且当前为严格模式：GPT 将无法联网（不会使用任何其它 IP）');
    } else {
      log.warn('静态 IP 通道当前不通（将回退到订阅美国节点；GPT 仍会打开）');
    }
    log.details([
      '常见原因：静态 IP 服务端临时不可用；或 Roxy 窗口自身的上游代理配置有问题',
      `可查看 Roxy 日志：${config.roxy.userDataDir}\\logs\\`,
    ]);
    return false;
  }
  facts.staticIp = info.ip;
  facts.staticOrg = info.org;
  log.ok(`静态 IP 出口：${info.ip}（${info.country} / ${info.city} / ${info.org}）`);
  if (info.country !== 'US') log.warn(`注意：当前出口国家是 ${info.country}，不是 US，请检查 Roxy 窗口的代理配置`);
  if (hasRealExpectedIp() && info.ip !== config.roxy.expectedStaticIp) {
    log.warn(`当前 IP 与配置的预期不同（预期 ${config.roxy.expectedStaticIp}）；若你更换过静态 IP，请更新 src\\config.local.js`);
  }
  if (config.clash.groupType === 'fallback') await verify.refreshGroupHealth();
  const now = await verify.getGroupNow();
  const target = clashProfile.pinTargetName();
  if (now === target) log.ok(`GPT-US 组生效节点：${now}`);
  else if (now) log.warn(`GPT-US 组当前生效节点：${now}（预期应为 ${target}）`);
  return true;
}

/* ---------- 步骤 7：同步扩展文件 ---------- */

async function step7SyncProfile() {
  log.step(7, '同步 Clash 扩展文件（自定义节点 / 代理组 / 规则）');
  if (DRY_RUN) {
    log.warn('（dry-run）跳过写入；实际运行时会写入以下文件的托管内容：');
    log.details([
      clashProfile.slotPath(config.clash.slotProxies),
      clashProfile.slotPath(config.clash.slotGroups),
      clashProfile.slotPath(config.clash.slotRules),
    ]);
    return { changed: [], unchanged: [] };
  }
  const backup = await clashApi.findLeafByName(config.clash.usBackupMatchers);
  if (!backup) {
    log.warn('未在订阅里找到美国备用节点（回退兜底将不可用）');
  } else {
    log.info(`备用节点（回退用）：${backup}`);
  }
  const result = clashProfile.syncProfile(facts.proxyPort, facts.dirId, backup);
  facts.clashChanged = result.changed;
  if (result.changed.length === 0) {
    log.ok('扩展文件内容已是最新，无需改动');
  } else {
    log.ok(`已更新 ${result.changed.length} 个扩展文件：${result.changed.join(', ')}`);
    log.info('（原文件已备份为 *.gptproxy-backup）');
  }
  if (clashProfile.hasDirectProxy()) {
    const d = config.clash.directProxy;
    if (!d.username || !d.password) {
      log.warn(`直连节点 ${config.clash.directNodeName} 未带账号/密码（若该代理需要认证，请重新运行 tools\\import-static-proxy.ps1 或检查环境变量 GPT_PROXY_USER / GPT_PROXY_PASSWORD）`);
    } else {
      log.info(`直连静态 IP 节点 ${config.clash.directNodeName} 已同步（与 ${config.clash.nodeName} 出口同一 IP，可在 Clash 界面切换）`);
    }
  }
  return result;
}

/* ---------- 步骤 8：Clash 就绪核对 ---------- */

async function restartClashForReload() {
  log.info('正在重启 Clash Verge 以重新生成配置（会短暂中断现有连接）...');
  await apps.closeClashAppOnly();
  apps.launchClash();
  const up = await verify.waitFor('内核端口 7897', config.timeouts.stepWaitMs, () => verify.checkPort(config.clash.mixedPort));
  return Boolean(up);
}

async function step8ClashReady(profileChanged) {
  log.step(8, '等待 Clash 代理就绪并确认自定义节点/组/规则已加载');
  let nodes = await verify.checkNodes();
  const rulesState = await verify.checkRunningRules();
  const needReload = profileChanged || !nodes || !rulesState.ok;
  if (needReload && !profileChanged && !rulesState.ok) {
    log.info(`内核尚未加载 ${rulesState.missing.length} 条本项目规则（例如 ${rulesState.missing[0]}）`);
  }
  if (needReload) {
    if (DRY_RUN) {
      log.warn('（dry-run）需要重启 Clash 才能让改动生效；实际运行时会执行');
      return null;
    }
    const ok = await restartClashForReload();
    if (!ok) return fatal('重启后 Clash 内核未就绪', ['请手动打开 Clash Verge 检查']);
    nodes = await verify.waitFor('自定义节点加载', config.timeouts.stepWaitMs, () => verify.checkNodes());
    const rulesAfter = await verify.waitFor('规则加载', config.timeouts.stepWaitMs, async () => {
      const s = await verify.checkRunningRules();
      return s.ok ? s : null;
    });
    if (!rulesAfter) log.warn('重启后仍未在运行配置里看到全部本项目规则（可稍后重跑本程序复查）');
  }
  if (!nodes) {
    if (DRY_RUN) {
      log.warn('（dry-run）未能确认节点/组加载（dry-run 不写入扩展文件，属预期）');
      return null;
    }
    return fatal('Clash 中未找到自定义节点/组', [
      `请确认扩展文件已写入：${clashProfile.slotPath(config.clash.slotProxies)}`,
      '可在 Clash Verge 界面里手动"重新载入配置"后重试本程序',
    ]);
  }
  const tun = await verify.checkTunAdapter();
  if (tun) log.ok('TUN 网卡已就绪（Rust 后端与一切子进程都会被代理接管）');
  else log.warn('未检测到 TUN 网卡：codex 后端可能不走代理，请检查 Clash Verge 的 TUN 开关与管理员权限');
  log.ok(`节点 ${config.clash.nodeName} 与组 ${config.clash.groupName} 已加载（组当前选择：${nodes.groupNow}）`);
  const target = clashProfile.pinTargetName();
  if (config.clash.groupType === 'select' && nodes.groupNow !== target) {
    const r = await clashApi.selectProxy(config.clash.groupName, target);
    if (r.status === 204) log.ok(`严格模式：已把 ${config.clash.groupName} 的选择钉在 ${target}`);
    else log.warn(`严格模式：钉住节点选择失败（HTTP ${r.status}）`);
  }
  return nodes;
}

/* ---------- 步骤 9：节点连通性 ---------- */

async function step9NodeHealth() {
  log.step(9, '节点连通性测试（经 GPT-US 组访问 chatgpt.com）');
  if (DRY_RUN) {
    log.warn('（dry-run）跳过实际测速');
    return false;
  }
  const delay = await verify.checkNodeDelay(config.clash.groupName, 3, 'https://chatgpt.com');
  if (!delay) {
    log.warn('组测速未通过（chatgpt.com 暂不可达；刚重启过 Clash 时偶发）。以第 12 步的实测出口为准，必要时重跑本程序复查。');
    return false;
  }
  facts.delayMs = delay;
  log.ok(`测速成功：${delay} ms`);
  return true;
}

/* ---------- 步骤 10：自启任务 ---------- */

async function step10AutostartGuard() {
  log.step(10, '检查 ChatGPT 开机自启（防止无代理裸启动）');
  if (!config.flags.guardChatGPTAutostart) {
    log.info('已按配置跳过');
    return true;
  }
  if (DRY_RUN) {
    log.warn('（dry-run）跳过修改');
    return true;
  }
  const r = await apps.ensureChatGPTAutostartDisabled();
  facts.autostart = r;
  if (r.ok) log.ok('开机自启已处于"用户禁用"状态（正常）');
  else if (r.changed) log.ok('检测到开机自启被启用，已关闭（任务管理器"启动"页可改回）');
  else log.warn(`开机自启状态未变更（state=${r.state}）${r.note ? '：' + r.note : ''}`);
  return true;
}

/* ---------- 步骤 11：打开应用 ---------- */

async function step11LaunchApp() {
  log.step(11, '打开 ChatGPT 桌面应用');
  if (await apps.isChatGPTRunning(true)) {
    log.ok('ChatGPT 已在运行（将聚焦已有窗口）');
    return true;
  }
  if (DRY_RUN) {
    log.warn('（dry-run）不实际打开应用');
    return false;
  }
  await apps.launchChatGPT();
  const up = await verify.waitFor('ChatGPT 进程', config.timeouts.appLaunchWaitMs, () => apps.isChatGPTRunning(true));
  if (!up) return fatal('ChatGPT 应用启动超时', ['可手动打开开始菜单里的 ChatGPT 验证应用本身是否正常']);
  log.ok('ChatGPT 应用已启动');
  return true;
}

/* ---------- 步骤 12：终检 ---------- */

async function step12FinalVerify() {
  log.step(12, '终检：确认 GPT 流量全程走美国静态 IP');
  if (DRY_RUN) {
    log.warn('（dry-run）跳过真实性验证');
    return true;
  }
  const routing = await verify.routingProof();
  facts.routing = routing;
  if (routing) log.ok(`分流证据：chains=[${routing.chains.join(' → ')}]，规则=${routing.rule}，域名=${routing.host}`);
  else log.warn('未抓到新建连接的分流证据（稍后可重跑本程序查看）');

  if (config.flags.deepVerifyEgress) {
    log.info('正在实测"当前生效路径"的出口 IP（经规则路径请求 ipinfo.io）...');
    const egress = await verify.egressViaGroup();
    facts.egress = egress;
    if (egress) {
      const via = egress.chains ? `，链路=[${egress.chains.join(' → ')}]` : '';
      log.ok(`实测出口：${egress.ip}（${egress.country} / ${egress.city} / ${egress.org}）${via}`);
      if (egress.country !== 'US') log.warn('出口不是美国！请检查静态 IP 通道');
      if (!hasRealExpectedIp()) {
        // 未配置预期 IP（公开仓库的默认状态），只报告实际出口
      } else if (egress.ip === config.roxy.expectedStaticIp) {
        log.ok('出口 IP 与预期的美国静态 IP 一致');
      } else {
        log.warn(`出口 IP 与预期静态 IP（${config.roxy.expectedStaticIp}）不同 —— 说明当时不是那条链路`);
      }
    } else {
      log.warn('出口校验失败（不改动任何设置）');
    }
  }

  facts.groupNow = await verify.getGroupNow();
  const target = clashProfile.pinTargetName();
  if (facts.groupNow === target) log.ok(`当前生效节点：${facts.groupNow}（美国静态 IP）`);
  else if (facts.groupNow) log.warn(`当前生效节点：${facts.groupNow}（不是预期的 ${target}）`);

  const proof = await verify.waitFor('ChatGPT 应用流量分流证据', 20000, () => verify.chatgptAppTrafficProof());
  facts.appProof = proof;
  if (proof) log.ok(`应用自身流量已走本项目节点：chains=[${proof.chains.join(' → ')}]，host=${proof.host}`);
  else log.info('暂未观察到 ChatGPT 应用自身的 OpenAI 流量（应用可能还在启动，正常使用后即可生效）');
  return true;
}

/* ---------- 汇总 ---------- */

function summary(ok) {
  log.blank();
  log.plain('============================================================');
  if (DRY_RUN) {
    log.plain('  结果：DRY-RUN 检查完成 —— 上面每条"将..."就是实际运行时会执行的动作');
    log.plain('============================================================');
    log.blank();
    return;
  }
  log.plain(ok ? '  结果：GPT 已启动，网络环境就绪' : '  结果：存在未完成的步骤，请查看上面的错误信息');
  log.plain('============================================================');
  const pinTarget = clashProfile.pinTargetName();
  log.plain(`  · 美国静态 IP 出口     ：${facts.staticIp || '（未验证）'}${facts.staticOrg ? '（' + facts.staticOrg + '）' : ''}`);
  log.plain(`  · 当前生效节点         ：${facts.groupNow || '（未知）'}${facts.groupNow === pinTarget ? '  ← 美国静态 IP' : ''}`);
  log.plain(`  · 节点测速             ：${facts.delayMs ? facts.delayMs + ' ms' : '（未通过/未测）'}`);
  log.plain(`  · 实测出口（规则路径） ：${facts.egress ? facts.egress.ip + '（' + facts.egress.country + '）' : '（未执行）'}`);
  log.plain(`  · 分流证据             ：${facts.routing ? facts.routing.chains.join(' → ') : '（未观察到）'}`);
  log.plain(`  · 扩展文件变更         ：${facts.clashChanged.length ? facts.clashChanged.join(', ') : '无（已是最新）'}`);
  if (facts.roxyRestarted) log.plain('  · 备注                 ：本次重启过 Roxy 以重建静态 IP 链路');
  log.blank();
  log.plain('  事后关闭请双击：stop-gpt.cmd（关闭 GPT 与全部代理）');
  log.blank();
}

/* ---------- 主流程 ---------- */

async function main() {
  banner();
  const l = lock.acquire('start');
  if (!l.acquired) {
    log.err(`已有启动程序在运行（PID ${l.holder.pid}），本次退出`);
    return 1;
  }
  installWatchdog(10, () => {
    log.err('运行超过 10 分钟，强制退出（可能某个外部命令无响应）');
    process.exit(3);
  });
  try {
    await step1Environment();
    const serviceOk = await step2ClashService();
    if (serviceOk === 2) return 2;
    const clashOk = await step3ClashAppAndProxy();
    if (clashOk === 2) return 2;

    const winOk = await step4EnsureWindow();
    if (winOk !== true) return winOk;
    const net = await step5DetectRoxynet();
    if (net !== true) return net;
    await step6StaticChannel();

    const profile = await step7SyncProfile();
    const nodes = await step8ClashReady(profile.changed.length > 0);
    if (nodes === 2) return 2;
    await step9NodeHealth();
    await step10AutostartGuard();
    const appOk = await step11LaunchApp();
    if (appOk === 2) return 2;
    await step12FinalVerify();
    summary(true);
    return 0;
  } finally {
    lock.release('start');
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  log.err(`未预期的异常：${e && e.stack ? e.stack : e}`);
  process.exitCode = 3;
});
