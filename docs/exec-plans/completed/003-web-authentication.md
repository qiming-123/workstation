# 执行计划 003：Web 服务与单用户认证

- 状态：已完成（2026-11-23）
- 前置：计划 002 给出文件后端结论与认证边界
- 目标：在 Windows 主机提供首版 Web 入口、登录页和各模块共用的会话校验。
- 依据：[SPEC §4.4、§8](../../../SPEC.md)、[系统架构 §2–§3](../../../ARCHITECTURE.md)、[UI 设计语言](../../design-docs/ui-design-language.md)

## 步骤

- [x] 从本地配置加载单用户密码哈希和签名密钥，入口仅绑定 Windows 回环地址。提供不含凭据的配置示例。
- [x] 实现签名 HttpOnly Cookie、会话过期、退出撤销和连续登录失败限制。验证错密、缺失会话、过期及篡改的 Cookie。
- [x] 对文件代理、设置、预设执行和远程桌面入口使用同一会话校验，并校验浏览器请求来源。
- [x] 在 Edge 桌面和 390 px 窄屏实测登录、刷新、导航、会话过期和退出跳转。从独立测试配置启动真实入口，登录并到达文件页。

## 完成标准

Windows 主机可从配置启动真实站点；桌面和手机尺寸可用同一登录流程；应用功能服务可使用同一个认证边界。后续各计划接入实际功能后复测未登录的直达请求。

## 本地启动

使用 Node.js 24，在工作区根目录执行：

```powershell
npm.cmd ci
$workstationAccount = Read-Host '输入 workstation 账号'
npm.cmd run init -- $workstationAccount
npm.cmd start
```

初始化命令只创建新配置，屏幕上显示一次生成的密码。默认地址为 `http://127.0.0.1:32100`。需要更换地址时，同时配置 Web 端口和浏览器使用的 `publicOrigin`。应用凭据保存在本地 [配置示例](../../../config.example.json) 对应的文件中。文件服务需要单独启动。[计划 004 启动步骤](004-file-management.md)

复测命令为 `node --test test/auth.test.mjs test/browser.test.mjs`。浏览器测试使用 Windows 上安装的 Microsoft Edge。
