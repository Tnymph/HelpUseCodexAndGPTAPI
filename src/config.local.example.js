'use strict';
/**
 * 本机私密参数的示例文件。
 *
 * 用法：把本文件复制为同目录下的 config.local.js，填入你自己的值。
 * config.local.js 已在 .gitignore 中，**不会**被提交到公开仓库；
 * config.js 会把这里的字段深度合并覆盖到默认值之上。
 */
module.exports = {
  roxy: {
    // 你的指纹浏览器窗口名（Roxy 界面里看到的窗口名）
    windowName: '你的窗口名，例如 261011-1',
    // Roxy 工作区 ID：Roxy 里"窗口/浏览器"相关网页或本地 API 的 workspaceId
    workspaceId: '你的工作区ID（纯数字）',
    // 你的美国静态 IP（仅用于日志提示与"是否符合预期"的比对，不强制）
    expectedStaticIp: '你的美国静态IP',
  },
  // 其它可选覆盖，例如：
  // clash: { appExe: 'E:\\Clash Verge\\clash-verge.exe' },
  // roxy: { appExe: 'E:\\RoxyBrowser\\RoxyBrowser.exe' },
};
