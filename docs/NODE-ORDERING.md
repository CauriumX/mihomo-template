# 节点排序机制（mihomo 内核行为实证）

**结论日期**：2026-11-11
**验证对象**：mihomo v1.19.2（源码 + 二进制）
**触发问题**：FlClash / Clash Verge 代理页节点顺序不是 A100 → B200 → C300

---

## 摘要

| 问题 | 结论 |
|---|---|
| `include-all-proxies` 是否"按内部 map 乱序"？ | ❌ **不是**。mihomo 主动 `slices.Sort` 按节点名**字节序**排序，结果确定、可复现 |
| 客户端排序是 FlClash 的 bug 吗？ | ❌ 不是。mihomo 内核行为，FlClash / Clash Verge / Clash Meta 全部一致 |
| 为什么改模板前 A100→B200 是对的？ | ✅ 因为那时是**显式列名**，不走 `slices.Sort` |
| 为什么现在变成 E500 开头？ | 节点名带国旗 emoji，emoji 字节序（`0xF0`）> 字母（`0x41`），导致按国旗分组 |
| MiSub 侧排序是否正确？ | ✅ 正确，且与 mihomo 排序结果**收敛一致** |

> **格式前提**：本文所有结论均针对 **YAML 模板**。若改用 ini 模板，
> 组定义由 subconverter 展开，排序路径完全不同，且会丢失 `dns` / `sniffer` /
> `tun` 三个整段。为什么本仓库坚持 YAML，见
> [`TEMPLATE-FORMAT.md`](./TEMPLATE-FORMAT.md)。

---

## 一、mihomo 源码实证

### 1.1 `AllProxies` 的构建与排序

`config/config.go`（v1.19.2）：

```go
// L854：按 proxies: 段声明顺序收集
for idx, mapping := range proxiesConfig {
    proxy, err := adapter.ParseProxy(mapping)
    ...
    proxies[proxy.Name()] = proxy
    proxyList = append(proxyList, proxy.Name())
    AllProxies = append(AllProxies, proxy.Name())   // ← 声明顺序
    proxiesList.PushBack(mapping)
}

// L892：★ 关键 —— 按名称字节序重排
slices.Sort(AllProxies)
slices.Sort(AllProviders)
```

**`slices.Sort` 对 `[]string` 是字节序（UTF-8 码位）比较**，不是 `localeCompare`，不是数字感知（`A100` vs `A1000` 会按字符串比）。

### 1.2 `include-all-proxies` 的展开

`adapter/outboundgroup/parser.go`：

```go
// L74-94
if groupOption.IncludeAllProxies {
    if groupOption.Filter != "" {
        // 有 filter 时按正则筛选，仍遍历已排序的 AllProxies
        for _, p := range AllProxies { ... }
    } else {
        // 无 filter 时整体追加已排序的 AllProxies
        groupOption.Proxies = append(groupOption.Proxies, AllProxies...)
    }
    if len(groupOption.Proxies) == 0 && len(groupOption.Use) == 0 {
        groupOption.Proxies = []string{"COMPATIBLE"}
    }
}
```

**所以 `include-all-proxies: true` 的组，节点顺序 = `slices.Sort(节点名)` 的结果，与 `proxies:` 段声明顺序无关。**

### 1.3 显式列名的路径不同

`parser.go:135`：

```go
if len(groupOption.Proxies) != 0 {
    ps, err := getProxies(proxyMap, groupOption.Proxies)   // ← 按列表顺序取，不排序
}
```

**显式列名的组完全按 `proxies:` 列表顺序输出，不经过 `slices.Sort`。** 这是两种机制的根本差异。

---

## 二、两种机制对比

| | 显式列名 | `include-all-proxies: true` |
|---|---|---|
| 顺序来源 | 模板里写的顺序 | `slices.Sort(节点名)` 字节序 |
| 是否受 `proxies:` 声明顺序影响 | ✅ 完全决定 | ❌ 完全忽略 |
| 节点增删 | 需同步改模板，否则 `not found` 报错 | 自动跟随，无需改模板 |
| 排序可控性 | 完全可控 | 只能通过**改节点名**控制 |
| 代码路径 | `getProxies()` (parser.go:135) | `append(AllProxies...)` (parser.go:89) |

> 两种机制都只存在于 **YAML 模板**。ini 模板用 `custom_proxy_group=` 指令，
> 由 subconverter 按正则筛选展开，既不走 `getProxies()` 也不走 `slices.Sort`。
> 详见 [`TEMPLATE-FORMAT.md`](./TEMPLATE-FORMAT.md) 第三节。

---

## 三、国旗 emoji 是排序的唯一变量

### 3.1 实测：无国旗（当前 MiSub 输出）

```
A100-XX-AAA-BBB-01 … 05
C300-XX-AAA-BBB-01 … 05
D400-XX-AAA-BBB-01 … 05
E500-XX-AAA-BBB-01 … 05
F600-XX-AAA-BBB-01 … 05
G700-XX-AAA-BBB-01
```

→ **A100 → G700 单调递增，完全正确。**

### 3.2 实测：带国旗（改造前的节点名）

```
🇦🇺E500-XX-AAA-BBB-01 … 05   ← 澳洲排第一
🇩🇪C300-XX-AAA-BBB-01 … 05
🇭🇰F600-XX-AAA-BBB-01 … 05
🇺🇸A100-XX-AAA-BBB-01 …      ← 美国垫底
```

→ 按**国家**分组，不是按机型。

### 3.3 原因

国旗 emoji 的 UTF-8 编码首字节是 `0xF0`（4 字节序列），ASCII 字母 `A`–`Z` 是 `0x41`–`0x5A`。

```
0xF0 > 0x41   →  任何带国旗的名字都排在无国旗的名字之后
```

而国旗之间的相对顺序同样是码位序：

```
🇦🇺 (U+1F1E6 U+1F1FA)  <  🇩🇪 (U+1F1E9 U+1F1EA)  <  🇭🇰 (U+1F1ED U+1F1F0)  <  🇺🇸 (U+1F1FA U+1F1F8)
```

所以 `🇦🇺E500` 排第一。**这和 FlClash 无关，任何 mihomo 客户端都一样。**

---

## 四、历史时间线（为什么"改配置前是对的"）

`mihomo-template` 仓库：

| 时间 | commit | 变更 | 排序机制 |
|---|---|---|---|
| 11-07 15:57 | `4befd8e` | 21 个 select 组**显式列出 30 个节点名** | 模板顺序（A100→B200→C300…）✅ |
| 11-11 04:44 | `7eabdea` | 移除 B200 节点引用 | 仍显式列名 ✅ |
| 11-11 04:48 | `06c8a5f` | Main Proxy 加入 G700 | 仍显式列名 ✅ |
| 11-11 04:56 | `3cf8793` | **526 行硬编码 → `include-all-proxies: true`** | `slices.Sort` 字节序 ⚠️ |

**`4befd8e` ~ `3cf8793` 之间，排序是正确的**（显式列名，含 B200）。`3cf8793` 之后顺序交给 `slices.Sort`，而当时节点名带国旗，于是按国旗分组。

**用户的观察"改配置前是按 A100、B200 排序"完全正确，不是错觉。**

### 4.1 `3cf8793` 的真实动机

模板硬编码 30 个节点名，但各 profile 节点集合不同（5/4/4/4/26/8），导致部分 profile 报：

```
proxy group Main Proxy: C300-XX-AAA-BBB-01 not found
```

改用 `include-all-proxies` 是为了**让节点增减不再需要改模板**。这个动机成立，但代价被描述错了（见下文"已修正的错误说法"）。

---

## 五、当前方案：让两条排序路径收敛

### 5.1 MiSub 侧配置

> ⚠️ **捕获组编号必须与实际数量对齐。** 下面的正则只有 **5 个**捕获组，
> 替换串就必须是 `$1-$2-$3-$4-$5`。写成 `$2-$3-$4-$5-$6` 时，JS 的
> `String.replace` 对不存在的 `$6` 不会报错，而是**原样输出字面量 `$6`**，
> 结果节点名变成 `US-DMC-LAX-01-$6` —— 静默失败，只有拉订阅才看得见。
> 实测于 2026-11-11，已回滚。

```json
{
  "enableFlagEmoji": false,
  "defaultOperators": [
    {
      "id": "rename-model-first",
      "type": "rename",
      "enabled": true,
      "params": {
        "regex": {
          "enabled": true,
          "rules": [{
            "pattern": "^([A-Z]\\d{3})-([A-Z]{2})-([A-Z]{3})-([A-Z]{3})-(\\d+)$",
            "flags": "u",
            "replacement": "$1-$2-$3-$4-$5"
          }]
        }
      }
    },
    {
      "id": "sort-by-name",
      "type": "sort",
      "enabled": true,
      "params": {
        "nameIgnoreEmoji": true,
        "keys": [{ "key": "name", "order": "asc" }]
      }
    },
    {
      "id": "dedup-last",
      "type": "dedup",
      "enabled": true,
      "params": { "mode": "serverPort", "includeProtocol": true }
    }
  ]
}
```

**算子顺序不可变**：`rename → sort → dedup`。`dedup` 必须在最后，因为它用 `Map` 重建数组会打乱排序结果。

**配置有三层，改一层不够**：

| 层 | 位置 | 优先级 |
|---|---|---|
| 组级 `nodeTransform.addFlagEmoji` | `profiles[].nodeTransform` | **最高**，覆盖全局 |
| 全局 `enableFlagEmoji` | `config.enableFlagEmoji` | 中 |
| 默认值 | 代码内 | `true` |

`subscription-service.js:641` 的判定：

```js
let shouldKeepEmoji = config.enableFlagEmoji !== false;
if (nodeTransformConfig?.addFlagEmoji === false) shouldKeepEmoji = false;
if (nodeTransformConfig?.addFlagEmoji === true)  shouldKeepEmoji = true;  // ← 组级 true 会赢
```

所以只关 `enableFlagEmoji` **不管用** —— 只要任何一个 profile 的
`nodeTransform.addFlagEmoji` 是 `true`，国旗照样加回来。两边必须同时关。

**两个写入接口分工不同**（很容易搞错）：

| 接口 | 负责 | 不负责 |
|---|---|---|
| `POST /api/settings` | `config`（含 `defaultOperators`、`enableFlagEmoji`） | **忽略 `profiles`** |
| `POST /api/misubs` | `misubs` + `profiles` | config |

`POST /api/misubs` 的 `diff.profiles.updated` 是**整行替换**（`applyPatch` 语义），
不是字段合并。只传 `{id, operators}` 会把 `name`/`manualNodes`/`customId` 全部抹掉。
改 profile 必须回传**完整 profile 对象**。

### 5.2 为什么这样能收敛

| 路径 | 排序依据 | 结果 |
|---|---|---|
| MiSub `sort` 算子 | `localeCompare(..., {numeric:true})`，`nameIgnoreEmoji: true` | A100 → G700 |
| mihomo `slices.Sort` | 字节序，节点名无 emoji | A100 → G700 |

**两条路径结果一致**，所以无论客户端用"默认"还是"按名称排序"，顺序都是对的。

### 5.3 关键约束：`enableFlagEmoji` 必须为 `false`

只改 rename 正则去掉 emoji **不够**。MiSub 在输出链路末端有 `addFlagEmoji()`：

```
算子链 (rename → sort → dedup)
  ↓
addFlagEmoji()   ← enableFlagEmoji: true 时会把国旗加回行首
```

`subscription-service.js` 附近：

```js
const finalLines = shouldKeepEmoji
    ? currentLines.map((line) => addFlagEmoji(line))
    : currentLines;
```

**必须同时关闭 `enableFlagEmoji`**，否则国旗被加回，`slices.Sort` 又按国旗分组。

### 5.4 为什么不用 ini 模板

ini 模板（`custom_proxy_group=`）能通过 `<%regionStrategyChain%>` 自动生成
带国旗的地区组，看似更省事。但代价是**丢失 `dns` / `sniffer` / `tun`
三个整段**，且规则集只能用 `.list` 文本格式（本仓库用 `.mrs` 二进制）。

没有 `sniffer`，纯 IP 连接无法还原域名，所有基于域名的分流规则对这类连接失效。

**排序相关的地区分组需求，YAML 用 `filter` 正则就能实现，已实测：**

```yaml
  - name: 🇺🇸 美国节点
    type: select
    include-all-proxies: true
    filter: "-US-"
```

`filter` 在 `AllProxies` 展开后做正则筛选（`parser.go:74-94`），顺序仍由
`slices.Sort` 决定，**不影响本文的排序契约**。

完整对比（含 mihomo 实测成员数、渲染路径差异、三个不可接受损失）见
[`TEMPLATE-FORMAT.md`](./TEMPLATE-FORMAT.md)。

---

## 六、手动选择被重置：`store-selected` 的失效条件

**结论日期**：2026-11-11
**触发问题**：在 `Main Proxy` 里手动选定节点后，订阅刷新会跳回 `♾️Auto Select`，IP 反复变化。

### 6.1 根因不是"手动组被删"

`b54c87f` 删除了 `☑️手动切换` 组，理由是"由 Main Proxy 承担"。但 `Main Proxy` 承担不了 —— 问题不在组的有无。

`profile.store-selected: true` 的持久化 key 是 **「组名 → 节点名」字符串**。节点名一变，key 失效，`select` 组回落到 `proxies[0]`。

### 6.2 四组内核实测（mihomo v1.19.2）

| 场景 | 选中项 | 结论 |
|---|---|---|
| 手动切到 `A100-01` | `A100-01` | ✅ 生效 |
| 重启内核 | `A100-01` | ✅ 持久化本身有效 |
| 重载配置，节点集不变 | `A100-01` | ✅ 保持 |
| 重载配置，**新增节点** | `A100-01` | ✅ 保持 |
| 重载配置，**节点改名** | `♾️Auto Select` | ❌ **回落** |

**触发条件是节点名变化，不是节点增删。**

### 6.3 为什么节点名会变

订阅链路里节点名并不稳定：

- `enableFlagEmoji` 开关切换（国旗有无）
- `flagEmojiSeparator` 改动（国旗后有无空格）
- 机场侧改命名（机型/地区/编号变化）

每次变化都会让 `store-selected` 的 key 失效。

### 6.4 修复方案：解耦「手动选择」与「自动回落」

恢复手动组，并让 `Main Proxy` 的 `proxies[0]` 指向它：

```yaml
- name: 🌏️Main Proxy
  type: select
  include-all-proxies: true
  proxies:
    - "✋Manual Select"    # ← proxies[0]，回落目标
    - "♾️Auto Select"
    - "⚖Load Balance"
    - "DIRECT"
    - "REJECT"

- name: ✋Manual Select
  type: select
  include-all-proxies: true
```

**为什么有效**：

| | 修复前 | 修复后 |
|---|---|---|
| `Main Proxy` 回落目标 | `♾️Auto Select` | `✋Manual Select` |
| 后果 | 自动测速 → IP 乱跳 | 停在手动组内，落到具体节点 |

`Manual Select` 自身仍会因节点改名回落到首个节点，但**不会再跳到自动测速组** —— 这是关键改善。

### 6.5 命名说明

`✋Manual Select` 与 `♾️Auto Select` 构成 Auto/Manual 反义对，全英文，与其余 22 个组风格一致。

### 6.6 验证结果

```
Main Proxy    默认选中 = ✋Manual Select          ✅
Manual Select 默认选中 = 🇺🇸US-A100-XX-AAA-BBB-01    ✅
模拟节点改名后 Main Proxy 仍停在 ✋Manual Select  ✅
rules 段 68 条，改动前后 md5 一致                 ✅
```

---

## 七、已知遗留问题（未修复）

### 6.1 `main-handler.js` 漏传 `addFlagEmoji`

**现象**：订阅路径（`/profiles/{token}/{customId}`）与预览路径（`/api/subscription_nodes`）输出不一致 —— 预览无国旗，订阅有国旗。

**根因**：`main-handler.js` 构造 `builtinOptions` 时没有传 `addFlagEmoji`，导致 `url-to-clash.js:1600` 的 `options.addFlagEmoji !== false` 恒为 `true`：

```js
// url-to-clash.js:1600
options.addFlagEmoji !== false && ...
```

**当前不触发**：因为 `enableFlagEmoji: false` 已生效，且节点名本身已无国旗。**若将来重新打开国旗，此 bug 会立刻复现。**

**修复**（需提 PR 到上游 `imzyb/MiSub`）：

```diff
  const builtinOptions = {
      ...resolveBuiltinRequestOptions({...}),
+     addFlagEmoji: effectiveNodeTransform.addFlagEmoji,
      fileName: subName,
```

**注意**：本 fork（`Guislabert/MiSub`）的 `.github/workflows/fork-sync.yml` 每天用 `git reset --hard upstream/main` + `push --force` 镜像上游，**直接改 fork 的 `main` 会被次日覆盖**。必须走上游 PR，或改同步策略为 `merge`。

### 6.2 `removeFlagEmoji` 是死代码

`subscription-service.js` 里 `removeFlagEmoji` 被 import 但未使用。URL 参数 `emoji=false` 因此无效。

---

## 八、已修正的错误说法

以下位置曾把根因描述为"mihomo 按内部 map 乱序展开"，**这是错的**，已全部更正：

| 文件 | 原说法 | 更正为 |
|---|---|---|
| `CHANGELOG.md` v0.1.0 | "mihomo 按内部 map 顺序展开节点" | `slices.Sort` 按节点名字节序排序 |
| `templates/mihomo.yaml:305` | "节点排序跟随 `proxies:` 段（即 MiSub 生成顺序）" | 跟随 `slices.Sort(节点名)`，与 `proxies:` 段无关 |
| `templates/mihomo.yaml:315` | "显式列名保证客户端显示顺序与 `proxies:` 段一致" | 显式列名走 `getProxies()`，不经过 `slices.Sort` |
| `tools/sync-nodes.mjs:7` | "`include-all-proxies` 会按 mihomo 内部 map 顺序展开" | 按 `slices.Sort` 字节序展开 |

**为什么必须更正**：把根因写成"map 乱序"会让人以为顺序不可控、每次随机。实际上顺序**完全确定**，且可以通过**改节点名**精确控制 —— 这是完全不同的解决路径。

---

## 九、命名校验（`tools/check-node-names.mjs`）

排序既然完全由节点名决定，命名就是**唯一的安全边界**。命名一旦跑偏，
顺序立刻错且**不报错** —— 只会在客户端代理页里静默乱序。这个脚本把它变成硬失败。

### 9.1 契约

```
机型-地区-机房-城市-序号
^([A-Z]\d{3})-([A-Z]{2})-([A-Z]{3})-([A-Z]{3})-(\d+)$

A100-US-DMC-LAX-01
```

| 字段 | 正则 | 例 |
|---|---|---|
| 机型 | `[A-Z]\d{3}` | `A100` `B200` `G700` |
| 地区 | `[A-Z]{2}` | `US` `DE` `AU` `HK` |
| 机房 | `[A-Z]{3}` | `DMC` `OCI` `NCG` `AWS` `ZTN` `CLO` |
| 城市 | `[A-Z]{3}` | `LAX` `SJC` `NUE` `SYD` `HKG` `IAD` |
| 序号 | `\d+` | `01` `02` |

### 9.2 它查什么

| 检查 | 为什么 |
|---|---|
| 国旗 / emoji | 首字节 `0xF0` > 字母 `0x41`，会把 🇦🇺 排到最前 |
| 机型是否在前 | 地区前置会变成按国家分组，机型沦为次键 |
| 格式是否完整 | 缺字段无法解析，也无法用 `region` 排序键 |
| 重名 | mihomo 拒绝重复节点名，`store-selected` 的 key 也会失效 |
| 排序是否收敛 | MiSub 的 `localeCompare` 与 mihomo 的字节序必须给出同一顺序 |
| **已知前缀** | 直接指向要关的开关，见 9.2.1 |

#### 9.2.1 已知前缀诊断

MiSub 有两类前缀在**算子链之前**注入（`subscription-service.js:722`），
所以 `rename` 正则匹配不到，名字原样进入 `sort` —— 机型不在开头，契约失效。

| 前缀 | 开关 | 说明 |
|---|---|---|
| `手动节点 - ` | `prefixSettings.enableManualNodes` | `manualNodePrefix` 为空时回退到这个默认文案 |
| `1. ` / `2. ` … | `prefixSettings.prependGroupName` | 按分组名加序号 |

命中时脚本不报「机型不在开头」，而是直接给出开关名：

```
✖ 带前缀「手动节点 -」  13 个
    → prefixSettings.enableManualNodes 为 true（manualNodePrefix 为空时回退到「手动节点」）
      —— 在该订阅组设置里关闭
      手动节点 - D400-US-OCI-SJC-01
      手动节点 - D400-US-OCI-SJC-02
      … 还有 11 个
```

**实测事故（2026-11-11）**：某订阅的 `enableManualNodes` 为 `true`，
其余 4 个组为 `false`，13 个节点全部带前缀。关闭后重拉，校验通过。

> 结论：**「手动节点前缀」与「命名契约」在机制上互斥**。
> 要排序可控，就必须关掉 `enableManualNodes` / `prependGroupName`。

### 9.3 用法

```bash
# 拉真实订阅
node tools/check-node-names.mjs "https://your-misub.pages.dev/fasciculus/<customId>?clash=meta"

# 校验本地 yaml，并断言节点总数
node tools/check-node-names.mjs --file sub.yaml --expect 31

# npm script
npm run check:nodes -- --file sub.yaml --expect 31
```

退出码：`0` 合规 / `1` 发现违规 / `2` 参数或拉取失败。

### 9.4 CI 接入

`.github/workflows/ci.yml` 里两个步骤：

| 步骤 | 触发条件 | 数据源 |
|---|---|---|
| `Node naming contract` | 每次 push / PR | 本地 fixture（无网络、无凭证） |
| `Node naming contract (live)` | 仅 push 到 main | 真实订阅（需 `MISUB_URL` + `MISUB_PROFILE_ID` secrets） |

fixture 步骤保证**任何 PR 都不能把命名改坏**；live 步骤保证 **MiSub 后台改坏了能被发现**。
后者未配 secrets 时自动跳过，不影响 fork。

---

## 十、排查清单

客户端节点顺序不对时，按顺序检查：

0. **先跑 `npm run check:nodes -- --file <订阅yaml>`** —— 命名问题、重名、排序不收敛三项一次查完
1. **模板是不是真的 YAML？** 粘贴进「自定义规则模板」会被强制当 ini 解析，内容全部丢弃。
   必须用远程 URL 且扩展名 `.yaml`。见 [`TEMPLATE-FORMAT.md`](./TEMPLATE-FORMAT.md) 第三节
2. **节点名是否带 emoji？** 带 → `slices.Sort` 会按 emoji 码位分组，先去掉 emoji
3. **MiSub `enableFlagEmoji` 是否为 `false`？** 否则 `addFlagEmoji()` 会加回
4. **每个 profile 的 `nodeTransform.addFlagEmoji` 是否为 `false`？** 组级优先级高于全局，只关全局不管用
5. **MiSub 算子链是否 `rename → sort → dedup`？** `dedup` 在 `sort` 之前会打乱顺序
6. **`sort` 算子的 `nameIgnoreEmoji` 是否为 `true`？**
7. **客户端是否缓存了旧配置？** 删订阅重加，或清缓存
8. **节点是否真的存在？** 以 MiSub 后台实际节点为准

手动选定的节点被重置时，按顺序检查：

1. **节点名是否变了？** 国旗开关、`flagEmojiSeparator`、机场改命名都会让 `store-selected` 的 key 失效（见第六节）
2. **`Main Proxy` 的 `proxies[0]` 是什么？** 若是 `♾️Auto Select`，回落即变自动测速
3. **`✋Manual Select` 组是否存在？** 存在则手动选在它里面，不要直接在 `Main Proxy` 里选
4. **`profile.store-selected` 是否为 `true`？** 否则重启即丢

---

## 参考

- mihomo `config/config.go` v1.19.2 — `parseProxies()` L820-937，`slices.Sort(AllProxies)` L892
- mihomo `adapter/outboundgroup/parser.go` v1.19.2 — `ParseProxyGroup()` L48-185，`include-all-proxies` L74-94
- MiSub `functions/utils/node-transformer.js` — `makeComparator()` 排序引擎
- MiSub `functions/utils/url-to-clash.js:1600` — `addFlagEmoji` 注入点
- MiSub `functions/modules/main-handler.js` — 订阅组输出链路
- MiSub `functions/modules/subscription-service.js` — `shouldKeepEmoji` / `addFlagEmoji` 链路
- `tools/check-node-names.mjs` — 命名契约校验（本仓库）
- `tools/check-node-names.test.mjs` — 20 项单元测试（本仓库）
- [`TEMPLATE-FORMAT.md`](./TEMPLATE-FORMAT.md) — ini vs YAML 格式选择（本仓库）
