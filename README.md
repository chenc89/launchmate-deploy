# Launchmate 本地分享 Skill

把本地网页、后端 API 或带数据库的应用生成临时公网链接，发给朋友或客户确认。

Share local web apps and APIs through temporary public links. Keep your app and database running on your own computer.

## 能做什么

- 分享静态 HTML、已有 dist 目录、正在运行的 HTTP 应用或纯 API。
- 前后端分端口时，通过同一个公网入口访问；适配已选端口的 localhost 请求。
- 支持表单、Cookie、应用登录、文件上传下载；数据仍由原应用保存。
- 可选预览密码，查询分享状态，复用健康链接，按 ID 停止分享。
- 分享时不修改原项目源码、配置或构建产物。

## 安装 Skill

需要能读取 Skill 并执行本地终端命令的 AI 编程工具。先下载 [最新安装包](https://github.com/chenc89/launchmate-deploy/releases/latest)，解压后把整个 `launchmate-deploy` 文件夹放入对应位置：

| 工具 | 用户级安装目录 |
| --- | --- |
| Codex | `~/.codex/skills/launchmate-deploy/` |
| Claude Code | `~/.claude/skills/launchmate-deploy/` |
| Cursor | `~/.cursor/skills/launchmate-deploy/` |
| Gemini CLI | `~/.gemini/skills/launchmate-deploy/` |

`~` 是当前用户的主目录。保留 `scripts/`、`references/` 等全部文件，然后新开会话，在你的项目中说：

> 使用 launchmate-deploy 分享当前完整应用给朋友，不修改原项目代码。

名称保留为 `launchmate-deploy`，当前功能仅为本地应用分享。其他工具按其 Skill 安装目录放置；普通网页聊天窗口不一定能操作本机项目。

也可直接把本仓库克隆到上述 Skill 目录，仓库已包含可运行的 CLI，无需安装 npm 依赖。

## 运行条件

- Node.js 18.17 或更新版本。
- [官方 cloudflared 客户端](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)。安装包不包含该客户端。
- 带后端或数据库的应用须先在本机正常运行。

不确定环境是否就绪时，让 AI 运行 `share-doctor`；客户端不在 PATH 中时可用 `--cloudflared` 指定其可信路径。

## 直接使用 CLI

```sh
git clone https://github.com/chenc89/launchmate-deploy.git
cd launchmate-deploy
node scripts/cli/bin/launchmate.js share-doctor

# 分享自带静态示例。
node scripts/cli/bin/launchmate.js share --dir examples/hello --protected

# 分享正在运行的应用。
node scripts/cli/bin/launchmate.js share --url http://127.0.0.1:5173/ --protected

# 前后端分别运行。
node scripts/cli/bin/launchmate.js share --url http://127.0.0.1:5173/ --api-url http://127.0.0.1:8000/ --api-check-path /api/health --protected

# 纯 API，指定真实健康路径。
node scripts/cli/bin/launchmate.js share --url http://127.0.0.1:8000/ --check-path /health --protected

node scripts/cli/bin/launchmate.js share-status
node scripts/cli/bin/launchmate.js share-stop --id SHARE_ID
```

收到 `verified:true` 与公网 URL 后再交付链接。命令保持运行是正常状态；Ctrl+C 或 `share-stop` 结束本次分享。

`--protected` 自动生成密码并保存到返回的私有 `password_file`。需要固定密码时，通过自己的私有环境提供 `LAUNCHMATE_SHARE_PASSWORD`（12–256 字节），不要放进网址、命令参数或被分享目录。

## 适用范围

当前覆盖普通 HTTP 页面、fetch / XHR、表单与上传下载。前后端端口由 AI 根据当前项目配置和进程归属确认，CLI 只转发明确选中的目标。CSP 不兼容或目标端口未选中时明确失败。

链接依赖电脑、网络、原应用和分享进程持续运行，重新创建通道可能换网址。WebSocket / HMR、SSE、Worker / Service Worker、OAuth 固定回调等尚未通用适配，不能保证任意框架直接可用。

预览密码与应用账号独立。选择普通应用入口，应用自身负责登录和数据权限。HTTP 连通检查不代表业务验收，仍需检查实际登录、数据读写和文件操作。

完整使用细节见 [SKILL.md](SKILL.md) 和 [公网访问说明](references/public-access.md)。

## 开发与打包

```sh
npm run check
npm test
npm run package:skill -- --out dist/Launchmate-local-share-skill-v0.6.0.zip
```

测试使用隔离的本机服务，覆盖路径限制、密码保护、前后端路由、URL 适配、分享复用、停止与离线安装包。依赖 Unix 信号、可执行脚本或符号链接权限的用例在 Windows 上跳过。没有 npm 运行时依赖。

打包只包含 Skill 和运行代码，不包含开发测试、工作文件或私有配置；已有 ZIP 不会被覆盖。

## 许可证

[MIT](LICENSE)：允许商用、修改和分发，需保留版权与许可声明。cloudflared 及其通道服务遵循各自的许可与服务条款。
