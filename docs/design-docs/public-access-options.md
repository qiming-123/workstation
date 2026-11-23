# 公网接入方案对比（SPEC §8.1 决策支持）

- 日期：2026-11-23
- 状态：**已决策**（2026-11-23）：组合 B —— frp + 阿里云轻量 VPS
- 关联：`SPEC.md` §8.1（公网接入，已定）、§8.2（认证，待定）
- 变更：2026-11-23 用户决定 WoL 移出首版范围，本文 §3 保留为参考，不再是决策项。
- 说明：本文只做选项与依据，不做最终决定；决定后按 `AGENTS.md` 约定更新本文状态。

## 0. 决策点回顾

需求约束（来自 SPEC §3、§4）：

- 公网可达，**无域名、无 VPS**；
- 任意电脑浏览器可打开网站（场景 A：在外面的电脑连接本机应用）；
- 需要远程桌面（RDP，TCP 3389）与预设动作；
- ~~需要远程唤醒（WoL）~~（2026-11-23 移出首版范围）；
- 项目将开源，他人需能在自己电脑上复现部署。

## 1. 候选方案总览

| 维度 | Tailscale（+Funnel） | Cloudflare Tunnel | frp + 自建 VPS | 花生壳等商业隧道 |
|---|---|---|---|---|
| 成本 | 免费（Personal 计划，不限设备，≤6 用户） | 免费（不限流量带宽） | VPS 首年 ¥38–99（新客价），续费约 ¥68–200/年；大带宽无限流量档 ¥50/月 | 免费版 1Mbps/1GB 每月，不可用；付费 ¥398/年起 |
| 需要域名 | 否 | 需要（可用 DigitalPlat 等免费域名托管到 CF） | 否（可直接用 IP） | 否 |
| 需要 VPS | 否 | 否 | **是** | 否 |
| 任意浏览器直达网站 | 需开 Funnel（限 443/8443/10000 端口，带宽受限）；否则访客须装客户端 | 是，天然 HTTP/HTTPS | 是 | 是 |
| 认证能力 | Tailscale 身份即认证（网络层）；Funnel 公开段需应用自认证 | Cloudflare Access 边缘认证（邮箱 OTP 等，免费 ≤50 用户） | 无，应用自认证 | 部分套餐有访问控制 |
| RDP / 任意 TCP | tailnet 内直连 RDP，体验最好 | TCP 需访问端也装 cloudflared，较绕 | 原生支持，最直接 | 支持但受套餐限制 |
| 国内访问体验 | 官方中继在海外，直连失败时变慢；可自建中继改善 | 海外边缘节点，国内速度不稳定（社区称"减速器"） | 取决于 VPS 位置，国内 VPS 最快最稳 | 国内 BGP 机房，延迟低 |
| 他人开源自部署难度 | 低（注册账号即用） | 中（需注册 CF + 弄一个域名） | 中高（需买 VPS + 运维） | 低（但锁定厂商） |

## 2. 各方案要点与依据

### 2.1 Tailscale（WireGuard 组网 + Funnel）

- 本质不是"公网网站"，而是把你自己的设备组成加密私有网；自己的电脑/手机装客户端后互访，网络层即认证，安全性天然最高。
- 需要"任意浏览器免客户端访问"时用 Funnel 把服务发布到公网：固定 `ts.net` 域名，仅 TLS 端口 443/8443/10000，带宽受限不可调。
- RDP、文件传输在 tailnet 内走 WireGuard 直连，速度快、体验好。
- 依据：[Tailscale 定价页](https://tailscale.com/pricing)（Personal 免费、不限设备）、[Funnel 对比资料](https://hostc.dev/zh/alternatives/tailscale-funnel)。

### 2.2 Cloudflare Tunnel

- `cloudflared` 主动出站建隧道，无需公网 IP、无需开放入站端口；HTTPS 由 CF 边缘终止。
- 免费不限流量带宽；命名隧道需一个托管在 Cloudflare 的域名（可零成本：DigitalPlat 免费域名）。
- Cloudflare Access 可在边缘加统一认证（邮箱一次性验证码等），免费额度 ≤50 用户——恰好覆盖 SPEC §8.2 的认证需求，应用内可少造一层轮子。
- 短板：国内访问速度不稳定；主要面向 HTTP/HTTPS，RDP 等 TCP 需访问端配合 cloudflared。
- 依据：[Cloudflare Tunnel + 免费域名实践](https://bbs.csdn.net/weixin_42523529/article/details/100674072)、[2026 内网穿透盘点](https://news.qq.com/rain/a/20260928A03DII00)。

### 2.3 frp + 自建 VPS

- 开源自托管（2026 年已至 v0.70），协议全覆盖（TCP/UDP/HTTP/HTTPS），RDP 直接映射 3389 即可。
- 完全自主可控、数据只过自己的服务器；代价是买 VPS + 自己运维（无 GUI、自配 TLS/白名单/日志）。
- 对国内访问最稳；认证需应用自己实现。
- **价格细节（2026-11 核实，活动价有时效）**：frps 本身很轻，2核2G 足够；瓶颈在带宽和流量，直接影响"数 GB 文件传输"体验。
  - 阿里云轻量：2核2G、**200M 峰值带宽、不限流量**，新客秒杀 ¥38/年、常规活动 ¥68/年；续费恢复常规价，非长期 38 元。
  - 腾讯云轻量：2核2G/3M/200GB 月流量 ¥68/年（首单）；**锐驰型** 2核2G、200M 峰值、无限流量 ¥50/月（2026-06 起支持北京/上海/广州/成都/南京）。
  - 华为云云耀 L：2核2G/3M ¥89/年。
  - 域名可选：frp 可直接用 IP+端口；要域名约 ¥10–70/年。
  - 注意「峰值带宽 ≠ 独享带宽」；3M 固定带宽档（约 375KB/s）传 2GB 文件要约 90 分钟，文件传输场景应优先选 200M 峰值档。
- 依据：[frp 部署实践](https://www.ygcloud.com/knowledge/3092/)、[方案对比](https://post.smzdm.com/p/a4qe2mq7)、[腾讯云轻量价格总览](https://cloud.tencent.com/document/product/1207/73452)、[阿里云 2026 轻量价格](https://developer.aliyun.com/article/1785193)、[腾讯云锐驰型说明](https://hostzhinan.com/tencent-lighthouse-ruichi/)。

### 2.4 商业隧道（花生壳等）

- 免费版 1Mbps 带宽 + 1GB/月流量，无法满足"数 GB 文件传输"，仅够演示；付费 ¥398/年起。
- 优势是国内延迟低、零配置；对开源项目意味着把使用者锁定到单一厂商。
- 依据：[2026 内网穿透盘点](https://news.qq.com/rain/a/20260928A03DII00)。

## 3. WoL 专题（已移出首版范围，仅留作参考）

> 2026-11-23 用户决定首版不做远程唤醒。本节研究结论保留，若未来重启该需求可直接复用。

关键事实：**WoL 魔术包是二层广播，三层隧道（Tailscale/frp/CF Tunnel）一律送不到睡眠中的网卡**。Tailscale 官方博客明确说明自身无法发送 WoL 包，需另一台同网段设备代送；其源码中的 `/v0/wol` PeerAPI 端点属于未公开的内部机制，不能依赖。

因此无论 §8.1 选什么，WoL 触发方（SPEC §8.4）只能在以下几项中选：

| 触发方 | 前提 | 成本/难度 |
|---|---|---|
| 同网段常开小设备（树莓派 / NAS）跑 UpSnap 或 etherwake，经 Tailscale 触达 | 家中有常开设备，与主机**有线**同网段 | 低（若有现成设备） |
| 路由器自带 WoL（OpenWrt luci-app-wol、华硕 Merlin 等） | 路由器支持 | 低 |
| 智能插座 + BIOS「断电恢复后自动开机」 | 主板支持 AC Recovery | 最低（几十元插座，手机 App 即可远程断电重启） |
| 主机不休眠 | 接受常开电费 | 零 |

注意：Wi-Fi 网卡普遍不支持 WoL，目标主机需有线接入。

依据：[Tailscale 官方 WoL 博客](https://tailscale.com/blog/wake-on-lan-tailscale-upsnap)、[WoL 与 Tailscale 详解](https://tailscale.tw/use-cases/wake-on-lan/)。

## 4. 可行的组合（供决策参考，非结论）

- **组合 A：Cloudflare Tunnel + Access（网站）＋ Tailscale（RDP/文件传输加速）**
  网站任意浏览器可达且认证由 CF Access 兜底；RDP 与应用连接走 tailnet。零现金成本。风险：CF 国内速度、双系统并存略复杂。
- **组合 B：frp + 国内 VPS（网站 + RDP）**
  国内体验最好、架构最简单（一套隧道管全部），认证需自建。成本：VPS 月费。
- **组合 C：纯 Tailscale（+Funnel 应急公开）**
  最省事、最安全，但"任意浏览器免客户端"只能靠 Funnel（端口/带宽受限），与他人在 GitHub 复现的通用性略差。

## 5. 决策记录

1. §8.1 接入方案：**已选组合 B（frp + 阿里云轻量 VPS）**，2026-11-23。
2. VPS 费用：用户接受（阿里云轻量，2核2G、200M 峰值不限流量档）。

## 6. 来源

- Tailscale 定价：https://tailscale.com/pricing
- Tailscale Funnel 对比：https://hostc.dev/zh/alternatives/tailscale-funnel
- Tailscale WoL 官方博客：https://tailscale.com/blog/wake-on-lan-tailscale-upsnap
- WoL 与 Tailscale 详解（含 UpSnap/路由器方案）：https://tailscale.tw/use-cases/wake-on-lan/
- Cloudflare Tunnel + 免费域名实践：https://bbs.csdn.net/weixin_42523529/article/details/100674072
- 2026 内网穿透方案盘点：https://news.qq.com/rain/a/20260928A03DII00
- frp 部署实践：https://www.ygcloud.com/knowledge/3092/
- 腾讯云轻量价格总览：https://cloud.tencent.com/document/product/1207/73452
- 阿里云 2026 轻量价格解析：https://developer.aliyun.com/article/1785193
- 腾讯云锐驰型（200M 峰值无限流量）说明：https://hostzhinan.com/tencent-lighthouse-ruichi/
