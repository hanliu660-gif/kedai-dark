# SillyTavern / 酒馆助手 兼容知识库

> **本目录是什么**：`kb/` 是 Kedai 的**酒馆兼容性知识库**——把 SillyTavern（下称 ST）、
> 酒馆助手（JS-Slash-Runner）、MVU 等外部生态的**行为契约**沉淀成机器可检索、可校验的数据，
> 让「兼容到什么程度 / 哪里还缺 / 下一步改哪」不再依赖会话记忆。
>
> **它不是**：不是上游源码镜像、不是教程、不是产品文档。
>
> **入口**：`kb/index.json`（总索引）→ `kb/entries/*.json`（条目）→ `kb/schema.json`（字段规范）

---

## 1. 许可红线（最重要，先看）

| 上游 | 许可证 | 与本库的关系 |
| --- | --- | --- |
| SillyTavern | **AGPL-3.0** | ⚠️ 传染性 |
| 酒馆助手 JS-Slash-Runner | **PolyForm Noncommercial 1.0.0** | ⚠️ 禁止商用，比 AGPL 更严 |
| MVU（MagVarUpdate） | MIT | 相容 |
| ST-Prompt-Template | AGPL-3.0 | ⚠️ 传染性 |
| **Kedai 自身** | **MIT（公开仓）** | 不能被污染 |

**因此本库的硬规则（2026-10-31 千夏拍板「只存行为契约」）**：

1. **只存事实与语义，不存源码**。
   字段名、取值域、默认值、布尔语义、判定顺序、边界行为、易错点 —— 这些是**事实与思想**，不受版权保护。
2. **禁止**贴上游代码片段、函数体、正则原文、注释原文（含「不超过 X 行」的片段）。
   需要精确到实现时，写**文字描述 + 上游仓库的线上指针**（`https://github.com/<owner>/<repo>/blob/<ref>/<path>#L<起>-L<止>`）。
3. **禁止**把上游仓库的任何文件复制进 `kb/`。
4. **可以**写「上游源码在 `world-info.js:4943` 的 `matchSecondaryKeys()` 里」——**指路不算转载**。

> 这条红线的实际后果：本库能回答「契约是什么、我们做得对不对」，不能直接拿来做代码移植。
> 要移植时按条目里的**路径行号指针**去仓外 `C:\src-st\` 看原文。

---

## 2. 目录结构

```
kb/
├── README.md            ← 本文件：规范与用法
├── schema.json          ← 条目字段规范（JSON Schema 风格，由 tools/check-kb.mjs 逐条求值）
├── index.json           ← 总索引：按域分组的条目清单 + 统计口径
└── entries/
    ├── <id>.json        ← 一条契约一个文件（文件名 = id）
    └── ...
```

> **没有 `state/` 目录**：缺口清单是**即时算出来的**，不落盘缓存——用
> `node tools/kb.mjs gaps`（全部）或 `gaps --domain <域>` 现查现出，数据永远与 `entries/` 同步，
> 不存在「缓存过期」的问题。

**为什么一条一个文件**：便于 `git diff` 精确到条目、便于按域检索、避免单文件膨胀到不可读。

---

## 3. 条目规范（`entries/*.json`）

字段定义见 `kb/schema.json`。必填项：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 唯一 ID，格式 `<domain>.<子域>.<名>`（**全小写**），如 `worldinfo.field.schema` |
| `domain` | enum | `worldinfo` / `macro` / `regex` / `prompt` / `variable` / `card` / `sandbox` / `mvu` / `stscript` |
| `title` | string | 一句话标题（中文） |
| `priority` | enum | `P0` 违反会导致卡行为错乱 / `P1` 明显功能缺失 / `P2` 边缘差异 |
| `authority` | enum | **`doc`**（官方文档，最高）/ `src`（源码补的实现级细节）/ `community`（社区实践） |
| `spec` | object | 契约正文，结构随 domain 而定（见各条目） |
| `kedai` | object | **现状对账**：`status` ∈ `match` / `partial` / `missing` / `differs`；`evidence` 是**本仓**代码位置；`note` 一句话说明 |
| `sources` | array | 依据清单：`{kind: doc\|src\|community, name, ref}`，**`ref` 是路径+行号指针，不是内容** |
| `updated` | string | 日期 `YYYY-MM-DD` |

**写条目时的三条纪律**：
1. `authority: doc` 的条目**必须有官方文档来源**（`https://github.com/SillyTavern/SillyTavern-Docs` 或酒馆助手文档站）。
2. `kedai.evidence` 必须是**本仓真实路径:行号**，且写条目时**实际读过**——不写猜测。
3. `spec` 里**不出现代码**。表达式用**伪代码/表格**，例如「`main ∧ (任一副键)`」而不是贴 JS。

---

## 4. 怎么用

### 4.1 排查「某张卡行为不对」

```bash
node tools/kb.mjs query --domain worldinfo      # 按域列出
node tools/kb.mjs query --kedai differs         # 只看与 Kedai 不一致的
node tools/kb.mjs query --priority P0           # 只看高危
node tools/kb.mjs show worldinfo.field.schema           # 单条详情
```

### 4.2 动手改代码前

```bash
node tools/kb.mjs gaps                          # 当前全部缺口清单（missing + differs + partial）
node tools/kb.mjs gaps --domain regex           # 按域
```

### 4.3 门禁

```bash
node tools/check-kb.mjs        # schema 合规 + ID 唯一 + index 双向一致 + sources 指针存在性
```

---

## 5. 与既有文档的关系（不重复）

| 载体 | 讲什么 | 关系 |
| --- | --- | --- |
| 本机仓外精读笔记（**不入 git**，也无固定路径） | **带源码片段的完整精读笔记**（含代码、含上游内部细节） | **上游证据层**，仅供本机查阅 |
| `酒馆生态参考手册.md`（仓外，与仓库同级） | 契约级知识库的散文版 + 与 Kedai 的逐条对账 | 人类阅读版 |
| **`kb/`（本目录，入 git）** | **结构化契约数据 + 对账状态**，可查询、可校验 | 机器可读版，**本项目唯一对外可持续的载体** |
| `docs/六类活文档` | Kedai 自身的产品/契约/功能 | 与 ST 无关 |

> **判据**：换台机器、换个人还能成立 → `kb/` 与 `docs/`；只在本机成立（含上游源码片段、绝对路径）→ 仓外。

---

## 6. 维护约定

- **上游升版时**：只更新受影响的条目 `spec` 与 `sources.ref`，并在 `updated` 改日期；不要整库重写。
- **Kedai 改动后**：改对应条目的 `kedai.status` 与 `evidence`，然后跑 `tools/check-kb.mjs`。
- **新增条目**：先在 `kb/schema.json` 确认 domain 合法，再写文件，最后登记 `kb/index.json`。
- **删除条目**：从 `index.json` 移除 + 删文件，两处必须同步（门禁会查双向一致）。
- **本库不含代码**：若某条确实需要代码，写在条目 `spec.pseudocode` 里用**伪代码**表达。
