# 安装教程

[返回首页](../README.md) · [CLI 使用与排错](usage.md)

安装包含两部分：把 Skill 放进 AI 工具的目录，再准备它运行时需要的 Node.js 和 cloudflared。**分享在项目所在的电脑上执行**；AI 必须能访问这台电脑的文件和终端。

## 1. 安装 Skill

### 让 AI 安装

复制 [首页的安装提示词](../README.md#1-安装-skill只需一次) 给你的 AI 编程工具。Codex 可以使用内置 `$skill-installer`，仓库内路径为 `.`，安装名称为 `launchmate-deploy`。

安装器不可用或想自己操作时，使用下面的下载方式。

### 下载后手动安装

1. 打开 [最新 Release](https://github.com/chenc89/launchmate-deploy/releases/latest)。
2. 在 **Assets** 下载名称为 `Launchmate-local-share-skill-v版本号.zip` 的安装包；`Source code` 是整个开发仓库，`SHA256SUMS.txt` 用于校验。
3. 解压后，把**整个 `launchmate-deploy` 文件夹**放进下表中你所用工具的目录；父目录不存在时可以创建。

| AI 工具 | macOS / Linux 用户级目录 | Windows 用户级目录 |
| --- | --- | --- |
| Codex | `~/.agents/skills/launchmate-deploy/` | `%USERPROFILE%\.agents\skills\launchmate-deploy\` |
| Claude Code | `~/.claude/skills/launchmate-deploy/` | `%USERPROFILE%\.claude\skills\launchmate-deploy\` |
| Cursor | `~/.cursor/skills/launchmate-deploy/` | `%USERPROFILE%\.cursor\skills\launchmate-deploy\` |
| Gemini CLI | `~/.gemini/skills/launchmate-deploy/` | `%USERPROFILE%\.gemini\skills\launchmate-deploy\` |

`~` 和 `%USERPROFILE%` 都表示当前用户的主目录。Mac 可以在 Finder 按 **⌘⇧G** 输入父目录，例如 `~/.agents/skills`；Windows 可以在资源管理器地址栏输入 `%USERPROFILE%\.agents\skills`。

Codex 的表格路径按 [当前官方文档](https://developers.openai.com/codex/skills/#where-to-save-skills) 编写。内置安装器或已有版本也可能使用 `~/.codex/skills/`（自定义 `CODEX_HOME` 时以实际目录为准）；已能被识别的安装可以继续使用，**只保留一份同名 Skill**。

放好之后，目录层级应该是：

```text
launchmate-deploy/
├── SKILL.md
├── LICENSE
├── agents/
│   └── openai.yaml
├── references/
│   └── public-access.md
└── scripts/
    └── cli/
        ├── package.json
        ├── LICENSE
        ├── bin/
        │   └── launchmate.js
        └── src/
```

不要只复制 `SKILL.md`，也不要多套一层 `launchmate-deploy/launchmate-deploy/`。不同工具的安装目录来自各自官方说明：[Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load)、[Cursor](https://cursor.com/docs/skills)、[Gemini CLI](https://geminicli.com/docs/cli/skills/)。目录支持不等于每个工具、版本、项目都已完成实机验证。

## 2. 准备 Node.js 和 cloudflared

先让 AI 检查现有环境，已经可用就直接跳过安装。

### Node.js

从 [Node.js 官网](https://nodejs.org/en/download) 选择当前 LTS，按操作系统安装。CLI 最低要求是 Node.js 18.17，但新安装建议使用当前受支持的 LTS。

安装后新开终端，运行：

```sh
node --version
```

出现 `v…` 版本号后，再检查 cloudflared。

### cloudflared

它负责把本机分享入口连接到 Cloudflare。按 [Cloudflare 官方安装页](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/) 选择你的系统：

| 系统 | 安装方式 |
| --- | --- |
| macOS | 已有 Homebrew 时运行下方命令；否则从官方页面下载匹配 Apple Silicon / Intel 的客户端 |
| Windows | 从官方页面选匹配系统的 MSI 安装包；也可下载可执行文件并保存在固定位置 |
| Linux | 按官方页面使用 Cloudflare 软件源，或安装匹配架构的 `.deb` / `.rpm` |

macOS 已有 Homebrew：

```sh
brew install cloudflared
```

安装后新开终端，检查：

```sh
cloudflared --version
```

出现 `cloudflared version …` 即可。如果使用手动下载的客户端、命令仍找不到，把它的**完整文件路径**告诉 AI；CLI 可通过 `--cloudflared` 指定。Quick Tunnel 不需要执行 `cloudflared tunnel login`，不需要 Cloudflare 账号或自有域名。[官方说明](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## 3. 确认安装成功

回到 AI 工具，开始一条新消息：

```text
检查 launchmate-deploy 是否安装完整，运行它自带 CLI 的 share-doctor。
只检查环境，先不要创建公网分享。告诉我缺少哪一项。
```

预期结果是 `share-doctor` 输出的顶层 `ready` 为 `true`，且 `node.ready`、`cloudflared.ready` 均为 `true`。这表示依赖已就绪，公网是否可达要等实际分享时验证。

如果 AI 找不到 Skill：

1. 检查表格中的目录和上面的层级。
2. 在 Skill 选择器中查找 `launchmate-deploy`。Codex CLI 可用 `/skills`，Claude Code 和 Cursor 可输入 `/` 搜索，Gemini CLI 可用 `/skills list`。
3. 新开会话；Codex 仍不显示时重启应用。Gemini CLI 可执行 `/skills reload`。
4. 仍不识别时，把安装后的 `SKILL.md` 完整路径发给 AI，让它检查目录与当前工具版本；不要把仓库链接当成已经安装成功。

环境通过后，回到 [首页第二步](../README.md#2-打开自己的项目发起分享)，**切换到你自己的项目文件夹**开始分享。

## 已经安装过，怎么更新？

先停止这次分享，原应用和数据库可以继续运行。

- **ZIP 安装：** 下载新包，把旧 Skill 目录移出 Skill 扫描目录作为备份，再将新文件夹放到原安装位置。不要把新旧版本嵌套或混合。
- **Git 克隆安装：** 在实际安装目录运行 `git pull --ff-only`。有自己的修改时先处理修改，不强制覆盖。

开始新消息，重新运行 `share-doctor`，再发起分享。升级后的代理需要重新创建分享，链接可能改变。
