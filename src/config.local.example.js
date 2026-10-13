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
    // （可选）Roxy 缓存根目录被改到其它盘时的候选位置。
    // 程序识别"窗口是否打开"不依赖它；只有"窗口未打开、需要按名字找 dirId"时才需要补充。
    // browserCacheDirsExtra: ['E:\\BrowserCache'],
  },
  // （可选）「直连静态 IP」节点：服务商导出的 socks5 静态代理（IP:端口:用户名:密码）。
  // 凭据不写进文件 —— 先导入到 Windows 用户环境变量（推荐：
  //   powershell -ExecutionPolicy Bypass -File tools\import-static-proxy.ps1 -File 你的导出文件.txt
  // 或手动： setx GPT_PROXY_USER 你的用户名   /   setx GPT_PROXY_PASSWORD 你的密码 ），再按下例填写。
  // 填写后程序会把 GPT-US-Direct 节点 + GPT-US-Jump 跳板组写进 Clash（出口与原静态链路同一个 IP）。
  // clash: {
  //   directProxy: {
  //     server: '1.2.3.4',
  //     port: 5782,
  //     username: process.env.GPT_PROXY_USER || '',
  //     password: process.env.GPT_PROXY_PASSWORD || '',
  //   },
  //   // （可选）把默认通道切成"直连静态 IP"（不依赖 Roxy 窗口 / roxynet 动态端口）：
  //   // pinNode: 'GPT-US-Direct',
  // },
  // 其它可选覆盖，例如：
  // clash: { appExe: 'E:\\Clash Verge\\clash-verge.exe' },
  // roxy: { appExe: 'E:\\RoxyBrowser\\RoxyBrowser.exe' },
};
