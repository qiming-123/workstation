# 开源仓库调研（2026-11-23）

技术方案定稿后（见 [tech-stack.md](tech-stack.md)），在 GitHub 上检索与 workstation 各模块对应的成熟开源项目，评估「直接用 / 参考实现 / 不用」。星数与活跃度为 2026-11-23 当日数据；许可证未逐一核对，引入前需确认。

## 检索结果

| 仓库 | 星数 | 语言 | 状态 | 与本项目的关系 |
|---|---|---|---|---|
| [9001/copyparty](https://github.com/9001/copyparty) | 47.4k | Python | 活跃 | 便携文件服务器：断点续传上传、去重、WebDAV/SFTP/FTP、媒体索引、缩略图 |
| [9001/party-up](https://github.com/9001/party-up) | 196 | Java | 活跃 | copyparty 的 Android 客户端，对应后续阶段「手机传文件」 |
| [filebrowser/filebrowser](https://github.com/filebrowser/filebrowser) | 35.8k | Go | **已归档** | Web 文件管理器（上传/删除/预览/编辑），功能与文件模块高度重叠 |
| [gtsteffaniak/filebrowser](https://github.com/gtsteffaniak/filebrowser) | 9.3k | Go | 活跃 | 上者的社区延续 fork |
| [sigoden/dufs](https://github.com/sigoden/dufs) | 11.2k | Rust | 活跃 | 轻量文件服务器：静态服务/上传/搜索/访问控制/WebDAV |
| [transloadit/uppy](https://github.com/transloadit/uppy) | 31.1k | TypeScript | 活跃 | 前端上传库，内置 tus 断点续传客户端，可无构建引入 |
| [tus/tus-node-server](https://github.com/tus/tus-node-server) | 1.1k | TypeScript | 活跃（2026-11 更新） | Node tus 服务端，可独立运行或嵌入任意框架，支持磁盘存储 |
| [tus/tusd](https://github.com/tus/tusd) | 3.9k | Go | 活跃 | tus 协议参考服务端，独立二进制 |
| [Ylianst/MeshCentral](https://github.com/Ylianst/MeshCentral) | 7.7k | JavaScript | 活跃 | Node.js 写的网页远程管理平台：远程桌面+文件传输+远程命令 |
| [rustdesk/rustdesk](https://github.com/rustdesk/rustdesk) + [rustdesk-server](https://github.com/rustdesk/rustdesk-server) | 130.9k / 10.8k | Rust | 活跃 | 开源自托管远程桌面（TeamViewer 替代） |

（另见 ankitpokhrel/tus-php 1.5k★、Ylianst/MeshCentralAndroidAgent 71★，与本项目技术栈不符，仅记录。）

## 逐模块评估

### 1. 断点续传上传（已定方向：tus 协议）

- **tus-node-server**：直接消除 tech-stack.md 待验证清单第 2 项的「存在性」疑问——官方 Node 实现存在、TypeScript、声明可嵌入任意框架、支持磁盘存储。与 Fastify 的具体集成方式（中间件/独立子路径）仍需实施前实测，保留在待验证清单。
- **uppy**：前端对应件，官方 tus 客户端。提供打包好的 standalone 版本，符合「前端原生无构建」约定。上传 UI 需按 ui-design-language.md 重新定制皮肤。
- **tusd**：备选——若 Node 集成不顺，可让 Go 二进制独立跑在主机，由 frp 分流一个端口。代价是多一个进程和多语言运维。
- 推荐组合：**uppy（前端）+ tus-node-server（Fastify 内嵌）**，tusd 作为兜底。

### 2. 文件管理（浏览/上传/重命名/删除/预览）

- **copyparty**：功能几乎全覆盖甚至超出（含断点续传与媒体预览），但它是 **Python 单文件应用**，与已定 Node.js 栈冲突。两个选项见下方「待用户决策」。
- **filebrowser**：官方仓已归档，活跃 fork（gtsteffaniak/filebrowser）是 Go 单二进制，可作为文件模块的**参考实现**（其 API 划分、预览处理方式），也可独立部署与 Node 并存——但同样引入第二语言。
- **dufs**：Rust，偏「文件服务」而非「文件管理」（无重命名等管理操作），不直接匹配需求。

### 3. 连接电脑（远程桌面）

- 已定方案是「登录后按需下载 .rdp」，不自研网页远程桌面，因此 **rustdesk / MeshCentral 均不引入**。
- **MeshCentral** 值得注意：它是 Node.js，覆盖远程桌面+文件传输+远程命令，功能与我们重叠度最高。若未来「.rdp 下载」体验不够好、想升级为浏览器内远程桌面，MeshCentral 是首选参考实现（其网页远程桌面的协议与渲染做法）。当前仅记录，不行动。

### 4. 连接应用（预设动作白名单）

- 没有找到通用开源方案（各家的「预设命令」都是自家实现，如 filebrowser 的命令钩子、copyparty 的事件钩子）。按 tech-stack.md 既定：白名单配置 + 后端执行，不引用外部库。vscode:// WSL 深链格式仍在待验证清单。

### 5. 后续阶段：Android 传文件

- **party-up**（copyparty 官方 Android 客户端，Java）是现成参考；若届时文件后端仍走 tus，则需找 tus 的 Android 客户端库再评估。记录备查，当前不行动。

## 决策结果：混合架构（方案 B）

2026-11-23 用户选定 **方案 B：copyparty 作为文件后端跑在主机（Python 进程），Node 层做认证、预设动作、RDP 分发和界面壳**，并明确附加前提「以运行正常为基础」——实施时先做最小集成验证（认证打通 + 上传/下载/预览），不达标则回退方案 A（Node 全栈 + uppy + tus-node-server），回退只影响文件模块。

此决策不影响已定的 frp 隧道、认证方式与 RDP 方案。详见 [tech-stack.md](tech-stack.md) §1 #8 与 §2。

## 来源

各仓库数据来自 2026-11-23 的 GitHub 仓库搜索，链接见上表。
