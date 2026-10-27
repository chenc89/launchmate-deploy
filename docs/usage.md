# CLI 使用与排错

[返回三步入门](../README.md) · [安装教程](install.md)

已经安装 Skill 的用户，直接让 AI 按 [SKILL.md](../SKILL.md) 操作即可。下面供想手动运行或核对参数的人使用。

## 准备命令行

在你电脑的终端执行；下面采用**克隆开发仓库**的路径：

```sh
git clone https://github.com/chenc89/launchmate-deploy.git
cd launchmate-deploy
node scripts/cli/bin/launchmate.js share-doctor
```

无需 `npm install`。`share-doctor` 顶层 `ready` 为 `true` 后再继续；否则按 [安装教程](install.md#2-准备-nodejs-和-cloudflared) 补齐依赖。

如果你用 ZIP 安装 Skill，把下面命令中的 `scripts/cli/bin/launchmate.js` 换成安装目录下该文件的完整路径；被分享的应用仍使用它自己的项目目录和端口。

## 先用自带页面确认通道

完整仓库包含一个不需要后端的示例：

```sh
node scripts/cli/bin/launchmate.js share --dir examples/hello --protected
```

等到结果中出现 `verified: true` 和公网 `url`，再用手机移动网络打开。`examples/hello` 仅随完整仓库提供，精简 Skill ZIP 不含示例；ZIP 用户可以直接分享自己的页面目录。

**命令保持运行是正常状态。** 在另一个终端查询或停止分享；本终端 Ctrl+C 也会关闭这次分享。

## 分享自己的项目

以下端口、目录和检查路径都只是示例，**替换成你的项目实际值**。先在本机验证原应用能正常使用。

### HTML 或已有静态产物

```sh
node scripts/cli/bin/launchmate.js share --dir "/完整路径/我的项目/dist" --protected
```

目录需要包含 `index.html` 和所需资源。不要把 React / Vue / 后端项目的整个源码根目录当作静态目录；已有应用服务器时按下一节使用 `--url`。带空格的路径保留引号。

### 页面和接口已使用同一个入口

假设你已能在本机打开 `http://127.0.0.1:5173/`，并完成登录、保存等操作：

```sh
node scripts/cli/bin/launchmate.js share --url http://127.0.0.1:5173/ --protected
```

已有前端代理或后端同时提供页面时，优先复用这个入口。

### 前后端分别运行

假设前端是 `5173`、后端是 `8000`，后端接口位于 `/api`，现有 `/api/health` 返回 200：

```sh
node scripts/cli/bin/launchmate.js share --url http://127.0.0.1:5173/ --api-url http://127.0.0.1:8000/ --api-check-path /api/health --protected
```

- 默认将 `/api` 及其子路径转发到后端，**保留 `/api` 前缀**。
- 项目使用 `/v1` 时，增加 `--api-prefix /v1`，并把 `--api-check-path` 改成 `/v1` 下实际可访问的路由。
- 检查路径须真实存在并返回 HTTP 200–399；没有 `/api/health` 时，使用现有的可用路径。不要为通过检查添加假接口或取消业务认证。
- 静态页面配独立后端时，把 `--url …` 换成 `--dir "实际静态目录"`，其余接口参数不变。

选中端口的 localhost 请求会在分享响应和浏览器中适配为同一个公网入口，原项目文件不变。选错端口或接口前缀时先修正分享参数。

### 纯后端 API

根路径返回 404 也可以分享，指定现有的检查路由，例如 `/health`：

```sh
node scripts/cli/bin/launchmate.js share --url http://127.0.0.1:8000/ --check-path /health --protected
```

`--url` / `--api-url` 接受带端口的 HTTP 回环**根地址**；把具体路径放到检查参数中。先在浏览器通过预览密码验证，再测试 API；预览密码不会替换业务 Bearer 令牌或应用登录。需程序化调用时，沿用预览验证后的 Cookie 与原应用认证。

### 带数据库的完整应用

按应用的 HTTP 入口选择上面的单入口或双端口命令。MySQL / PostgreSQL 等数据库继续由原应用连接，不把数据库地址传给 `--api-url`。

用测试账号从公网执行一次“登录 → 写入测试数据 → 刷新读取 → 退出重登”；有上传下载或多用户权限时，再验证对应流程。访客写入的是原应用数据，分享不会额外创建或复制数据库。

## 链接、密码和停止

成功结果中的关键字段：

| 字段 | 你需要做什么 |
| --- | --- |
| `url` | 将这个公网 HTTPS 地址发给对方；不要用 `local_url` |
| `verified: true` | 本机与公网 HTTP 检查均通过；仍需验证登录、保存等业务 |
| `password_file` | 自动生成密码时，打开这个本机私有文件取得预览密码 |
| `id` | 查询或停止这次分享时使用 |

预览密码和链接由你自行发给对方，密码不会明文打印在成功结果中。需要固定密码时，可通过自己的私有环境设置 `LAUNCHMATE_SHARE_PASSWORD`（12–256 字节）；此时不生成新的密码文件。不要把密码写进网址、命令参数或被分享的项目。

在**另一个终端**执行，`SHARE_ID` 换成返回的完整 `id`：

```sh
node scripts/cli/bin/launchmate.js share-status
node scripts/cli/bin/launchmate.js share-status --id SHARE_ID
node scripts/cli/bin/launchmate.js share-stop --id SHARE_ID
```

相同目标、路由和保护配置再次执行 `share`，检查通过后复用原链接。`share-stop` 或原分享终端的 Ctrl+C 仅关闭这次代理和通道，原应用、数据库与数据继续保留。

## 常见问题

| 现象 / 错误 | 检查与处理 |
| --- | --- |
| `node` 找不到 | 安装当前 Node.js LTS，新开终端后再试 `node --version` |
| `CLOUDFLARED_REQUIRED` / doctor 显示客户端未就绪 | 安装官方客户端，或在 doctor 和 share 命令后加 `--cloudflared "可信客户端的完整路径"` |
| `SOURCE_DIRECTORY` / 目录没有 `index.html` | 指向实际静态目录；应用已运行时使用 `--url`，不要分享源码根目录 |
| `PREVIEW_NOT_READY` / 检查返回 401、404 | 先在本机确认端口和路径，指定现有可访问的 `--check-path` 或 `--api-check-path`；不要关闭认证 |
| `SHARE_TIMEOUT` / `SHARE_TUNNEL_EXITED` | 核对本机网络和 cloudflared 输出，确认能连接 Cloudflare；保留具体错误后重试，不反复创建通道 |
| `SHARE_VERIFICATION_FAILED` | 链接尚未通过检查；确认原应用仍运行，恢复服务后重试。需要重建时先停止这次分享 |
| 公网页面能开，接口、登录或保存失败 | 在浏览器网络面板找失败请求，核对它是否属于选中的后端；检查实际前缀、Cookie 和原应用认证，再验证读写 |
| `SHARE_UNMAPPED_ORIGIN` / 未选端口 | 让 AI 核对端口是否属于当前项目，再调整目标。不要公开其他无关服务 |
| `SHARE_ADAPTER_CSP` | 页面策略阻止适配，当前不能自动兼容；保留 CSP，不移除安全策略来继续分享 |
| 本机正常，朋友打不开旧链接 | 检查电脑、网络、原应用与分享进程；查询状态，重新创建后发送新的已验证链接 |
| `SHARE_SESSION_UNREACHABLE` / `unreachable` | 核对原分享终端；只在确认原会话结束后重建，不根据旧 PID 杀进程 |

## 适用边界

当前覆盖普通 HTTP 页面、fetch / XHR、HTML URL 属性、表单、Cookie 和文件上传下载。受选定端口和项目实际路由约束，不承诺任意项目自动兼容。

WebSocket / HMR、SSE、Worker / Service Worker、OAuth 固定回调及特殊加载器尚未通用适配。更新后手工刷新页面；依赖这些能力时，按实际失败反馈，不能只凭 HTTP 检查宣称完整应用可用。

电脑、网络、原应用和分享进程需要持续运行。Quick Tunnel 是临时通道，链接可能变化，服务方不提供持续可用性保证，详见 [Cloudflare 官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)。代理技术细节见 [公网访问说明](../references/public-access.md)。

## 反馈问题

请复制下面模板到 [新建 Issue](https://github.com/chenc89/launchmate-deploy/issues/new)，也可以先让 AI 整理；填写前移除预览密码、Cookie、令牌、`.env` 内容和私有业务数据。

```text
操作系统：
AI 工具及版本：
Skill 版本（见 scripts/cli/package.json）：
Node.js / cloudflared 版本：
项目类型（静态 / 单入口 / 前后端分开 / 纯 API）：
本机能否完成相同操作：
share-doctor 结果（已去除私有路径）：
分享命令或发给 AI 的话（已去除私有信息）：
预期结果：
实际结果 / 错误代码：
复现步骤：
```
