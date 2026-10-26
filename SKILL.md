---
name: launchmate-deploy
description: "为本地网页、后端 API 或带数据库的应用生成临时公网链接，供朋友或客户确认。识别项目端口并适配 localhost 请求，无需修改项目文件；支持预览密码、查询与停止分享。"
---

# Launchmate 本地分享

使用 Skill 自带 CLI，交付经过验证的访问网址。直接用 Node 运行本 Skill 目录下的 `scripts/cli/bin/launchmate.js`，无需全局安装。

用户要求把本地项目发给朋友或客户确认时，执行分享；只询问用法、检查项目或引用 Skill 时，保持只读。

## 独立分享

首次使用或启动失败时先运行 `share-doctor`，按 [独立分享与公网访问](references/public-access.md) 处理缺少的 Node / 官方 cloudflared。自动读取当前项目的启动、代理和接口配置，优先复用已知启动会话；核对候选端口的进程工作目录或启动入口属于该项目后，再向 CLI 传入确定地址。源码中的 localhost 只是线索，不能据此公开无关服务；归属有歧义时只询问缺少的目标信息。

HTML / dist 用 `--dir`，已运行 HTTP 应用或 API 用 `--url`。页面与接口已有统一入口时复用该入口，分端口时加 `--api-url`。不把整仓源码当静态目录，不为分享修改项目文件或重新构建。

```sh
node "Skill目录/scripts/cli/bin/launchmate.js" share --dir "页面目录"
node "Skill目录/scripts/cli/bin/launchmate.js" share --url http://127.0.0.1:5173/
node "Skill目录/scripts/cli/bin/launchmate.js" share --dir "dist目录" --api-url http://127.0.0.1:8000/ --protected
```

`--dir` / `--url` 二选一。纯 API 用实际 `--check-path /health`；双端口默认把 `/api` 路由到后端，按真实路由设置 `--api-prefix` / `--api-check-path`。CLI 只转发已选定的前后端地址，不自动扫描或开放其他本机端口。

代理默认注入同源浏览器适配，转换普通 HTTP fetch / XHR 中已选端口的 localhost、127.0.0.1 和 [::1] 地址，包括动态拼接的地址；静态 HTML URL 属性按同一映射处理。JS 和业务 JSON 保持原字节，原项目文件保持不变。未选端口明确报错；CSP 拒绝适配脚本或同源连接时报告不兼容，不能移除或放宽策略。具体适用范围见 [公网访问](references/public-access.md)。

保持前台会话，收到 `verified:true` 与公网 URL 后验收；进程仍在运行是正常状态。同配置再次执行会重新检查本机与公网入口，通过后复用活跃链接；失败时不交付旧网址。用 `share-status` 找本次 ID，用户结束分享时用 `share-stop --id 分享ID`，只撤销本次代理和通道，不结束原应用或数据库。

用户要求私密确认时加 `--protected`。自动密码保存在返回的 `password_file` 私有文件；把可点击文件路径交给分享者，不读取到日志或最终回复，也不声称密码已发给客户。需要固定密码时复用可信环境 `LAUNCHMATE_SHARE_PASSWORD`，不能从应用源码读取。预览密码和应用账号是两层独立验证，后者仍由应用负责。

## 验收与交付

核对返回的 `url`，本机、回环或内网地址不能当作可分享网址。请求最终网址和关键资源；`verification.http=passed` 只代表连通检查，`business=not_checked` 不代表登录或数据库已验收。

带数据库应用用独立测试账号验证登录、写入读取、上传下载、退出重登和用户隔离。保留原数据；需要重启时只操作明确由本次持有的测试服务。适配失败时报告具体原因，不改写原项目来掩盖问题。

成功直接给可点击网址和已验证内容；失败给具体原因及缺少的信息。仅说明影响使用的限制，例如电脑和原应用需持续运行；省略内部过程、完整 JSON 与无关提示。
