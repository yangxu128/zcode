# 界面皮肤（Skin）规格

## 行为

在既有「界面主题」（浅色/深色/系统）之外提供独立的"皮肤"维度：皮肤调整强调色
（primary / brand / accent），并支持用户自定义背景图片；皮肤不改变明暗模式与布局。
皮肤选择入口放在侧边栏账户菜单的「界面主题」子菜单内，与主题模式单选组并列展示。

- 皮肤取值：`default`（默认，即当前 Zai 黑白强调）、`ocean`、`forest`、`sunset`、`violet`。
- 皮肤与主题模式（light / dark / zai-light / zai-dark / system）正交组合；
  `system` 模式下皮肤同样生效。
- 选择后立即生效并持久化；多窗口之间实时同步。

## 自定义背景图片

- 入口：「界面主题」子菜单提供「背景图片」分组，包含「选择背景图片…」、
  「调节壁纸显示…」与「清除背景图片」三项；未设置壁纸时后两项禁用。
- 文件选择：统一用渲染进程内临时 `<input type="file" accept="image/*">`。
  不走 `IPlatformService.selectFile()`——该接口只返回文件路径（Web 端为 no-op），
  而壁纸需要的是文件内容本身；input 方案在 Web 与 Electron 渲染进程行为一致。
- 图片处理：解码后最长边缩放到 2560px，重编码为 JPEG（质量 0.85）再入库，
  控制内存与 IDB 体积；处理失败（解码错误等）则本次选择无效，保持原状并记 debug 日志。
- 存储：渲染进程 IndexedDB（库 `zcode-ui`，对象仓库 `ui-preferences`，键 `wallpaper`）。
  同源多窗口共享同一份数据；localStorage 放不下图片体量，不作为存储介质。
- 显示调节：「调节壁纸显示…」打开对话框，内含两个滑杆并实时生效：
  壁纸可见度（0–80，默认 40，控制表面透明程度）与遮罩浓度（0–100，默认 25，
  控制壁纸层遮罩）。持久化在 localStorage（`zcode-wallpaper-strength` /
  `zcode-wallpaper-dim`），经广播字段 `wallpaperStrength` / `wallpaperDim`
  同步多窗口；参数与壁纸图片相互独立，更换图片不清空调节值。
- 渲染参数推导：强度 s（0–1）→ 工作区/窗口框架 color-mix 占比 (1−s)×100%，
  侧边栏 (1−0.7s)×100%；浓度 d（0–1）→ 壁纸层 `::after` opacity。
  `lib/wallpaper.ts` 的 `applyWallpaperStyle` 把结果写入 documentElement 内联变量
  （`--wallpaper-bg-mix` / `--wallpaper-win-alt-mix` / `--wallpaper-sidebar-mix` /
  `--wallpaper-scrim-opacity`），styles.css 的 `has-wallpaper` 规则引用这些变量；
  默认值精确复现固定参数时期的观感（60% / 60% / 72% / 0.25）。
- 渲染：`applyWallpaper` 在 `body` 下维护一个 `#zcode-wallpaper-layer` 固定层
  （z-index -1，`background-size: cover`，pointer-events none），其 `::after` 用
  `--color-background-solid` 做半透明遮罩保证可读性；同时在 documentElement 上挂
  `has-wallpaper` class，把 `--color-background` / `--color-background-win-alt` /
  `--color-sidebar` / `--color-background-alt` 覆盖为基于 `*-solid` 变量的半透明
  color-mix，使窗口框架（DesktopWindowFrame 的不透明 win-alt 表面）、工作区与侧边栏
  透出壁纸，并撤掉 Web 引导样式给 body/#root 画的不透明画布；菜单、弹出层、卡片
  保持不透明。
- 状态所有者：与主题/皮肤同一个 Zustand store。内存字段为
  `wallpaperDataUrl`（渲染源）与 `wallpaperVersion`（同步令牌，毫秒时间戳）；
  持久化真值在 IndexedDB，store 不是第二份持久化。
- 跨窗口同步：`wallpaperVersion` 加入 `BROADCAST_FIELDS`。发送方写 IDB 后广播版本号；
  接收方比较版本（小于等于当前值直接忽略，保证幂等），再从 IDB 重新加载并应用。
  广播只传版本号，不传图片体。
- 初始化：store 工厂内异步水合——从 IDB 读取并应用；仅当当前 `wallpaperVersion`
  为 0 时写入状态，避免与广播竞态互踩。
- E2E：`window.__testActions` 新增 `getWallpaper` / `setWallpaper` / `clearWallpaper`，
  复用 store 同一写入路径（仍仅非生产注册）。

## 状态所有者

单一所有者：`packages/ui/src/store/index.ts` 的 Zustand store（与 `theme`、
`locale`、`interfaceMode` 同一所有者）。

```text
用户点击菜单项 ──> store.setSkin(skin)
                    ├─ normalizeSkin（非法值回落 default）
                    ├─ writeSafeLocalStorage("zcode-skin", skin)
                    ├─ applySkin(skin)（切换 documentElement 上的 skin-* class）
                    └─ set({ skin }) ──> subscribe 检测变更 ──> broadcast "state:skin"
其他窗口收到广播 ──> applyingBroadcast=true ──> state.setSkin(payload) ──> 不再二次广播
```

壁纸的事件顺序（异步）：

```text
选择文件 ──> processImageFile ──> IDB put ──> applyWallpaper(dataUrl)
        ──> set({wallpaperDataUrl, wallpaperVersion}) ──> broadcast 版本号
其他窗口 ──> 收到版本号 ──> 版本比较 ──> IDB 读 ──> applyWallpaper ──> set（不再二次广播）

拖动滑杆 ──> setWallpaperStyle(strength, dim) ──> localStorage + applyWallpaperStyle
        ──> set({wallpaperStrength, wallpaperDim}) ──> 按字段广播（未变字段不发送）
其他窗口 ──> 收到数值 ──> setWallpaperStyle(值, 本窗口另一参数) ──> 不再二次广播
```

- DOM 应用层：`packages/ui/src/useTheme.ts` 的 `applySkin` 与
  `lib/wallpaper.ts` 的 `applyWallpaper` / `applyWallpaperStyle`；皮肤与壁纸互不
  感知，class 并存。
- 菜单 UI：`WorkspaceSidebarFooter` 直接经 `useZCodeStore` 读取状态
  （同文件 `interfaceMode` 的既有模式），不新增 props 链；显示调节对话框由该组件
  内部 state 控制，滑杆经同一 setter 走 store 写入路径。

## 不变量

1. 皮肤不修改明暗模式与布局；背景变更只发生在壁纸功能内。
2. `skin-*` class 的 CSS 特异性必须压过主题类（`:root.skin-*` 0,2,0 >
   `.theme-zai-*` 0,1,0；`.dark.skin-*` 定义在 `:root.skin-*` 之后以覆盖浅色值）。
3. 广播防回环：复用 `applyingBroadcast` 守卫与 `BROADCAST_FIELDS` 机制，
   `skin` 与 `wallpaperVersion` 加入其中，不另建同步通道。
4. 非法持久化值（手改 localStorage、旧版本数据）一律回落 `default`，不抛错。
5. 每个主题块必须同时维护 `--color-background-solid` / `--color-sidebar-solid` /
   `--color-background-win-alt-solid`（始终不透明），壁纸的半透明覆盖与遮罩层都基于
   solid 值计算；`has-wallpaper` 撤掉 Web 引导样式的不透明画布时依赖本文件在
   引导样式之后加载（同特异性 !important 靠源码顺序取胜）。

## 失败语义

- localStorage 不可用时（隐私模式等）：`readSafeLocalStorage` /
  `writeSafeLocalStorage` 已有的静默降级路径，皮肤退化为会话内生效。
- IndexedDB 不可用或读写抛错：壁纸功能静默降级（无壁纸、清除项禁用），
  不影响皮肤与其余功能；选择图片后的处理失败保持原壁纸不变。
- 广播通道不可用（Web no-op 实现）：壁纸/皮肤仅当前窗口生效，不影响其他功能。

## 迁移边界

- 新增 localStorage key `zcode-skin`，不读写、不改名既有 `zcode-theme`；
  未设置时默认 `default`，老用户升级后观感不变。
- IndexedDB 库 `zcode-ui` 为新增命名空间，不复用既有库；清除壁纸即删除键值，
  不做历史迁移。
- `Theme` 枚举与既有快捷切换（深/浅）、设置页主题卡片行为不变。

## 非目标

- 设置页（SettingsPage）暂不重复提供皮肤/壁纸选择（入口仅在界面主题菜单）。
- 壁纸模糊度调节与多图轮换暂不提供。
- 皮肤不提供自定义取色器（后续扩展点：扩展 Skin 联合类型与 styles.css 变量段）。
