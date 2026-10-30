# 酒馆兼容知识库 · 完整大纲（MaSTER PLAN）

> **这份文件是什么**：`kb/` 的**主题总盘**——把「酒馆生态里所有需要对齐的契约点」列全，
> 标清**已有 / 待补 / 明确不做**，作为后续补条目的施工图。
>
> **为什么需要它**：33 条已经覆盖了 P0 主干，但「还缺什么」只存在于会话记忆里 ——
> 这份大纲把它落盘，避免下个会话重新摸一遍，也避免重复造条目。
>
> **状态图例**：✅ 已有条目 · ⬜ 待补（本轮目标）· ⏸ 暂不做（记为 backlog）· ❌ 确认不需要
>
> 更新时间：2026-10-31。**唯一权威是 `kb/entries/`**；本文件只做规划，不重复 spec 内容。

---

## 0. 九个域的总盘

| 域 | 已有 | 待补 | 暂不做 | 说明 |
| --- | --- | --- | --- | --- |
| `worldinfo` 世界书 | 7 | **6** | 2 | 主干已齐；缺组竞争/装饰器/卡内书转换/全局设置/缓冲评分/再扫路径 |
| `macro` 宏系统 | 5 | **6** | 2 | 缺词法/trim/内建宏清单/别名/求值上下文/宏 vs 命令对照 |
| `regex` 正则脚本 | 4 | **3** | 1 | 缺替换语义/调用点真值表/老数据迁移 |
| `prompt` Prompt 装配 | 3 | **3** | 1 | 缺锚点拼接细节/扩展注入/Context Template 与 Instruct |
| `variable` 变量存储 | 1 | **4** | 1 | 只有 scope 落点；缺 get/set/add 精确语义/变量名规则/命令宏对照 |
| `card` 角色卡载体 | 4 | **2** | 2 | 缺 CHARX/JPEG-WebP 容器 · 卡字段 V1V2V3 差异（重要！） |
| `sandbox` 沙箱宿主 | 5 | **4** | 2 | 缺消息层 range/refresh、事件表、前端卡渲染流程、高度同步 |
| `mvu` MVU 框架 | 4 | **4** | 2 | 缺 MvuData 结构/parseString 回退/correctlyMerge/事件表 |
| `stscript` STscript | **0** | **4** | 2 | **整个域为空** —— 与 Kedai 的 slash 能力对齐需要 |

**合计**：已有 33 · 待补 **36** · 暂不做 15 · 本轮目标 ≈ **36 条**

---

## 1. `worldinfo` 世界书（已有 7 / 待补 6）

### 1.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `worldinfo.field.schema` | 42 字段全集与默认值 |
| ✅ | `worldinfo.logic.selective` | 副关键词四档（主键命中为前提） |
| ✅ | `worldinfo.position.slots` | position 八档落点与排序方向 |
| ✅ | `worldinfo.activation.flow` | 18 道关判定顺序 |
| ✅ | `worldinfo.budget.sticky` | budget 是粘性标志 |
| ✅ | `worldinfo.timed.state` | sticky/cooldown/delay 状态机 |
| ✅ | `worldinfo.depth.atdepth` | atDepth 深度缺失静默丢条 |

### 1.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `worldinfo.group.competition` | **组内竞争**（`group`/`groupWeight`/`groupOverride`/`useGroupScoring`）：两阶段过滤 + 五种结局，写错会导致「同组多条目同时激活」 |
| ⬜ | `worldinfo.decorators` | **装饰器**（`@@activate`/`@@dont_activate`/`@@if`/`@@unless`/`@@var`/`@@set`）：卡作者用它在世界书条目里写条件逻辑，顺序压得住 constant |
| ⬜ | `worldinfo.book.convert` | **卡内书转换**（`convertCharacterBook`）：哪些字段被丢、`use_regex` 为何强制 true ⇒ 直接影响导入卡的世界书行为 |
| ⬜ | `worldinfo.settings.global` | **全局激活设置**（`world_info_depth` 默认 2 / `budget` 默认 25（百分比）/`min_activations`/`max_recursion_steps`/`include_names`/`character_strategy`） |
| ⬜ | `worldinfo.buffer.score` | **扫描缓冲与 getScore**：缓冲如何构造（含 `Name:` 前缀）、组评分怎么算 |
| ⬜ | `worldinfo.rescan.paths` | **三条再扫路径**（递归 / min_activations / delayUntilRecursion）的循环结构与互斥关系 |

### 1.3 暂不做（backlog）

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | `WORLDINFO_FORCE_ACTIVATE` 外部强制激活 | 属高级 API，当前卡很少用 |
| ⏸ | 向量召回（`vectorized` + Vector Storage 交互） | Kedai 无向量扩展；等有需求再做 |

---

## 2. `macro` 宏系统（已有 5 / 待补 6）

### 2.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `macro.syntax.argspec` | 三种参数分隔符、大小写、嵌套、未知宏保留 |
| ✅ | `macro.eval.order` | 求值顺序 = 源码出现顺序（边遍历边吐） |
| ✅ | `macro.registry.args` | 注册项参数契约（`strictArgs` 默认 true、`defaultValue` 是文档字段） |
| ✅ | `macro.variable.family` | local/global 两套 18 个变量宏 |
| ✅ | `macro.flags` | 六个标志位（只有 `#` 真改行为） |

### 2.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `macro.trim.semantics` | **scoped 内容的 trim + dedent 语义**：默认自动 trim，只有 `#` 能关；写错会让卡的多行文本缩进错乱 |
| ⬜ | `macro.builtin.catalog` | **内建宏全目录**（93 主宏 / 31 别名 / 124 lookup）：分类（名字/卡字段/时间/随机/工具/条件） |
| ⬜ | `macro.conditional` | **条件宏** `{{if}}`：必须延迟参数解析（`delayArgResolution`），否则两个分支都执行 |
| ⬜ | `macro.alias.rules` | **别名与大小写**：宏名不敏感、别名解析顺序、`{{.x}}`/`{{$x}}` 简写规则 |
| ⬜ | `macro.eval.context` | **求值上下文**（`MacroEnvBuilder`）：哪些环境变量可用、`normalize` 回调做什么 |
| ⬜ | `macro.vs.command` | **宏 vs STscript 命令的边界**：什么该用宏、什么该用命令；两者的互嵌规则 |

### 2.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | MacroBrowser（宏浏览器 UI 数据） | 纯 UI 面，与卡行为无关 |
| ⏸ | MacroDiagnostics（诊断/高亮） | 开发工具面 |

---

## 3. `regex` 正则脚本（已有 4 / 待补 3）

### 3.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `regex.placement.constants` | placement 五有效值、空数组=永不自动触发 |
| ✅ | `regex.engine.chain` | 五道门执行顺序（placement 判最后） |
| ✅ | `regex.only.matrix` | 两个 only 四态真值表（「不发送」的实现） |
| ✅ | `regex.substitute.modes` | 宏替换三档 NONE/RAW/ESCAPED |

### 3.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `regex.replace.semantics` | **替换语义**：`{{match}}`→`$0`、`$n`/`$<name>` 捕获组、缺组返回空串、`trimStrings` 只作用于捕获组、宏展开在替换**之后** |
| ⬜ | `regex.call.sites` | **调用点真值表**（12 处调用 → 各跑哪些脚本）：谁传 `isMarkdown`/`isPrompt`/`isEdit`/`depth` |
| ⬜ | `regex.migration` | **老数据迁移**：`MD_DISPLAY=0` 弃用、`4=sendAs` 空号的兼容处理（不迁移会丢脚本） |

### 3.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | 正则脚本 UI/schema 编辑器映射 | 纯 UI |

---

## 4. `prompt` Prompt 装配（已有 3 / 待补 3）

### 4.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `prompt.injection.two_modes` | RELATIVE / ABSOLUTE 两档，depth/order 只对 ABSOLUTE 生效 |
| ✅ | `prompt.slot.assignment` | 槽位赋值（下标赋值不是 push），跳过的槽留空洞 |
| ✅ | `prompt.pinned.identifiers` | 12 个内建锚点、7 个写死序列、缺失自动补回 |

### 4.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `prompt.anchor.code` | **硬编码锚点具体拼接**（A1~A10）：7 个 identifier 写死调用序列、`controlPrompts` 恒 push 末尾、禁用的 main 保留空 content 替身 |
| ⬜ | `prompt.extension.inject` | **扩展注入**：相对扩展 prompt 怎么塞进 main 槽；无 main 时转 ABSOLUTE 副本；已知扩展名单 |
| ⬜ | `prompt.context.instruct` | **Context Template 与 Instruct Mode**：只适用 Text Completion；`story_string` 模板里**没写的字段整段不进 prompt** |

### 4.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | Prompt Manager UI 的 pinned 四张名单细节 | 已在 `pinned.identifiers` 覆盖要点 |

---

## 5. `variable` 变量存储（已有 1 / 待补 4）

### 5.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `variable.store.scope` | local/global/scope 三处落点、自动数字化、add 三级降级、变量名无正则 |

### 5.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `variable.get.set` | **get/set 精确语义**：`get` 自动数字化（`"5"`→`5`）、`set` 带 index 时整条 JSON 化 ⇒ 同一变量两种物理表示 |
| ⬜ | `variable.add.inc.dec` | **add/inc/dec 的降级顺序**（数组 push > 非数则字符串拼 > 数字加）：`"5"+"apples"="5apples"`，这块最常被写错 |
| ⬜ | `variable.name.rules` | **变量名合法性**：只有「非空」校验；`/^[a-zA-Z0-9_]{1,64}$/` 是 OpenAI 消息 name 不是变量名（张冠李戴陷阱） |
| ⬜ | `variable.resolve.order` | **查找顺序**：scope→local→global→原样返回名字；命令参数求值 `数字→scope→local→global→字面量` |

### 5.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | `listvar`/`flushvar` 等冷门命令 | 低使用率 |

---

## 6. `card` 角色卡载体（已有 4 / 待补 2）

### 6.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `card.png.text` | PNG 只认 tEXt、ccv3 优先、双写、关键字小写 |
| ✅ | `card.chat.jsonl` | 聊天 JSONL：首行 header、空行过滤、坏行整份坏 |
| ✅ | `card.frontend.detect` | 前端卡三子串判定（极宽松） |
| ✅ | `card.lodash.shared` | iframe 的 lodash 是父窗同一实例 |

### 6.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `card.spec.versions` | **★ 卡规格 V1/V2/V3 差异**：`spec`/`spec_version`/`data` 包装、V1 六字段、V3 `assets`/`nickname`/`group_only_greetings`（**这是最缺的一条**，导入兼容全靠它） |
| ⬜ | `card.container.others` | **CHARX 与 JPEG/WebP 容器**：zip 结构 `card.json`+assets、`embeded://path` 拼写、非 PNG 容器的段规则 |

### 6.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | 卡导出写回细节（`originalData` 无损保留） | 导出面非当前重点 |
| ⏸ | 头像/资产文件管理 | 与卡解析无关 |

---

## 7. `sandbox` 沙箱宿主（已有 5 / 待补 4）

### 7.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `sandbox.sillytavern.getcontext` | 必须实时 getter + 带 getContext |
| ✅ | `sandbox.predefine.injection` | 绑定 this、名字去一个下划线、Mvu.set 空函数 |
| ✅ | `sandbox.jquery.two_hosts` | 两套 jQuery 操作不同 document |
| ✅ | `sandbox.event.chat_changed` | CHAT_CHANGED 的值是 `chat_id_changed` |
| ✅ | `sandbox.iframe.pagehide` | pagehide 自动清空事件监听 |

### 7.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `sandbox.chat.messages` | **消息层 API**：`getChatMessages` range 解析（含 `'0-{{lastMessageId}}'`）、`include_swipes` 两种返回形状、`setChatMessages` refresh 三态 |
| ⬜ | `sandbox.event.table` | **事件表**：`tavern_events` 82 个 / `iframe_events` 9 个、`eventOn` 不去重、`.stop()` 实际无效 |
| ⬜ | `sandbox.render.flow` | **前端卡渲染流程**：识别 → srcdoc/Blob → 注入 → 高度同步 |
| ⬜ | `sandbox.height.vh` | **高度同步与 vh 改写**：只有 `min-height` 的 vh 会被改写为 `--TH-viewport-height`，其余 vh 以楼层 iframe 为基准 |

### 7.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | `cleanup_protector` 的完整劫持清单 | 只影响脚本 iframe 内部清理 |
| ⏸ | iframe 卸载/重建的生命周期边缘 | 等真卡实测暴露再说 |

---

## 8. `mvu` MVU 框架（已有 4 / 待补 4）

### 8.1 已有

| 状态 | ID | 主题 |
| --- | --- | --- |
| ✅ | `mvu.vwd.pair` | VWD 判定与写入保留描述 |
| ✅ | `mvu.updatevariable.commands` | 命令全集与别名归一、move 半成品 |
| ✅ | `mvu.block.scalar` | 块标量屏蔽与中文键盲区 |
| ✅ | `mvu.initvar.merge` | [InitVar] 顶层浅展开、已有值赢 |

### 8.2 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `mvu.data.structure` | **MvuData 类型结构**：`stat_data`/`display_data`/`delta_data`/`initialized_lorebooks`/`schema`/`$meta` 各是什么 |
| ⬜ | `mvu.parse.fallback` | **parseString 四段回退**（YAML→JSON5→jsonrepair→JSON）：与 `parseStructuredUpdate`（JSON5 优先）是**两条不同链** |
| ⬜ | `mvu.merge.correctly` | **correctlyMerge 三态**（数组整体替换 / 对象深合并 / 标量覆盖） |
| ⬜ | `mvu.events.deprecated` | **事件表与 deprecated API**：`VARIABLE_INITIALIZED`/`UPDATE_STARTED`/`COMMAND_PARSED`/`UPDATE_ENDED` + 10 项 deprecated |

### 8.3 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | beta `$meta` 结构保护（extensible/template/strictTemplate） | 实验特性 |
| ⏸ | mathjs 表达式求值 | 高级玩法 |

---

## 9. `stscript` STscript（已有 0 / 待补 4）★ 整个域空着

### 9.1 待补

| 待补 | 建议 ID | 为什么重要 |
| --- | --- | --- |
| ⬜ | `stscript.syntax` | **语法**：命令名/命名参数/位置参数/管道 `\|`/`\|\|`/闭包 `{: :}`/转义/注释 |
| ⬜ | `stscript.argument.types` | **9 种参数类型**与 `isRequired`/`forceEnum`/`defaultValue` **运行时不校验**（框架最大坑） |
| ⬜ | `stscript.control.flow` | **控制流**：`/if`（rule 全集）/`/while`（上限 100 轮、条件每轮重算）/`/times`/`/run`/`/pass`/`/break`（只断一层） |
| ⬜ | `stscript.command.catalog` | **命令清单与分类**：哪些命令与 Kedai 能力对得上、哪些需要新做 |

### 9.2 暂不做

| ⏸ | 主题 | 原因 |
| --- | --- | --- |
| ⏸ | QR（Quick Reply）集成 | Kedai 已有自己的快捷回复实现 |
| ⏸ | 全部 100+ 命令逐条 | 先做语法与框架，命令按需 |

---

## 10. 补齐顺序（建议）

按「影响卡行为 + 成本低」排：

| 批次 | 条目 | 理由 |
| --- | --- | --- |
| **B1** | `worldinfo.group.competition` · `worldinfo.decorators` · `worldinfo.book.convert` · `worldinfo.settings.global` · `worldinfo.buffer.score` · `worldinfo.rescan.paths` | 世界书已是最完整域，补齐即可**结项** |
| **B2** | `card.spec.versions` · `variable.get.set` · `variable.add.inc.dec` · `variable.name.rules` · `variable.resolve.order` | 卡规格最缺；变量层是 MVU 基础 |
| **B3** | `macro.trim.semantics` · `macro.builtin.catalog` · `macro.conditional` · `macro.alias.rules` · `macro.eval.context` · `macro.vs.command` | 宏系统补齐 |
| **B4** | `sandbox.chat.messages` · `sandbox.event.table` · `sandbox.render.flow` · `sandbox.height.vh` | 沙箱补齐（与真卡实测直接相关） |
| **B5** | `mvu.data.structure` · `mvu.parse.fallback` · `mvu.merge.correctly` · `mvu.events.deprecated` | MVU 补齐 |
| **B6** | `regex.replace.semantics` · `regex.call.sites` · `regex.migration` | 正则补齐 |
| **B7** | `prompt.anchor.code` · `prompt.extension.inject` · `prompt.context.instruct` | Prompt 补齐 |
| **B8** | `stscript.syntax` · `stscript.argument.types` · `stscript.control.flow` · `stscript.command.catalog` | 新域，最后做 |

**总量**：36 条待补。全部补齐后 kb 将有 **69 条**，九个域全覆盖。

---

## 11. 开工前的三个纪律（别忘）

1. **许可红线**：只存行为契约，不贴上游源码。K6 会自动拦。
2. **`sources.ref` 用线上指针**（`https://github.com/.../file.js#L123-L456`），**不写本机绝对路径**（本仓是公开仓）。
3. **`kedai.evidence` 必须本仓真实行号**且实际读过；写完**必须登记 `kb/index.json`**，否则 K4 报不一致。

每条写完跑一次 `node tools/check-kb.mjs`。
