# 05 · OpenAI（ChatGPT / API）付费与充值方法调研

> 调研日期：2026-10-11。中国大陆用户视角。所有平台状态变动极快，**下单当天务必复核**；标注【未验证】的条目为社区信息。

## 摘要

1. **官方 API（platform.openai.com）只收 Visa / Mastercard / Amex 的信用卡或借记卡**（Stripe 处理），且**发卡行必须在 OpenAI 支持地区**；中国大陆/香港/澳门不在支持列表。银联、支付宝、微信、PayPal、加密货币都不行；**预付卡被官方明确禁止用于购买 API credits**（这条直接卡死了大多数虚拟卡）。
2. **API 是预付 credits 模式**：最低 $5（默认 $10）起充，auto-reload 默认开启；credits **1 年过期**；基本不可退款。创建首个 API key 需手机验证（+86 不支持）。
3. **虚拟卡（U 卡）市场 2024–2026 大面积关停**（WildCard/野卡、Depay/Dupay、OneKey Card、NobePay、Fomepay 等已停服或跑路）；2026 年仍被讨论的只剩 RedotPay、PokePay 等 USDT 充值型 U 卡，**直付 OpenAI 成功率据社区实测已跌至 30–40%**，且存在资金/封号/合规多重风险。
4. **ChatGPT 订阅（Plus $20/月）**：网页端同样只收国际卡；中国用户最主流的可行路线是 **美区 Apple ID + 美区 App Store 礼品卡 + iOS App 内购**（约 ¥135–150/月），一次性绑定、风险点是黑卡与账号绑定不可解；**若目的是用 Desktop/ChatGPT 客户端 + Codex**，这条路比"API 充值"更现实（订阅内含 Codex 额度）。
5. **第三方 API 中转站**（OpenAI 兼容 base_url 代理）：支付宝/微信可付、国内可直连，价格约官方 0.5–2 倍；但 2026 年权威测评显示**大量中转站存在模型偷换、隐藏指令注入、延迟造假**（404 实验室报告：75/100 个站点有模型真实性异常）——只发非敏感内容、独立低权限 key、小额试水。
6. **Azure OpenAI**：官方合法通道，但 2024-10 起中国大陆个人用户通道已关闭，需企业资质（世纪互联）或有海外主体走全球版。
7. **合规事实**：OpenAI 支持地区列表不含中国大陆/港澳；官方措辞"在未列出的地区访问服务可能导致账号被冻结或停用"；2024-07 起屏蔽非支持地区的 API 流量。"绕过访问限制"属官方列出的可停用行为之一。

## 一、官方 API 计费（事实）

- 支付方式：Visa / Mastercard / Amex 信用卡或借记卡（由 Stripe 处理，卡须由支持地区银行发行）。
- 明确不接受：PayPal、加密货币、银行转账、支付宝/微信/银联；**"Prepaid cards cannot be used to purchase API credits"**（预付卡不能买 API credits）。
- 机制：预付 credits；最低 $5、默认 $10；auto-reload 可设触发阈值/补足金额/月度上限；**credits 1 年过期**；退款仅限核实过的账单错误/未授权交易/服务故障。
- 支付失败：报错不加 credits；auto-reload 失败会邮件通知；余额耗尽 API 返回 `credit_balance_exhausted`。
- 风控相关：账单信息不实/支付异常会触发风控；"共享账号/API key、绕过访问限制"被官方列为可停用行为。
- 官方礼品卡（2025 末上线）：$15–$250，**仅美国零售渠道 + USD 账户**，只能进 ChatGPT Wallet，**不能付 API credits**，对中国用户实际不可用。
- 来源：help.openai.com 8264644 / 7232916 / 20001491 / 20001508 / 5347006 / 8983035；developers.openai.com/api/docs/supported-countries；openai.com/policies/terms-of-use

## 二、虚拟卡 / U 卡市场（2026 现状，高风险）

| 平台 | 状态（2024–2026） | 备注 |
|---|---|---|
| OneKey Card | 2024-09 停新注册 → 2025-01 全面停止 | 退款较有序 |
| WildCard 野卡 | 2025-02 暂停发卡 → 2025-07-12 停服 → 2025-09 以 WildAI 回归（不再出卡，只做代订阅） | 开卡费争议 |
| Depay / Dupay | 2025-11-30 关闭服务器 | 提现靠人工 |
| NobePay | 2025 年封号、客服失联，余额迁移到 UCards | 常见 BIN 被 Stripe 列入高风险 |
| Fomepay / VCard / Cardopay | 2025–2026 疑似跑路 | 社区黑名单 |
| Bitget/Fiat24 系（SafePal、imToken 卡） | 2026-06-05 起暂停中国大陆新开户 | 老用户不受影响 |
| RedotPay（小红卡） | 仍在运营；USDT 充值，开卡 $10–20 | 政策反复（部分官方文档限制大陆）【未验证】 |
| PokePay | 仍在运营；开卡约 $5 | 有 GPT 支付失败反馈【未验证】 |
| OpenRouter（国际聚合） | Stripe 支持支付宝/微信（+约 5.5%） | 账单地址填大陆时 OpenAI/Anthropic/Google 模型不可用 |

风险提示：突发关停吞余额、Stripe BIN 风控/拒付、KYC 隐私、外汇合规灰区、买"黑卡"的违法与封号风险（后者本项目不展开也不建议）。

## 三、第三方中转站（API 中转）与 Azure

- 原理：OpenAI 兼容的 base_url 代理（one-api/new-api 自建为主），聚合上游账号计费；优势是支付宝/微信直付、国内直连。
- 定价：约官方 0.5–2 倍；"1 元 285 万 Token"类超低价多为陷阱（降级模型/倒卖 key/数据风险）。
- 权威测评（知道创宇 404 实验室，2026-09，评测 100 站）：**135 个"模型×站点"组合实际不可用、296 个组合存在模型真实性异常（涉及 75 个站点）、110 个存在隐藏指令注入**；S 级站点示例：sectoken、requesty、aisa、aihubmix。仓库 github.com/AITrustTools/llm-relay-assessment。
- 自保建议：只用非敏感内容；独立低权限 key + 预算/并发上限；小额试水；优先官方直连。
- Azure OpenAI：官方合法替代；**2024-10-21 起微软终止中国大陆个人用户的 Azure OpenAI**（仅企业客户）；有海外主体可走全球版 Azure（按 Token 计费）。【官方口径未直接核对，未验证细节】

## 四、ChatGPT Plus / Pro 订阅（2026-10 官方定价）

- 价格：Free $0 / Go $8 / **Plus $20** / Pro 从 $100 起（$100/$200/$500 档）。
- 网页结账：Visa/MC/Amex；不支持支付宝/微信。iOS App Store / Google Play 内购仍然有效。
- **美区 Apple ID + App Store 礼品卡 + iOS 内购**（中国用户主流路线）：
  1. 自行注册美区 Apple ID（不要买二手号）；
  2. 支付宝 → "Coupons" 小程序 → Pockyt 购美区 App Store 礼品卡（$20 约 ¥136）；
  3. 兑换进美区 ID → iOS ChatGPT App 内购 Plus（$19.99/月），账单地址填免税州（Oregon/Montana）。
  风险：**一个 Apple ID 首次内购即永久绑定一个 ChatGPT 账号，不可换绑**；低价黑卡会导致余额清零/订阅取消，最严重波及 iCloud。
- 代充/代订阅：把账号/支付交给第三方，风险大，不建议长期使用。
- 来源：openai.com/chatgpt/pricing、help.openai.com 6950777/7242622、GitHub 社区指南（cabbagecabbage/chatgpt-plus-codex-cn-guide 等）。

## 五、合规要点（事实陈述）

- 支持地区列表不含中国大陆/香港/澳门；页面警告"在列表外访问服务可能导致账号被冻结或停用"。
- 2024-07-09 起 OpenAI 屏蔽非支持地区的 API 流量。
- 帮助中心把"共享账号/API key、绕过访问限制"列为可停用行为；申诉入口 openai.com/form/appeal。
- 2025–2026 风控观察【未验证】：老账号二次手机验证、IP 跨区频繁触发、接码平台号码大量被拉黑；+86 手机号至今不支持验证短信。
- **实操含义（与本项目相关）**：既然要用，就保持"一贯的美国静态 IP + 稳定环境"（不要频繁切换 IP/地区），这是降低风控不确定性的通用做法。

## 六、路线对比与建议

| 路线 | 支付方式 | 难度 | 成本 | 主要风险 | 适合 |
|---|---|---|---|---|---|
| **美区 Apple ID 内购 Plus** | 支付宝买礼品卡 | 中 | ≈¥140/月 | Apple ID 永久绑定、黑卡 | **用 Desktop/Codex 开发（首选）** |
| 官方 API credits + 可靠 U 卡 | USDT → 虚拟卡 → Stripe | 高 | $5 起 + 手续费 | 成功率 30–40%、平台跑路 | 需要官方 API key |
| 中转站（API2D/AIHubMix 等） | 支付宝/微信 | 低 | ≈官方 1.5 倍 | 模型偷换/注入/泄露 | 预算优先、非敏感内容 |
| OpenRouter | 支付宝/微信（+5.5%） | 中 | 官方价 + 手续费 | 大陆账单地址限制模型 | 国际聚合器 |
| Azure OpenAI 全球版 | 海外主体 + 国际卡 | 高 | 按量 | 大陆个人不可用 | 企业/海外主体 |

**给本项目的建议**：桌面 ChatGPT（Codex）走"美区 Apple ID 内购 Plus"最稳；只有当确实需要 `api.openai.com` key 时再考虑小额官方 credits + 可靠 U 卡，并做好被拒付的心理预期；中转站只作为临时/非敏感用途。

## 总结

1. 官方 API 充值对大陆用户的实际门槛 = "支持地区的卡"；预付卡被官方明文拒绝，虚拟卡市场也已大面积退场。
2. 若目标是"用 GPT 桌面端/Codex"，**订阅（美区 Apple ID 内购）比 API 充值更现实**，且订阅内已含 Codex 额度。
3. 所有第三方渠道都带资金/封号/隐私风险，务必小额试水、独立 key、非敏感内容。
4. 合规事实需要知道：非支持地区访问可能导致账号停用；本项目的"固定美国静态 IP"策略本身就是降低风控不确定性的做法。
