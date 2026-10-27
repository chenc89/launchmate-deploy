# Launchmate 本地分享 Skill

**把你电脑上做好的网页或应用，变成朋友、客户能直接打开的临时链接。**

在 AI 编程工具中说一句话，让它检查项目、连接公网并验证链接。前端、后端和数据库继续在你的电脑上运行，分享时不修改项目文件。

Share local web apps and APIs through temporary public links, without editing your project files.

[开始安装](#1-安装-skill只需一次) · [下载安装包](https://github.com/chenc89/launchmate-deploy/releases/latest) · [分享自己的项目](#2-打开自己的项目发起分享) · [命令与排错](docs/usage.md)

## 从视频过来？按这三步开始

### 1. 安装 Skill（只需一次）

打开**能读取本机项目、执行终端命令的 AI 编程工具**，如 Codex、Claude Code、Cursor 或 Gemini CLI。把下面整段复制给它：

```text
帮我安装 launchmate-deploy Skill：
https://github.com/chenc89/launchmate-deploy

Skill 位于仓库根目录。请保留 scripts/、references/ 等配套文件，
安装到当前工具支持的用户级 Skill 目录；已有同名版本时先检查，不覆盖我的修改。
安装后检查 Node.js 和官方 cloudflared 是否可用，告诉我是否已准备好分享。
```

使用 Codex 时，可以在这段话前加上 `$skill-installer`。

**安装完成的标志：** AI 能找到 `launchmate-deploy`，并确认 Node.js、cloudflared 均可用。缺少依赖或想手动安装，按 [安装教程](docs/install.md) 操作。普通网页聊天窗口无法直接读取你电脑上的项目。

### 2. 打开自己的项目，发起分享

在 AI 工具中打开**你要分享的项目文件夹**，开始一条新消息。带后端或数据库的应用，先确认本机已经能正常打开和使用；还没运行时，先让 AI 按该项目的说明协助启动。

复制下面这段话：

```text
使用 launchmate-deploy，把当前项目分享给朋友体验。
先检查本机页面和接口，确认前后端端口属于当前项目。
不修改项目文件，保留现有数据，开启预览密码。
公网检查通过后，给我可点击的分享链接、密码文件位置和停止分享的方法。
```

AI 会根据项目选择静态目录或正在运行的应用；前后端分端口时配置同一个分享入口。**不用自己把源码里的 localhost 改成公网域名。**

### 3. 用另一台设备确认，再发给别人

拿到 `https://…trycloudflare.com/` 形式的链接后：

1. 用手机移动网络打开，输入密码文件中的预览密码。
2. 检查页面、图片和项目用到的音视频能否正常显示或播放。
3. 有后端或数据库时，用测试账号登录，新增一条测试数据，刷新后确认仍能读取；有上传功能再试一次上传。
4. 把确认可用的链接和预览密码，通过自己的渠道发给朋友或客户。

**电脑、原应用和分享进程要保持运行。** 关闭分享后链接失效，重新创建分享可能更换网址。

## 你的项目属于哪种？

| 项目类型 | 分享前准备 | 可以补充给 AI 的话 |
| --- | --- | --- |
| HTML 页面、已有 `dist` | 目录里有 `index.html` 和所需资源 | “分享这个页面目录。” |
| React / Vue / Vite 等网页 | 本机页面已经正常运行 | “分享当前运行的网页，检查图片和接口。” |
| 前端 + 独立后端 | 两个服务都已运行 | “把前后端一起分享，确认接口实际可用。” |
| 带 MySQL / PostgreSQL 等数据库的应用 | 原应用能连上数据库并读写 | “沿用现有数据库，用测试账号验收读写。” |
| 纯后端 API | 服务已运行，有可访问的检查路径 | “分享这个 API，检查路径是项目现有的 `/health`。” |

数据库由原应用连接，**不需要把数据库端口开放给访客**。访客进行的保存、修改等操作会作用于原应用的数据，请用合适的测试账号与数据演示。项目没有 `/health` 时，提供它真实存在的检查路径。

## 分享之后怎么用？

直接在原来的 AI 会话中说：

| 想做什么 | 发给 AI 的话 |
| --- | --- |
| 查看链接和状态 | “用 launchmate-deploy 查看当前项目的分享状态。” |
| 更新后继续给对方看 | “检查当前分享是否仍可用，通过后复用原链接。” |
| 结束分享 | “停止当前项目的这次分享，保留原应用和数据库。” |
| 页面能开，功能不正常 | “检查这个分享的失败请求和实际后端路由，不修改项目文件。” |

原应用按平时的方式更新，访客手动刷新；已有静态目录中的文件修改后刷新生效。Skill 不负责构建或发布新版本。

## 卡住了，先看这里

| 现象 | 下一步 |
| --- | --- |
| AI 说找不到 Skill | 检查安装目录和文件夹层级，按 [安装确认](docs/install.md#3-确认安装成功) 操作 |
| 提示缺少 Node.js / cloudflared | 按 [依赖安装](docs/install.md#2-准备-nodejs-和-cloudflared) 操作 |
| 只给了 `localhost` / `127.0.0.1` 链接 | 尚未完成公网分享，让 AI 执行分享并等到公网检查通过 |
| 找到网址，但别人打不开 | 检查电脑、原应用和分享进程是否仍在运行；见 [排错表](docs/usage.md#常见问题) |
| 页面能打开，登录、保存失败 | 核对后端端口、实际接口前缀与检查路径；见 [前后端示例](docs/usage.md#前后端分别运行) |

仍未解决时，可以让 AI 按 [反馈模板](docs/usage.md#反馈问题) 整理信息，再提交 [GitHub Issue](https://github.com/chenc89/launchmate-deploy/issues/new)。不要提交密码、令牌或私有配置。

## 使用范围

- 覆盖静态页面、普通 HTTP 应用、fetch / XHR、表单和文件上传下载。前后端地址由 AI 核对，CLI 只转发明确选中的目标。
- 支持可选预览密码；预览密码和应用账号分别验证。HTTP 检查通过后，仍需实际验证项目的登录、保存等功能。
- WebSocket / HMR、SSE、Worker / Service Worker、OAuth 固定回调等尚未通用适配；严格 CSP 也可能阻止地址适配，详见 [适用边界](docs/usage.md#适用边界)。
- 使用 Cloudflare Quick Tunnel 生成临时网址，无需购买服务器或域名、登录 Cloudflare；通道受服务方限制与网络可用性影响，适合临时演示和确认。[Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## 手动命令与开发

想直接运行命令？见 [CLI 使用教程](docs/usage.md)。完整执行规则见 [SKILL.md](SKILL.md)，代理与地址适配细节见 [公网访问说明](references/public-access.md)。

```sh
npm run check
npm test
npm run package:skill -- --out dist/Launchmate-local-share-skill-v0.6.0.zip
```

无需安装 npm 依赖。测试使用隔离的本机服务；依赖 Unix 信号、可执行脚本或符号链接权限的用例在 Windows 上跳过。打包仅包含 Skill 和运行代码，已有 ZIP 不会被覆盖。

## 许可证

[MIT](LICENSE)：允许商用、修改和分发，需保留版权与许可声明。cloudflared 及其通道服务遵循各自的许可与服务条款。
