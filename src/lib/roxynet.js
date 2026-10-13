'use strict';
/**
 * Roxy Browser / roxynet 探测：
 * - 窗口名 ↔ dirId（优先解密"已打开窗口自己"的 lumi.conf，其次扫描候选缓存根目录）；
 * - roxynet 的"混合代理口"（动态端口，用 407+Proxy-Authenticate 特征识别）；
 * - 经 roxynet 验证美国静态 IP 出口。
 * 识别不依赖固定缓存路径：Roxy 把缓存目录改到其它盘（如 E:\BrowserCache）也能工作；
 * 窗口未打开时的扫描位置 = browserCacheDir + browserCacheDirsExtra（见 src\config.js）。
 * 参考：skills\01-浏览器与Roxy指纹浏览器知识.md
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const config = require('../config');
const netinfo = require('./netinfo');
const { curlGet, sleep } = require('./exec');

const R = config.roxy;

// 窗口主进程命令行里的 --user-data-dir=<缓存根>\<dirId>（带引号或不带引号两种写法都见过）
const RE_USER_DATA_DIR = /--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+)/;
// dirId / 窗口数据目录名：32 位十六进制
const RE_DIR_ID = /^[0-9a-fA-F]{32}$/;

/* ---------- lumi.conf 解密 ---------- */

function readLumi(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  const buf = Buffer.from(raw, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(R.lumiKey, 'utf8'), Buffer.from(R.lumiIv, 'utf8'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

/** 候选缓存根目录：默认位置 + config.local.js 里补充的其它位置（去重） */
function cacheRoots() {
  const roots = [R.browserCacheDir, ...(R.browserCacheDirsExtra || [])];
  return [...new Set(roots.filter(Boolean))];
}

/** 某个 dirId 的 lumi.conf 实际路径（缓存被搬到其它盘也能找到） */
function lumiFileFor(dirId) {
  for (const root of cacheRoots()) {
    const file = path.join(root, dirId, 'lumi.conf');
    if (fs.existsSync(file)) return file;
  }
  return path.join(R.browserCacheDir, dirId, 'lumi.conf');
}

function decryptLumi(dirId) {
  return readLumi(lumiFileFor(dirId));
}

/** 从"窗口自己的数据目录"直接解密（最可靠：不依赖缓存根目录配置） */
function decryptLumiAt(dataDir) {
  return readLumi(path.join(dataDir, 'lumi.conf'));
}

function listWindowDirs() {
  const dirs = [];
  for (const root of cacheRoots()) {
    try {
      for (const d of fs.readdirSync(root)) {
        if (RE_DIR_ID.test(d) && !dirs.includes(d)) dirs.push(d);
      }
    } catch { /* 某个候选根不存在：跳过 */ }
  }
  return dirs;
}

/**
 * windowName → dirId。
 * 1) 窗口已打开：直接解密该窗口进程自己的 lumi.conf —— 缓存目录搬到哪都能找到；
 * 2) 窗口未打开：扫描候选缓存根（browserCacheDir / browserCacheDirsExtra）。
 */
async function findDirIdByWindowName(windowName) {
  const open = await listOpenWindows();
  for (const w of open) {
    try {
      if (decryptLumiAt(w.dataDir).windowName === windowName) return w.dirId;
    } catch { /* 单个窗口解密失败不影响其它 */ }
  }
  for (const dirId of listWindowDirs()) {
    try {
      const cfg = decryptLumi(dirId);
      if (cfg.windowName === windowName) return dirId;
    } catch { /* 单个目录解密失败不影响其它 */ }
  }
  return null;
}

/* ---------- 打开中的窗口 ---------- */

/** 从命令行解析窗口数据目录（只认 …\<dirId> 形态，缓存根位置不限） */
function windowDataDir(cmd) {
  const m = cmd.match(RE_USER_DATA_DIR);
  if (!m) return null;
  const dir = (m[1] || m[2]).replace(/[\\/]+$/, '');
  return RE_DIR_ID.test(path.basename(dir)) ? dir : null;
}

/** 列出当前打开的 Roxy 窗口进程（含由命令行解析出的 dirId 与数据目录） */
async function listOpenWindows(force = false) {
  const procs = await netinfo.findProcesses([R.chromeProcess], force);
  const windows = [];
  for (const p of procs) {
    const cmd = String(p.Cmd || '');
    if (cmd.includes('--type=')) continue; // 只认浏览器主进程（排除 renderer/gpu/utility 子进程）
    const dataDir = windowDataDir(cmd);
    if (!dataDir) continue;
    windows.push({ dirId: path.basename(dataDir), dataDir, pid: p.Id, title: p.Title || '' });
  }
  return windows;
}

/** 查指定窗口是否已打开：优先按 dirId 匹配（标题可能被页面改写，不可靠） */
async function findOpenWindow(dirId, windowName, force = false) {
  const windows = await listOpenWindows(force);
  const byDir = windows.find((w) => w.dirId === dirId);
  if (byDir) return byDir;
  if (windowName) return windows.find((w) => w.title === windowName) || null;
  return null;
}

/** 等待窗口出现（最多 timeoutMs） */
async function waitForWindow(dirId, windowName, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const win = await findOpenWindow(dirId, windowName, true);
    if (win) return win;
    await sleep(config.timeouts.pollIntervalMs);
  }
  return null;
}

/* ---------- roxynet 端口 ---------- */

async function roxynetPids(force = false) {
  const procs = await netinfo.findProcesses([R.roxynetProcess], force);
  return procs.map((p) => p.Id);
}

async function roxynetListenPorts(force = false) {
  const pids = await roxynetPids(force);
  const list = await netinfo.listeners(force);
  const ports = list.filter((l) => pids.includes(l.Pid)).map((l) => l.Port);
  return [...new Set(ports)];
}

/** 判断某端口是否为 roxynet 的混合代理口（未认证请求应答 407 + realm=roxynet） */
function probeIsProxyPort(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: 'http://example.com/', method: 'GET', headers: { Host: 'example.com' } },
      (res) => {
        const auth = String(res.headers['proxy-authenticate'] || '');
        res.resume();
        resolve(res.statusCode === 407 && /roxynet/i.test(auth));
      }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

async function findProxyPort() {
  const ports = await roxynetListenPorts(true);
  for (const port of ports) {
    if (await probeIsProxyPort(port)) return port;
  }
  return null;
}

/* ---------- 静态 IP 出口校验 ---------- */

/** 单次尝试：经 roxynet 通道请求 ipinfo */
async function tryStaticEgress(port, dirId) {
  const r = await curlGet(config.flags.staticIpProbeUrl, {
    proxy: `127.0.0.1:${port}`,
    basicAuth: [dirId, dirId],
    timeoutSec: Math.ceil(R.roxynetProbeTimeoutMs / 1000),
  });
  if (r.code !== 0 || !r.stdout) return null;
  try {
    const info = JSON.parse(r.stdout);
    return { ip: info.ip, country: info.country, city: info.city, org: info.org, region: info.region };
  } catch {
    return null;
  }
}

/** 经 roxynet 验证静态 IP 出口（带重试，网络抖动时重试 3 次） */
async function checkStaticEgress(port, dirId, attempts = 3) {
  for (let i = 0; i < attempts; i += 1) {
    const info = await tryStaticEgress(port, dirId);
    if (info) return info;
    if (i < attempts - 1) await sleep(3000);
  }
  return null;
}

module.exports = {
  decryptLumi,
  decryptLumiAt,
  listWindowDirs,
  findDirIdByWindowName,
  listOpenWindows,
  findOpenWindow,
  waitForWindow,
  roxynetPids,
  roxynetListenPorts,
  findProxyPort,
  checkStaticEgress,
};
