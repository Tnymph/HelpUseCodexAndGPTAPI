'use strict';
/**
 * 程序B：一键关闭。
 * 顺序：关闭 GPT 软件 → 关闭 Roxy（窗口/主程序/roxynet）→ 清理系统代理 →
 *       关闭 Clash Verge（应用 + 内核）→ 关闭项目相关 cmd 窗口 → 终检。
 * 需要管理员权限（内核为 SYSTEM 身份）；启动器会自动请求 UAC 提权。
 * 用法：node src\stop.js [--dry-run] [--elevated]
 */
const path = require('path');
const config = require('./config');
const log = require('./lib/log');
const lock = require('./lib/lock');
const apps = require('./lib/apps');
const systemproxy = require('./lib/systemproxy');
const verify = require('./lib/verify');
const { ps, installWatchdog } = require('./lib/exec');

const DRY_RUN = process.argv.includes('--dry-run');
const facts = { chatgpt: null, roxy: null, clash: null, sysproxy: false, windows: 0, directIp: null };

function banner() {
  const logFile = log.initLogFile('stop');
  log.blank();
  log.plain('============================================================');
  log.plain('  程序B：关闭 GPT（GPT → 代理软件 → 系统代理 → 项目窗口）');
  if (DRY_RUN) log.plain('  模式：DRY-RUN（只检查与汇报，不做任何修改）');
  log.plain(`  日志文件：${logFile}`);
  log.plain('============================================================');
  log.blank();
}

function fatal(message, hints = []) {
  log.err(message);
  log.details(hints);
  return 2;
}

/* ---------- 提权 ---------- */

async function ensureAdmin() {
  if (DRY_RUN) {
    const admin = await apps.isAdmin();
    if (!admin) log.warn('（dry-run）当前非管理员；实际运行时会自动弹出 UAC 请求提权');
    return true;
  }
  if (await apps.isAdmin()) return true;
  log.warn('结束 Clash 内核需要管理员权限，正在请求提权（请在弹出的 UAC 窗口点击"是"）...');
  const cmdPath = path.join(config.PROJECT_ROOT, 'stop-gpt.cmd');
  // 提权要等用户在 UAC 上点确认，超时给足 5 分钟
  const r = await ps('elevate.ps1', ['-CmdPath', cmdPath, '-Arguments', '--elevated'], { timeoutMs: 300000 });
  if (r.code !== 0) return fatal('提权失败（可能取消了 UAC）', ['可右键 stop-gpt.cmd → 以管理员身份运行']);
  log.info('已在新的管理员窗口继续执行，本窗口可以关闭');
  return 'relaunched';
}

/* ---------- 步骤 1：关闭 ChatGPT ---------- */

async function step1CloseChatGPT() {
  const names = config.flags.closeCodexProcesses ? config.chatgpt.processNames : ['ChatGPT.exe'];
  log.step(1, `关闭 ChatGPT 桌面应用（范围：${names.join(', ')}）`);
  if (!(await apps.isChatGPTRunning(true))) {
    log.ok('ChatGPT 未在运行');
    return true;
  }
  if (DRY_RUN) {
    log.warn('（dry-run）将温和关闭并强制结束以上进程');
    return true;
  }
  await apps.closeChatGPT();
  const still = await apps.isChatGPTRunning(true);
  facts.chatgpt = !still;
  if (still) log.warn('仍有 ChatGPT 相关进程未退出');
  else log.ok('ChatGPT 已关闭');
  return true;
}

/* ---------- 步骤 2：关闭 Roxy ---------- */

async function step2CloseRoxy() {
  log.step(2, '关闭 Roxy Browser（窗口 → 主程序 → roxynet）');
  if (!(await apps.isRoxyAppRunning(true))) {
    log.ok('Roxy 未在运行');
    return true;
  }
  if (DRY_RUN) {
    log.warn('（dry-run）将先温和关闭窗口，再结束 RoxyChrome / RoxyBrowser / roxynet');
    return true;
  }
  const r = await apps.closeRoxyAll();
  facts.roxy = r;
  if (r.chrome && r.app && r.roxynet) log.ok('Roxy 已全部关闭（注意：强制关闭不会同步云端数据）');
  else log.warn(`部分 Roxy 进程未退出：${JSON.stringify(r)}`);
  return true;
}

/* ---------- 步骤 3：清理系统代理 ---------- */

async function step3ClearSystemProxy() {
  log.step(3, '清理系统代理设置（避免指向已关闭的端口）');
  if (DRY_RUN) {
    const sp = await systemproxy.read();
    log.warn(`（dry-run）当前 ProxyEnable=${sp.enable}，ProxyServer=${sp.server || '(空)'} → 将关闭`);
    return true;
  }
  const r = await systemproxy.ensureOff();
  facts.sysproxy = true;
  log.ok(r.changed ? '系统代理已关闭' : '系统代理本就是关闭状态');
  return true;
}

/* ---------- 步骤 4：关闭 Clash Verge ---------- */

async function step4CloseClash() {
  log.step(4, '关闭 Clash Verge（应用 + 内核）');
  const appRunning = await apps.isClashAppRunning(true);
  const coreRunning = await apps.isCoreRunning(true);
  if (!appRunning && !coreRunning) {
    log.ok('Clash Verge 未在运行');
    return true;
  }
  if (DRY_RUN) {
    log.warn(`（dry-run）将关闭：应用=${appRunning ? '运行中' : '未运行'}，内核=${coreRunning ? '运行中' : '未运行'}`);
    return true;
  }
  if (!(await apps.isAdmin())) return fatal('缺少管理员权限，无法停止 Clash 服务与内核', ['请右键 stop-gpt.cmd → 以管理员身份运行']);
  const r = await apps.closeClashAll();
  facts.clash = r;
  log.ok(r.app ? 'Clash Verge 应用已关闭' : '警告：Clash Verge 应用仍在运行');
  log.ok(r.service ? 'Clash 后台服务已停止（内核随服务一并结束）' : '警告：服务未停止');
  log.ok(r.core ? 'Clash 内核已关闭' : `警告：${r.errors.join('；')}`);
  if (r.taskCreated) log.ok('已注册助手任务（供程序A 无需提权启动服务）');
  return true;
}

/* ---------- 步骤 5：关闭项目相关 cmd 窗口 ---------- */

async function step5CloseProjectWindows() {
  log.step(5, '关闭项目相关的 cmd / PowerShell 窗口');
  const windows = await apps.findProjectWindows();
  const targets = windows.filter((p) => p.Id !== process.pid && p.Id !== process.ppid);
  if (targets.length === 0) {
    log.ok('没有需要关闭的项目窗口');
    return true;
  }
  if (DRY_RUN) {
    log.warn(`（dry-run）将关闭 ${targets.length} 个窗口：`);
    log.details(targets.map((p) => `${p.Name}（PID ${p.Id}）${p.Title || ''}`));
    return true;
  }
  facts.windows = await apps.closeWindowProcesses(targets, process.pid);
  log.ok(`已关闭 ${facts.windows} 个项目窗口（本窗口将在脚本结束时自动关闭）`);
  return true;
}

/* ---------- 步骤 6：终检 ---------- */

async function step6FinalVerify() {
  log.step(6, '终检：确认网络已回到"无代理"状态');
  if (DRY_RUN) {
    log.warn('（dry-run）跳过终检');
    return true;
  }
  const port = await verify.checkPort(config.clash.mixedPort);
  if (port) log.warn(`注意：7897 端口仍在监听（Clash 内核可能未完全退出）`);
  else log.ok('Clash 端口 7897 已关闭');

  const tun = await verify.checkTunAdapter();
  if (tun) log.warn('注意：TUN 网卡仍存在（内核可能未完全退出）');
  else log.ok('TUN 网卡已消失');

  // Clash Verge 退出时可能把系统代理"恢复"回开启状态（本机实测发生过），这里再清一次
  let sp = await systemproxy.read();
  if (sp.enable === 1) {
    log.warn(`系统代理又被改回开启（${sp.server}）—— 已再次关闭并通知`);
    await systemproxy.ensureOff();
    sp = await systemproxy.read();
  }
  if (sp.enable === 1) log.warn(`注意：系统代理仍为开启（${sp.server}）`);
  else log.ok('系统代理已关闭');

  const gpt = await apps.isChatGPTRunning(true);
  const roxy = await apps.isRoxyAppRunning(true);
  if (!gpt && !roxy) log.ok('ChatGPT / Roxy 进程均已退出');
  else log.warn(`仍有进程在运行：ChatGPT=${gpt}，Roxy=${roxy}`);

  const egress = await verify.egressDirect();
  facts.directIp = egress;
  if (egress) log.ok(`当前直连出口：${egress.ip}（${egress.country} / ${egress.city} / ${egress.org}）`);
  else log.warn('直连出口检测失败（若本机确实无网络请忽略）');
  return true;
}

/* ---------- 汇总 ---------- */

function summary() {
  log.blank();
  log.plain('============================================================');
  if (DRY_RUN) {
    log.plain('  结果：DRY-RUN 检查完成 —— 上面每条"将..."就是实际运行时会执行的动作');
    log.plain('============================================================');
    log.blank();
    return;
  }
  log.plain('  结果：关闭流程执行完毕（请核对上面的每一项）');
  log.plain('============================================================');
  log.plain(`  · 系统代理      ：已关闭`);
  log.plain(`  · Clash Verge   ：${facts.clash ? (facts.clash.app && facts.clash.core ? '应用与内核均已关闭' : '存在未关闭项，见上文') : '（未运行）'}`);
  log.plain(`  · Roxy Browser  ：${facts.roxy ? (facts.roxy.chrome && facts.roxy.app && facts.roxynet ? '已全部关闭' : '存在未关闭项，见上文') : '（未运行）'}`);
  log.plain(`  · 关闭的项目窗口：${facts.windows} 个`);
  log.plain(`  · 直连出口      ：${facts.directIp ? facts.directIp.ip + '（' + facts.directIp.country + '）' : '（未测到）'}`);
  log.blank();
  log.plain('  下次使用请双击：start-gpt.cmd');
  log.blank();
}

/* ---------- 主流程 ---------- */

async function main() {
  banner();
  const admin = await ensureAdmin();
  if (admin === 'relaunched') return 10;   // 10 = 已提权到新窗口，启动器据此自动关闭本窗口
  if (admin === 2) return 2;

  const l = lock.acquire('stop');
  if (!l.acquired) {
    log.warn(`检测到上一次的停止程序（PID ${l.holder.pid}）可能已卡住，正在接管...`);
    await apps.killPreviousStopInstance(l.holder.pid);
    lock.release('stop');
    const retry = lock.acquire('stop');
    if (!retry.acquired) {
      log.err('仍无法取得运行锁，本次退出');
      return 1;
    }
  }
  installWatchdog(10, () => {
    log.err('运行超过 10 分钟，强制退出（可能某个外部命令无响应）');
    process.exit(3);
  });
  try {
    await step1CloseChatGPT();
    await step2CloseRoxy();
    await step3ClearSystemProxy();
    const clash = await step4CloseClash();
    if (clash === 2) return 2;
    await step5CloseProjectWindows();
    await step6FinalVerify();
    summary();
    return 0;
  } finally {
    lock.release('stop');
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((e) => {
  log.err(`未预期的异常：${e && e.stack ? e.stack : e}`);
  process.exitCode = 3;
});
