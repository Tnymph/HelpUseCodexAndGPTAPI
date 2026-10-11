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

function buildNodeYaml(port, dirId) {
  return [
    '# Managed by HelpUseCodexAndGPTAPI (program A). 由程序A自动生成，请勿手改。',
    'prepend:',
    `  - name: ${C.nodeName}`,
    '    type: socks5',
    '    server: 127.0.0.1',
    `    port: ${port}`,
    `    username: ${dirId}`,
    `    password: ${dirId}`,
    '    udp: true',
    'append: []',
    'delete: []',
    '',
  ].join('\n');
}

function buildGroupYaml(backupNode) {
  const members = [`${C.nodeName}`];
  if (C.groupType === 'fallback' && backupNode && backupNode !== C.nodeName) members.push(`'${backupNode}'`);
  return [
    '# Managed by HelpUseCodexAndGPTAPI (program A). 由程序A自动生成，请勿手改。',
    'prepend:',
    `  - name: ${C.groupName}`,
    `    type: ${C.groupType}`,
    `    proxies: [${members.join(', ')}]`,
    `    url: ${C.healthCheckUrl}`,
    `    interval: ${C.healthCheckInterval}`,
    'append: []',
    'delete: []',
    '',
  ].join('\n');
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

module.exports = { syncProfile, slotPath, buildNodeYaml, buildGroupYaml, buildRulesYaml };
