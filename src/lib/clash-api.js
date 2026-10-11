'use strict';
/**
 * Clash Verge 内核控制：运行时枚举命名管道（verge-mihomo-*），
 * 在管道上以 HTTP 方式调用 Clash REST API（管道访问不校验 secret）。
 * 参考：skills\03-ClashVerge知识.md
 */
const http = require('http');
const netinfo = require('./netinfo');

async function findPipeName() {
  const pipes = await netinfo.pipeNames(true);
  const hit = pipes.find((p) => p.includes('\\pipe\\verge-mihomo-'));
  if (!hit) throw new Error('未找到 Clash 内核命名管道（Clash Verge / 内核是否在运行？）');
  return hit.split('\\pipe\\')[1];
}

function request(pipeName, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const options = {
      socketPath: `\\\\.\\pipe\\${pipeName}`,
      path: apiPath,
      method,
      agent: false, // 每次请求用新的管道连接，避免复用已被服务端关闭的套接字导致等待
      headers: { Host: 'localhost', Connection: 'close' },
    };
    if (payload) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('管道请求超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function call(method, apiPath, body) {
  const pipe = await findPipeName();
  return request(pipe, method, apiPath, body);
}

const enc = (s) => encodeURIComponent(s);

async function version() {
  return call('GET', '/version');
}

async function getProxies() {
  const r = await call('GET', '/proxies');
  return r.json ? r.json.proxies : null;
}

async function getProxy(name) {
  const r = await call('GET', `/proxies/${enc(name)}`);
  return r.json;
}

async function selectProxy(group, node) {
  return call('PUT', `/proxies/${enc(group)}`, { name: node });
}

async function testDelay(node, url, timeoutMs = 8000) {
  const r = await call('GET', `/proxies/${enc(node)}/delay?url=${encodeURIComponent(url)}&timeout=${timeoutMs}`);
  return r.json;
}

/** 组内全员测速（同时会刷新成员健康状态，让 fallback 组尽快切回首选节点） */
async function testGroupDelay(group, url, timeoutMs = 6000) {
  const r = await call('GET', `/group/${enc(group)}/delay?url=${encodeURIComponent(url)}&timeout=${timeoutMs}`);
  return r.json;
}

async function getConnections() {
  const r = await call('GET', '/connections');
  return r.json;
}

/** 运行中的规则列表（用于判断扩展文件是否已被内核加载） */
async function getRules() {
  const r = await call('GET', '/rules');
  return r.json ? r.json.rules : null;
}

async function getConfigs() {
  const r = await call('GET', '/configs');
  return r.json;
}

async function patchConfigs(patch) {
  return call('PATCH', '/configs', patch);
}

/** 在全部代理中找一个"叶子节点"，名字命中给定的正则数组（按顺序优先） */
async function findLeafByName(matchers) {
  const proxies = await getProxies();
  if (!proxies) return null;
  const groupTypes = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Direct', 'Reject', 'Compatible', 'Pass', 'RejectDrop']);
  const leaves = Object.entries(proxies).filter(([, v]) => !groupTypes.has(v.type));
  for (const re of matchers) {
    const hit = leaves.find(([name]) => re.test(name));
    if (hit) return hit[0];
  }
  return null;
}

module.exports = {
  findPipeName,
  version,
  getProxies,
  getProxy,
  selectProxy,
  testDelay,
  testGroupDelay,
  getConnections,
  getConfigs,
  patchConfigs,
  getRules,
  findLeafByName,
};
