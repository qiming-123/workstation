# 执行计划 006：预设动作与 VS Code (WSL)

- 状态：本地功能已完成，等待计划 005 联调
- 前置：计划 003 的认证和页面框架；计划 005 的远程桌面入口用于最终回退联调
- 目标：支持配置并触发主机预设动作，以及在浏览器所在设备唤起 VS Code。
- 依据：[SPEC §4.2–§4.3、§6、§8](../../../SPEC.md)、[技术方案 §1、§4](../../design-docs/tech-stack.md)、[Web Demo](../../../demos/index.html)

## 步骤

- [x] 在「设置」页增删预设动作，由本地 JSON 持久化。验证重启回读、删除后刷新、并发保存和写入失败保留原配置。
- [x] 在「连接」页按已保存的预设标识触发主机动作。验证会话、来源、未知和已删除标识、禁止覆盖动作参数。Windows 上实际打开了预设指向的 Debian WSL 测试目录。
- [x] 在 Chrome 独立测试配置中点击「当前设备」的 VS Code 深链，确认目标 Debian WSL 目录实际打开。同步两份手册的设置、连接和 VS Code 步骤。
- [ ] 清空预设后已验证默认显示远程桌面入口。接入计划 005 后，从此入口下载 `.rdp` 并完成真实连接联调。

## 完成标准

登录用户可以配置、保存并触发预设动作；清空预设后默认进入远程桌面；在具备前提的客户端，点击 VS Code 入口可实际打开预期的 WSL 目标。

## 本地验证

- 主机动作使用主机配置的 `Code.exe`，参数来自已保存的预设。浏览器设备的链接直接交给本机协议处理器。两个路径分别用不同的 Debian 测试目录验证。
- 浏览器端到端实测使用 Chrome 临时独立配置，仅为本机测试来源预先允许 `vscode://`。用户平时可以在浏览器提示处确认打开。
- API 和持久化回归测试执行 `node --test test/connections.test.mjs`。VS Code 所需环境见 [WSL 使用文档](https://code.visualstudio.com/docs/remote/wsl)和[远程资源深链格式](https://code.visualstudio.com/docs/configure/command-line#_open-a-remote-resource)。
