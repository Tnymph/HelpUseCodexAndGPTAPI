'use strict';
/**
 * 命令执行封装（安全版，v2）：
 * - 每个可执行文件都以"字面量"出现在调用处（execFile/spawn 不经 shell，无可注入的字符串拼接）；
 * - 所有参数以数组传递；变量参数先做白名单格式校验（进程名/目录 ID/路径等）；
 * - 不提供"任意命令"的通用入口。
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOOLS_DIR = path.join(__dirname, '..', 'tools');

const SAFE_IMAGE_NAME = /^[A-Za-z0-9_.\-]+$/;          // 进程名，如 ChatGPT.exe
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9_.\-]+\.ps1$/;   // tools 目录脚本
const SAFE_SHELL_PATH = /^shell:AppsFolder\\[A-Za-z0-9_.!\-]+$/;
const SAFE_DIR_ID = /^[0-9a-f]{32}$/;                 // Roxy 窗口 dirId
const SAFE_WORKSPACE_ID = /^\d{1,20}$/;

function assert(condition, message) {
  if (!condition) throw new Error(`参数校验失败：${message}`);
}

const DEFAULT_TIMEOUT_MS = 45000; // 任何外部命令都不允许无限等待（超时会被杀掉并作为失败返回）

function wrap(cmdEventArgs) {
  return new Promise((resolve) => {
    const options = {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      timeout: DEFAULT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      ...cmdEventArgs.options,
    };
    execFile(cmdEventArgs.cmd, cmdEventArgs.args, options, (err, stdout, stderr) => {
      const timedOut = Boolean(err && (err.killed || err.signal));
      if (timedOut && cmdEventArgs.onTimeout) cmdEventArgs.onTimeout();
      resolve({
        code: timedOut ? 124 : err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
        timedOut,
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
      });
    });
  });
}

/* ---------- 固定可执行文件的执行函数（字面量命令） ---------- */

function exTaskkill(args, options) {
  return wrap({ cmd: 'taskkill', args, options });
}

function exReg(args, options) {
  return wrap({ cmd: 'reg', args, options });
}

function exCurl(args, options) {
  return wrap({ cmd: 'curl', args, options });
}

function exPowerShell(args, options) {
  return wrap({ cmd: 'powershell', args, options });
}

function exExplorer(args, options) {
  return wrap({ cmd: 'explorer', args, options });
}

function exSchTasks(args, options) {
  return wrap({ cmd: 'schtasks', args, options });
}

/* ---------- 业务封装 ---------- */

/** 运行 src\tools 下的 PowerShell 脚本（timeoutMs 必填，避免脚本挂起拖死整个流程） */
function ps(scriptName, args = [], { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  assert(SAFE_SCRIPT_NAME.test(scriptName), `脚本名非法：${scriptName}`);
  const script = path.join(TOOLS_DIR, scriptName);
  assert(fs.existsSync(script), `脚本不存在：${script}`);
  return exPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { timeout: timeoutMs });
}

/** taskkill：force=false 时为温和关闭（发 WM_CLOSE） */
function taskkill(imageName, { force = true, tree = true } = {}) {
  assert(SAFE_IMAGE_NAME.test(imageName), `进程名非法：${imageName}`);
  const args = ['/IM', imageName];
  if (tree) args.push('/T');
  if (force) args.push('/F');
  return exTaskkill(args);
}

/** schtasks：运行一个已注册的计划任务（任务名先做白名单校验） */
function schTasksRun(taskName) {
  assert(SAFE_IMAGE_NAME.test(taskName), `任务名非法：${taskName}`);
  return exSchTasks(['/run', '/tn', taskName]);
}

/** taskkill 按 PID（只接受正整数 PID） */
function taskkillPid(pid, { force = true, tree = true } = {}) {
  const value = Number(pid);
  assert(Number.isInteger(value) && value > 0 && value < 2 ** 31, `PID 非法：${pid}`);
  const args = ['/PID', String(value)];
  if (tree) args.push('/T');
  if (force) args.push('/F');
  return exTaskkill(args);
}

/** 通过资源管理器激活 Store 应用（shell:AppsFolder 形式） */
function activateStoreApp(shellPath) {
  assert(SAFE_SHELL_PATH.test(shellPath), 'Store 应用激活路径非法');
  return exExplorer([shellPath]);
}

// GUI 程序的启动目录固定为它自己的安装目录：
// 继承本脚本的工作目录会让 Roxy 把日志/缓存写到项目目录里（实测踩过）
const CLASH_DIR = 'E:\\Clash Verge';
const ROXY_DIR = 'E:\\RoxyBrowser';

/** 启动 Clash Verge 主程序（固定路径，独立进程） */
function launchClashApp() {
  const child = spawn('E:\\Clash Verge\\clash-verge.exe', [], { detached: true, stdio: 'ignore', cwd: CLASH_DIR });
  child.unref();
  return child.pid;
}

/** 启动 Roxy 主程序（固定路径，独立进程） */
function launchRoxyApp() {
  const child = spawn('E:\\RoxyBrowser\\RoxyBrowser.exe', [], { detached: true, stdio: 'ignore', cwd: ROXY_DIR });
  child.unref();
  return child.pid;
}

/** 用 Roxy 的未文档化 CLI 打开指定窗口 */
function launchRoxyWindow(dirId, workspaceId) {
  assert(SAFE_DIR_ID.test(dirId), 'dirId 非法');
  assert(SAFE_WORKSPACE_ID.test(workspaceId), 'workspaceId 非法');
  const args = ['--roxy-action', 'launch-browser', '--dir-id', dirId, '--workspace-id', workspaceId];
  const child = spawn('E:\\RoxyBrowser\\RoxyBrowser.exe', args, { detached: true, stdio: 'ignore', cwd: ROXY_DIR });
  child.unref();
  return child.pid;
}

/* ---------- 注册表 ---------- */

function regQuery(keyPath, valueName) {
  return exReg(['query', keyPath, '/v', valueName]);
}

function regAddString(keyPath, valueName, value) {
  return exReg(['add', keyPath, '/v', valueName, '/t', 'REG_SZ', '/d', value, '/f']);
}

function regAddDword(keyPath, valueName, value) {
  return exReg(['add', keyPath, '/v', valueName, '/t', 'REG_DWORD', '/d', String(value), '/f']);
}

function regAddQword(keyPath, valueName, value) {
  return exReg(['add', keyPath, '/v', valueName, '/t', 'REG_QWORD', '/d', String(value), '/f']);
}

/* ---------- 网络 ---------- */

/** GET 请求（可选经本地 HTTP 代理；凭据来自运行态探测，使用参数数组传递） */
function curlGet(url, { proxy = null, basicAuth = null, timeoutSec = 20 } = {}) {
  const args = ['-s', '--max-time', String(timeoutSec)];
  if (proxy) {
    const auth = basicAuth ? `${encodeURIComponent(basicAuth[0])}:${encodeURIComponent(basicAuth[1])}@` : '';
    args.push('-x', `http://${auth}${proxy}`);
  }
  args.push(url);
  return exCurl(args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 看门狗：任何脚本的总运行时间上限（默认 10 分钟）。
 * 正常情况不会触发（每个外部命令都有自己的超时）；仅作为极端情况下的兜底。
 */
function installWatchdog(minutes, onFire) {
  const timer = setTimeout(() => onFire(), minutes * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = {
  ps,
  taskkill,
  taskkillPid,
  schTasksRun,
  activateStoreApp,
  launchClashApp,
  launchRoxyApp,
  launchRoxyWindow,
  regQuery,
  regAddString,
  regAddDword,
  regAddQword,
  curlGet,
  sleep,
  installWatchdog,
};
