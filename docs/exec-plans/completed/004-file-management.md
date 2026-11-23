# 执行计划 004：文件管理、预览与续传

- 状态：已完成（2026-11-23）
- 前置：计划 002 确定文件后端，计划 003 提供 Web 入口和认证
- 目标：完成桌面和手机浏览器的文件功能，验证数 GB 文件传输可中断恢复。
- 依据：[SPEC §4.1、§6、§8](../../../SPEC.md)、[技术方案 §4](../../design-docs/tech-stack.md)、[Web Demo](../../../demos/index.html)

## 步骤

- [x] 接入 003 的认证入口，挂载 Windows 就绪盘符，提供浏览和文件增删改传。以两个测试卷验证根目录导航、名称冲突、中文和含空格名称、只读卷写入拒绝及未登录直达拒绝。
- [x] 在 Edge 验证 PNG、TXT、WebM 预览和视频跳转。断开的预览链接显示错误；未经会话的预览请求被拒绝。
- [x] 经应用入口上传和下载 2 GiB 样本，分别主动中断后恢复，核对大小和 SHA-256。
- [x] 在 390 像素的触屏模拟浏览器选择并上传文件，核对 Windows 端内容和位置；同步两份手册。实际手机经公网访问由 007 验收。

## 完成标准

经认证的本机服务通过文件操作、三类预览、窄屏上传和数 GB 双向续传测试。实际手机从外网访问和上传，以及公网吞吐与中断恢复，由 007 做最终验收。

## Windows 本地使用

先按[计划 003 的启动步骤](003-web-authentication.md)初始化配置。用另一个 PowerShell 窗口启动文件服务：

```powershell
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install copyparty==1.20.27
.\tools\start-files.ps1 -Python .\.venv\Scripts\python.exe
```

登录后打开「文件」并选择目标磁盘。文件服务只监听回环地址，由 Web 服务校验会话后代理。启动脚本挂载 Windows 就绪盘符；测试命令改用隔离样本目录。

## 续传实测

Edge 的 Up2k 上传在已有 192,937,984 字节写入后中断，重新选中原文件时继续上传剩余内容。下载从第 67,163,080 字节用 HTTP Range 和 If-Range 恢复。源文件、主机文件和下载的完整字节流均为 2,147,483,648 字节，SHA-256 为 `8b32f6823aa25163b57e7b0b5e2a0cef796e1ee19e45f05528b446cb97b3549e`。

复现命令使用已安装 copyparty 的 Python；完整测试需要能容纳两份 2 GiB 样本的磁盘空间：

```powershell
$env:WORKSTATION_FILES_PYTHON = (Resolve-Path .\.venv\Scripts\python.exe).Path
$env:WORKSTATION_FILES_TEST = '1'
$env:WORKSTATION_FILES_LARGE_TEST = '1'
node --test test/files.integration.test.mjs
```
