'use strict';
/**
 * 统一日志：带时间戳与等级；控制台（UTF-8）与日志文件双写。
 * 日志文件位置：state\logs\<name>-<时间戳>.log（提权到新窗口运行时也能留档）。
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

let fileStream = null;
let filePath = null;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fileStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 把输出同时写入日志文件；返回日志文件路径 */
function initLogFile(name) {
  const dir = path.join(config.STATE_DIR, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  filePath = path.join(dir, `${name}-${fileStamp()}.log`);
  fileStream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
  return filePath;
}

function write(text) {
  process.stdout.write(text);
  if (fileStream) fileStream.write(text);
}

function line(level, msg) {
  write(`[${stamp()}] [${level}] ${msg}\n`);
}

/** 无前缀输出一行文本 */
function plain(msg) {
  write(`${msg}\n`);
}

/** 逐行输出明细（用于错误提示等） */
function details(items) {
  for (const item of items) plain(`  · ${item}`);
}

module.exports = {
  initLogFile,
  logFilePath() { return filePath; },
  step(n, msg) { line('步骤', `${String(n).padStart(2)}. ${msg}`); },
  info(msg) { line('信息', msg); },
  ok(msg) { line('成功', msg); },
  warn(msg) { line('警告', msg); },
  err(msg) { line('错误', msg); },
  plain,
  details,
  blank() { write('\n'); },
};
