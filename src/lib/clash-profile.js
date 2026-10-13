'use strict';
/**
 * Clash 订阅扩展文件维护（节点 / 代理组 / 规则三个槽位）。
 * 结构：prepend / append / delete（Clash Verge v1.7.1+ 的扩展文件 schema）。
 * 首次覆盖前会自动备份原文件（*.gptproxy-backup）。
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const C = config.clash;

function slotPath(fileName) {
  return path.join(C.dataDir, 'profiles', fileName);
}

/** 是否配置了「直连静态 IP」代理（config.local.js 的 clash.directProxy，凭据来自环境变量） */
function hasDirectProxy() {
  return Boolean(C.directProxy && C.directProxy.server && C.directProxy.port);
}

/**
 * 「直连静态 IP」节点：不经 Roxy/roxynet，直接连服务商的 socks5 静态代理。
 * 建连走 dialer-proxy（= GPT-US-Jump 跳板组，默认 DIRECT）——
 * 哪天国内直连被阻断，把跳板组切到订阅美国节点即可，不必改这里。
 */
function directNodeLines() {
  const d = C.directProxy;
  const lines = [
    `  - name: ${C.directNodeName}`,
    '    type: socks5',
    `    server: ${d.server}`,
    `    port: ${d.port}`,
  ];
  if (d.username) lines.push(`    username: ${d.username}`);
  if (d.password) lines.push(`    password: ${d.password}`);
  lines.push('    udp: true', `    dialer-proxy: ${C.directJumpGroup}`);
  return lines;
}

function buildNodeYaml(port, dirId) {
  const lines = [
    '# Managed by HelpUseCodexAndGPTAPI (program A). 由程序A自动生成，请勿手改。',
    'prepend:',
    `  - name: ${C.nodeName}`,
    '    type: socks5',
    '    server: 127.0.0.1',
    `    port: ${port}`,
    `    username: ${dirId}`,
    `    password: ${dirId}`,
    '    udp: true',
  ];
  if (hasDirectProxy()) lines.push(...directNodeLines());
  lines.push('append: []', 'delete: []', '');
  return lines.join('\n');
}

function buildGroupYaml(backupNode) {
  const members = [`${C.nodeName}`];
  if (hasDirectProxy()) members.push(C.directNodeName);
  if (C.groupType === 'fallback' && backupNode && backupNode !== C.nodeName) members.push(`'${backupNode}'`);
  const lines = [
    '# Managed by HelpUseCodexAndGPTAPI (program A). 由程序A自动生成，请勿手改。',
    'prepend:',
    `  - name: ${C.groupName}`,
    `    type: ${C.groupType}`,
    `    proxies: [${members.join(', ')}]`,
    `    url: ${C.healthCheckUrl}`,
    `    interval: ${C.healthCheckInterval}`,
  ];
  // 跳板兜底组：GPT-US-Direct 的建连出口。默认 DIRECT（直接连静态代理）；
  // 直连被阻断时在 Clash 界面切到订阅美国节点即可（等价原 roxynet "经系统代理跳板"的链路）。
  if (hasDirectProxy()) {
    const jumpMembers = ['DIRECT'];
    if (backupNode && backupNode !== C.nodeName && backupNode !== C.directNodeName) jumpMembers.push(`'${backupNode}'`);
    lines.push(
      `  - name: ${C.directJumpGroup}`,
      '    type: select',
      `    proxies: [${jumpMembers.join(', ')}]`,
      `    url: ${C.healthCheckUrl}`,
      `    interval: ${C.healthCheckInterval}`
    );
  }
  lines.push('append: []', 'delete: []', '');
  return lines.join('\n');
}

function buildRulesYaml() {
  const lines = ['# Managed by HelpUseCodexAndGPTAPI (program A). 由程序A自动生成，请勿手改。', 'prepend:'];
  for (const rule of C.rules) lines.push(`  - ${rule}`);
  lines.push('append: []', 'delete: []', '');
  return lines.join('\n');
}

function normalize(text) {
  return text.replace(/\r\n/g, '\n').trim();
}

function readSlot(fileName) {
  try {
    return fs.readFileSync(slotPath(fileName), 'utf8');
  } catch {
    return null;
  }
}

function writeSlot(fileName, content) {
  const target = slotPath(fileName);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const backup = `${target}.gptproxy-backup`;
  if (fs.existsSync(target) && !fs.existsSync(backup)) fs.copyFileSync(target, backup);
  fs.writeFileSync(target, content, { encoding: 'utf8' });
}

/**
 * 同步三个扩展文件；内容一致则不动。
 * @returns {{ changed: string[], unchanged: string[] }}
 */
function syncProfile(port, dirId, backupNode) {
  const expected = [
    [C.slotProxies, buildNodeYaml(port, dirId)],
    [C.slotGroups, buildGroupYaml(backupNode)],
    [C.slotRules, buildRulesYaml()],
  ];
  const changed = [];
  const unchanged = [];
  for (const [fileName, content] of expected) {
    const current = readSlot(fileName);
    if (current !== null && normalize(current) === normalize(content)) {
      unchanged.push(fileName);
      continue;
    }
    writeSlot(fileName, content);
    changed.push(fileName);
  }
  return { changed, unchanged };
}

module.exports = { syncProfile, slotPath, buildNodeYaml, buildGroupYaml, buildRulesYaml, hasDirectProxy };
