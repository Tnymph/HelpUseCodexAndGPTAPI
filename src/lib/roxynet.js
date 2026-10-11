'use strict';
/**
 * Roxy Browser / roxynet 探测：
 * - 窗口名 ↔ dirId（从 RoxyChrome 命令行解析，或解密 browser-cache\<dirId>\lumi.conf）；
 * - roxynet 的"混合代理口"（动态端口，用 407+Proxy-Authenticate 特征识别）；
 * - 经 roxynet 验证美国静态 IP 出口。
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

const RE_USER_DATA_DIR = /--user-data-dir="?([^"]*browser-cache[\\/][0-9a-f]{32})"?/;

/* ---------- lumi.conf 解密 ---------- */

function decryptLumi(dirId) {
  const file = path.join(R.browserCacheDir, dirId, 'lumi.conf');
  const raw = fs.readFileSync(file, 'utf8').trim();
  const buf = Buffer.from(raw, 'base64');
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(0, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(R.lumiKey, 'utf8'), Buffer.from(R.lumiIv, 'utf8'));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

function listWindowDirs() {
  try {
    return fs.readdirSync(R.browserCacheDir).filter((d) => /^[0-9a-f]{32}$/.test(d));
  } catch {
    return [];
  }
}

/** 解密扫描：windowName → dirId（窗口未打开时也能用） */
function findDirIdByWindowName(windowName) {
  for (const dirId of listWindowDirs()) {
    try {
      const cfg = decryptLumi(dirId);
      if (cfg.windowName === windowName) return dirId;
    } catch { /* 单个目录解密失败不影响其它 */ }
  }
  return null;
}

/* ---------- 打开中的窗口 ---------- */

/** 列出当前打开的 Roxy 窗口进程（含由命令行解析出的 dirId） */
async function listOpenWindows(force = false) {
  const procs = await netinfo.findProcesses([R.chromeProcess], force);
  const windows = [];
  for (const p of procs) {
    const cmd = String(p.Cmd || '');
    if (!cmd.includes('browser-cache')) continue;
    if (cmd.includes('--type=')) continue; // 只认浏览器主进程（排除 renderer/gpu/utility 子进程）
    const m = cmd.match(RE_USER_DATA_DIR);
    if (!m) continue;
    windows.push({ dirId: path.basename(m[1]), pid: p.Id, title: p.Title || '' });
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
