# 执行计划 001：VPS 购买 + frp 隧道打通

- 状态：进行中
- 创建：2026-11-23
- 关联：`ARCHITECTURE.md` §1/§4、`docs/design-docs/public-access-options.md`（组合 B 决策记录）
- 目标：把「浏览器 → VPS frps → frpc → 家中主机」的隧道跑通，为网站提供公网入口。

## 范围

**做**：买 VPS、装 frps/frpc、用一个临时 HTTP 服务验证隧道、基础加固。

**不做**：不映射 RDP 3389（SPEC §8.3 未决策）；不部署 workstation 服务端本身；不配域名（先用 IP+端口验证）。

## 步骤

### 1. 购买 VPS（人工操作）

- 阿里云轻量应用服务器，内地地域（就近），2核2G / 200M 峰值 / 不限流量档（新客 ¥38–68/年；注意续费恢复常规价）。
- 系统镜像选 Ubuntu LTS。
- 记录：公网 IP、root/密钥登录方式。
- 验证：本地 `ping <VPS-IP>` 通。

### 2. VPS 初始化加固

- 创建普通用户 + SSH 密钥登录，禁用 root 密码登录。
- 防火墙（ufw 或控制台安全组）只放行：SSH（建议改非标端口）、7000（frps 控制连接）、网站对外端口（暂用 8080 测试，正式 HTTPS 端口随架构落地再定）。
- 验证：从新终端能用密钥登录；`sudo ufw status` 只列上述端口。

### 3. 部署 frps（VPS 侧）

- 下载 frp 最新 release（GitHub fatedier/frp），解压。
- `frps.toml` 最小配置：
  - `bindPort = 7000`
  - `auth.token = <强随机 token>`（凭据只放 VPS 本地，不入库）
  - `webServer` 仪表盘可选，若开则必须设密码且仅监听回环/限 IP。
- systemd 常驻 + 开机自启。
- 验证：`systemctl status frps` active；`ss -tlnp | grep 7000` 在监听。

### 4. 部署 frpc（家中主机侧）

- 装在 WSL2 Ubuntu（或 Windows 原生，二选一，记入交接）。
- `frpc.toml` 最小配置：
  - `serverAddr = <VPS-IP>`、`serverPort = 7000`、`auth.token = <同上>`
  - 一条测试代理：把本机 `127.0.0.1:9000` 的 HTTP 服务映射到 VPS `8080`。
- 开机自启（WSL 需额外处理自启，或先用 Windows 计划任务）。
- 验证：frpc 日志出现 `login to server success`。

### 5. 端到端验证

- 主机侧起临时 HTTP 服务：`python3 -m http.server 9000`。
- 在外网（手机 4G 关 Wi-Fi）访问 `http://<VPS-IP>:8080`，能看到目录列表即隧道打通。
- 验证标准：外网可访问、刷新稳定、frps/frpc 日志无报错。

### 6. 收尾记录

- 把 VPS IP、端口分配、token 存放位置（不写真值）记入交接记录。
- 本计划移入 `docs/exec-plans/completed/`。

## 验收条件

1. 外网设备通过 VPS 公网地址访问到家中主机上的临时 HTTP 服务。
2. frps/frpc 均为 systemd/自启常驻，重启主机后隧道自动恢复（人工重启验证一次）。
3. VPS 防火墙仅放行约定端口；token 未出现在任何将提交到 Git 的文件中。

## 已知风险与注意

- 「200M 峰值」是共享带宽，不作为吞吐保证；正式文件传输体验以实测为准。
- 大陆 VPS + 域名对外提供网站服务可能涉及 ICP 备案；当前 IP+端口自用阶段由用户自行确认合规边界。
- token 泄露 = 隧道入口泄露；怀疑泄露时在 VPS 上换 token 并重启 frps/frpc。
