# 执行计划 002：文件后端最小集成验证

- 状态：已完成（2026-11-23）
- 前置：可用的 Windows 开发环境；可在本机使用测试数据执行
- 目标：验证 Node 认证代理与 copyparty 的最小工作链路，并确定计划 004 使用的文件后端。
- 依据：[SPEC §4.1、§8](../../../SPEC.md)、[技术方案 §1、§4](../../design-docs/tech-stack.md)

## 步骤

- [x] 在 Windows 启动仅监听回环地址的 copyparty，挂载专用测试目录，验证重启和任务计划程序拉起。
- [x] 建立本地 Node + Fastify 登录和文件代理，验证有无有效会话时的读写差异。使用 Debian WSL2 虚拟设备验证到主机 WLAN 地址无法直接连接，并核对 Windows 监听地址。
- [x] 在 Edge 中验证列表、上传、下载、新建文件夹、重命名和删除，以及图片、文本和视频预览。核对下载哈希、中文与空格名称。
- [x] 单独重启文件后端，复测原会话的列表、文件读取和无会话拒绝。

## 完成标准

留有可复现的本地核验记录。copyparty 能稳定完成上述流程并满足认证边界时，按混合架构进入 004。若无法满足，记录具体失败证据，按已定回退方案推进 004；届时验证 uppy 与 tus-node-server 的适用性，其他模块按原架构推进。数 GB 文件的续传与公网吞吐由 004 和 007 验收。

## 实测结果

| 项目 | 结果 |
|---|---|
| Windows 环境 | Node.js 24.21.0、Fastify 5.12.8、Python 3.13.17、copyparty 1.20.27、Edge 158.0.4370.33 |
| 认证 | 未登录读取、写入、伪造会话和错误测试密码均返回 401。登录后浏览器收到已签名的 HttpOnly Cookie。Node 校验会话后注入独立的 copyparty 凭据，浏览器会话 Cookie 无须传给后端 |
| 监听 | Windows IPv4/IPv6 TCP 表显示后端端口只绑定 `127.0.0.1`。Debian WSL2（镜像网络）通过回环能收到后端认证拒绝，通过 Windows 的 WLAN 地址无法建立 TCP 连接。回环对照只确认后端在运行，独立物理设备通过 WLAN 的验证并入 007 |
| 文件操作 | Edge 列出样本文件，并在浏览器请求中创建含中文和空格的目录、上传及下载文件、重命名和删除。下载与源文件的 SHA-256 相同 |
| 预览 | Edge 成功解码 PNG、显示 TXT，WebM 播放进度实际推进 |
| 进程重启 | 单独停止后端后连接失败；使用同一配置重新启动，原会话可列出和下载样本，匿名访问继续拒绝 |
| 自启方式 | 临时 Windows 任务配置为当前用户登录时触发。手动启动该任务，从回环地址读取后端样本成功，随后注销该任务。整机重启后自动恢复由 007 验收 |

**结论**：最小集成通过，计划 004 继续采用 copyparty。计划 003 实现正式登录，004 验证全盘文件操作和大文件续传，007 验证开机恢复和公网行为。

## 复现

在 Windows 的 `tools/plan-002` 目录运行下列命令。需要 Node.js、Windows Python 启动器和 Microsoft Edge。脚本临时生成凭据和样本，运行结束后关闭测试进程并清理样本。

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install copyparty==1.20.27
npm.cmd ci
npm.cmd test
```

有 Debian WSL2 和可用 WLAN 接口时，可额外复测虚拟设备探测。将 `PLAN002_LAN_IP` 设置为当前 Windows WLAN 的 IPv4 地址，再运行 `npm.cmd test`。脚本入口见 [verify.mjs](../../../tools/plan-002/verify.mjs)，本地代理见 [proxy.mjs](../../../tools/plan-002/proxy.mjs)。

Fastify 默认未注册 WebDAV 的 `MKCOL` 和 `MOVE`。验证代理显式注册两个方法后，目录创建和重命名均通过。验证脚本为两个服务选择高位端口，避开浏览器限制的端口，并把 copyparty 运行数据写入临时目录。Windows 任务计划程序的验证方式是以当前用户注册「登录时」触发的临时任务，操作使用相同 Python 可执行文件及启动参数，然后按需运行，验证后停止并注销。参考 [Fastify 代理](https://github.com/fastify/fastify-http-proxy) 和 [copyparty Windows 指引](https://github.com/9001/copyparty/blob/hovudstraum/docs/examples/windows.md)。
