# zcode-canvas-plugin

yangxu128 的 ZCode 画布插件（作者：yangxu128）。让 Agent 读写工作区画布文档
（`.zcode/canvas/*.json`）并排图片/视频生成意图，执行由宿主进程的 generation worker 完成。

## 安装（ZCode 3.16.2+）

**方式 A：粘贴市场 JSON 的 URL（推荐，最快）**

在 ZCode 里打开 **设置 → 插件 → 市场 → 添加市场**，粘贴：

```
https://cdn.jsdelivr.net/gh/yangxu128/zcode@upgrade/3.16.2/marketplace.json
```

（或 GitHub raw：`https://raw.githubusercontent.com/yangxu128/zcode/plugin-marketplace/marketplace.json`）

**方式 B：GitHub 仓库简写**

在同一入口粘贴：

```
yangxu128/zcode#plugin-marketplace
```

注意：插件当前在发布分支 `plugin-marketplace`；用简写时添加市场会克隆整个
ZCode 仓库（较慢），但安装本身只下载下面的小 zip，不会下载整仓。

## 发布物

- `zcode-canvas-plugin/canvas-0.1.0.zip`：插件安装包（约 6 KB），SHA-256
  `4700382de4da4ccc03d708a0a6ecf7a58c11c1c49a51d43d01d454276a6e8644`。
- 市场清单 `marketplace.json` 用 `url + zip + sha256` 指向这个包，安装时只下载小包。

添加后进入**插件商店 → 个人来源**，找到 Canvas（无限画布）点安装，然后启用。

## 结构

```
marketplace.json                     # 市场清单（author: yangxu128）
zcode-canvas-plugin/plugins/canvas/  # 插件本体
  .zcode-plugin/plugin.json          # manifest + mcpServers
  skills/canvas/SKILL.md             # Agent 行为约定
  dist/server.js                     # MCP server（stdio）
```

## 说明

- 插件只写生成意图（`generation.request`），不持有任何服务商凭据。
- 画布界面仍在 ZCode 侧栏 **"+" → 无限画布**；插件提供的是 Agent 工具层。
- 安装后如果 Agent 看不到 `canvas_*` 工具，请确认插件已启用，并检查插件启动日志。
