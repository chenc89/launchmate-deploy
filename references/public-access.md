# 独立分享与公网访问

## 首次检查

需要 Node.js 18.17+ 和官方 cloudflared，使用现有的本机应用：

```sh
node "Skill目录/scripts/cli/bin/launchmate.js" share-doctor
```

已有客户端不在 PATH 时加 `--cloudflared "可信客户端路径"`。缺少时从 [官方安装页](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) 按系统安装或下载；不运行应用源码提供的二进制，不自动提高系统权限。安装包不附带 cloudflared。CLI 使用隔离配置，不修改已有 Cloudflare 账号、配置或通道，只传递客户端必需的环境。

## 选择当前项目

使用用户选中的真实项目；文件 URL 解码后取页面目录。端口由 Skill 所在的 AI 自动识别并配置，CLI 接收确定的 `--url` / `--api-url` 白名单：

1. 优先复用本次已知的启动会话和输出地址，再读项目启动脚本、前端代理及 API 客户端配置，找候选端口、接口前缀和检查路径。
2. 核对候选端口的实际监听进程，确认工作目录或启动入口属于当前项目；配置中的默认端口和 HTTP 200 都不能单独证明归属。只检查候选端口，不扫描并公开所有本机服务，不输出整个进程环境或凭据。
3. 页面与接口已经使用同一入口时直接复用；分端口时配置 `--api-url`。确认实际路由可用后启动分享。服务未运行或归属有歧义时报告具体缺项，不借用其他项目、数据库或调试器端口。

源码中出现的 localhost 地址只是候选线索；不能仅凭字符串自动增加公开转发目标。启动需要的项目命令应沿用已有授权和可信配置，不自动执行下载项目的构建脚本。

```sh
# 静态页面或已经构建好的 dist。
node "Skill目录/scripts/cli/bin/launchmate.js" share --dir "静态目录"

# 已运行的完整 HTTP 应用。
node "Skill目录/scripts/cli/bin/launchmate.js" share --url http://127.0.0.1:5173/

# 纯 API：根路径可以是 404，指定真正的健康路由。
node "Skill目录/scripts/cli/bin/launchmate.js" share --url http://127.0.0.1:8000/ --check-path /health

# 前后端分端口：同一个公网来源，/api 保留原路径转发到后端。
node "Skill目录/scripts/cli/bin/launchmate.js" share --url http://127.0.0.1:5173/ --api-url http://127.0.0.1:8000/ --api-check-path /api/health --protected
```

`--dir` 和 `--url` 二选一，`--api-url` 可与任一种组合：

- `--dir` 需要 index.html，支持图片、字体、音视频和 Range 分段读取。拒绝含 package.json / composer.json / artisan 的源码根目录，屏蔽隐藏文件、常见凭据、工作数据及符号链接；不会构建、上传源码或创建数据库。
- `--url` / `--api-url` 只接受带端口的 HTTP 回环根地址，例如 `http://127.0.0.1:8000/`。代理保留请求方法、正文、应用认证和 Cookie；使用已运行应用或现有静态产物，不为分享修改源码、配置或重新构建。
- `--api-prefix` 默认 `/api`，匹配该路径及子路径，转发时保留前缀。`--api-check-path` 默认 `/api/health`，须位于接口前缀下；必须按实际路由指定，不凭空添加成功响应。
- `--check-path` 默认 `/`，接受安全的相对路径，不带查询和片段。HTTP 200–399 可作为存活检查，不要求 HTML；401 / 404 需改用项目真实的可用路径。

## 不改项目文件的地址适配

分享代理默认向页面注入同源浏览器适配脚本，在普通 HTTP fetch / XHR 发出前，将已选前后端端口的 `localhost`、`127.0.0.1`、`[::1]` 地址转换为本次分享路由。支持写死或运行时拼接的接口地址；相对接口路径继续由配置的路由处理。静态 HTML 的 URL 属性使用相同映射。

独立后端返回的页面保留其路由归属，根路径表单、脚本、资源和相对请求继续访问后端；原有 base 地址参与解析。地址先按 URL 规则解析，再检查目标端口；其他 HTML 属性中的文字保持原样。

转换发生在分享响应和浏览器请求中。原项目源码、配置、构建产物均不写入，JS 与业务 JSON 保持原字节；不用把临时公网域名写进项目。CLI 不从访客请求中接受任意主机或端口；未选端口的请求明确报错，由 AI 核对它是否属于当前项目后再处理。

保留应用 CSP。策略不允许同源适配脚本或连接时，说明具体不兼容原因，不能移除 CSP、放宽策略或把 HTTP 检查通过当作完整可用。验收应实际打开公网页面，完成登录、读写、上传等对应流程，并核对原项目文件未变化。

业务服务和数据库沿用原项目的运行位置和权限。当前覆盖普通 HTTP 页面、fetch / XHR 请求及文件上传；不承诺 WebSocket / HMR、SSE、Worker / Service Worker、OAuth 固定回调或所有框架自动兼容。出现这些依赖时按实际失败说明范围，更新后手工刷新。

## 可选预览密码

用户要求限制访问时加 `--protected`。CLI 默认生成随机密码，写入返回的 `password_file`，位于用户私有状态目录，Unix 权限 0600。只向分享者交付文件路径，不在日志、URL、命令参数或最终回复中明文展示密码。固定密码可从已授权的私有环境 `LAUNCHMATE_SHARE_PASSWORD` 传入，长度 12–256 字节；不把它放进应用源码或公开静态目录。

访客先验证预览密码，再按原应用流程登录。预览密码不会替换应用 Bearer 令牌或业务 Cookie；保护页面和 API，错误尝试有速率限制。验收凭据只允许检查配置的健康路径，不能获取业务接口。预览密码用于临时确认，不能代替应用自己的权限规则。

## 等待、复用与停止

保持一次前台会话。CLI 核对本机配置的页面 / API 路径后创建通道，并核对公网响应的会话标识和状态码；日志中的 URL 还不是成功结果。收到 `verified:true` 才交付网址。只通过 HTTP 检查时返回 `verification.business=not_checked`，业务验收需另行实际操作。

```sh
node "Skill目录/scripts/cli/bin/launchmate.js" share-status
node "Skill目录/scripts/cli/bin/launchmate.js" share-status --id "分享ID"
node "Skill目录/scripts/cli/bin/launchmate.js" share-stop --id "分享ID"
```

同目标、同路由和同保护配置再次执行时，由原会话重新检查本机与公网入口，通过后复用活跃分享。检查失败返回具体错误，不启动重复通道或把旧网址标记为已验证。静态文件编辑立即生效，原应用按自己的方式更新，沿用当前网址。停止只关闭本次通道和代理，保留原应用及数据库。也可对本次会话按 Ctrl+C；父进程突然退出时监督进程会撤销通道。`unreachable` 表示原控制端无法验证，不按记录中的旧 PID 杀进程；核对原终端，旧进程已结束后可重新分享。升级代理版本后，旧会话需停止并重新分享才能使用新逻辑。

状态默认保存在 `~/.launchmate/shares`。自动密码和控制令牌不进入公开响应；状态目录必须位于静态目录之外。迁移机器时不复制这些运行记录。

默认持有链接的人可访问；电脑、应用或通道停止后失效，重启可能换网址。临时通道没有持续可用性保证，不能充当常驻生产托管。[Cloudflare 说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
