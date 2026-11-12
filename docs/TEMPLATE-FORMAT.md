# ini vs YAML 模板格式对比

**结论日期**：2026-11-11
**验证对象**：MiSub（`imzyb/MiSub`）+ mihomo v1.19.2
**起因**：MiSub 内置模板与第三方模板的组名带国旗（`🇺🇸 美国节点`），
而本仓库 YAML 的组名是服务图标（`🤖AI`）。怀疑国旗与模板格式绑定。

> **配套阅读**：[`NODE-ORDERING.md`](./NODE-ORDERING.md) 讲节点**顺序**为何由
> 节点名决定（mihomo `slices.Sort` vs MiSub 算子链）；本文讲**格式选择**
> 为何是 YAML。两者共同构成模板的技术契约：
> **格式定能力边界，命名定排序结果。**

---

## 摘要

| 问题 | 结论 |
|---|---|
| 国旗必须用 ini 吗？ | ❌ **不需要**。国旗是组名里的普通字符，YAML 一样能写 |
| YAML 能按地区分组吗？ | ✅ 能。`filter` 正则，已用真实 mihomo 实测 |
| ini 有什么 YAML 没有的？ | 只有 `<%regionStrategyChain%>` 自动生成地区组 |
| 改 ini 的代价 | ❌ **丢失 `dns` / `sniffer` / `tun` 三个整段** + `.mrs` 规则集 |
| 本仓库选择 | **保留 YAML**，不加地区组（24 个服务组已覆盖实际场景） |

---

## 一、国旗的来源：组名，不是节点名

实测：同一个节点源（31 个），只把模板从 YAML 换成 MiSub 内置
`clash_misub_minimal`（ini 格式）。

**节点名（`proxies:` 段）—— 无国旗：**

```
A100-US-DMC-LAX-01
A100-US-DMC-LAX-02
B200-US-OCI-SJC-01
```

**组名（`proxy-groups:` 段）—— 有国旗：**

> 下表是 **MiSub 内置 ini 模板 `clash_misub_minimal`** 的输出。
> 注意与第二节 YAML `filter` 实测的成员数（16/5/5/5）**不同** ——
> 两者是不同实验：内置模板按 `/美\|US\|America/i` 等宽松正则匹配，
> 会把 `⚡️ 美国 - 自动测速` 组自身也算进去，所以多 1；
> YAML `filter` 用 `-US-` 精确匹配节点名第 2 段，不误匹配。

```
🇺🇸 美国节点              select    17 个
🇩🇪 德国节点              select     6 个
🇦🇺 澳洲节点              select     6 个
🇭🇰 香港节点              select     6 个
⚡️ 🇺🇸 美国 - 自动测速     url-test  16 个
```

国旗来自 `functions/modules/subscription/region-groups.js:2` 的硬编码表：

```js
const REGION_DISPLAY_CONFIG = {
    香港: { flag: '🇭🇰', name: '香港节点' },
    美国: { flag: '🇺🇸', name: '美国节点' },
    澳洲: { flag: '🇦🇺', name: '澳洲节点' },
    // …共 17 个地区
};
```

ini 模板里的 `<%regionStrategyChain%>` 占位符在渲染时展开成
`🇺🇸 美国节点, 🇩🇪 德国节点, …`。

**关键**：这些国旗是 MiSub 拼到**组名**上的，与 `enableFlagEmoji`
（只管**节点名**）是两个独立机制。

---

## 二、YAML 里写国旗：直接用即可

国旗是 UTF-8 字符，YAML 的字符串完全支持。本仓库模板里已经有 emoji 组名：

```yaml
  - name: 🤖AI
  - name: 🔍Google
  - name: 🎥Netflix
  - name: 💰Crypto
```

换成国旗同理：

```yaml
  - name: 🇺🇸 美国节点
    type: select
    include-all-proxies: true
    filter: "-US-"
```

### 2.1 `filter` 实测

用真实 mihomo v1.19.2 加载 31 个节点 + 4 个地区组：

```yaml
proxy-groups:
  - name: 🇺🇸 美国节点
    type: select
    include-all-proxies: true
    filter: "(US-|America|美国)"
  - name: 🇩🇪 德国节点
    type: select
    include-all-proxies: true
    filter: "(DE-|Germany|德国)"
  - name: 🇦🇺 澳洲节点
    type: select
    include-all-proxies: true
    filter: "(AU-|Australia|澳洲)"
  - name: 🇭🇰 香港节点
    type: select
    include-all-proxies: true
    filter: "(HK-|Hong Kong|香港)"
```

`/proxies` API 实测结果：

| 组 | 成员数 | 首项 |
|---|---|---|
| 🇺🇸 美国节点 | 16 | `A100-US-DMC-LAX-01` |
| 🇩🇪 德国节点 | 5 | `C300-DE-NCG-NUE-01` |
| 🇦🇺 澳洲节点 | 5 | `E500-AU-AWS-SYD-01` |
| 🇭🇰 香港节点 | 5 | `F600-HK-ZTN-HKG-01` |

数量与节点分布完全吻合（美国 A100 5 + B200 5 + D400 5 + G700 1 = 16）。

### 2.2 filter 正则的写法建议

节点名格式是 `机型-地区-机房-城市-序号`，地区代码是第 2 段。
用**带连字符**的模式更安全：

| 写法 | 问题 |
|---|---|
| `US` | 会误匹配 `RUSSIA`、`AUS` 等 |
| `-US-` | ✅ 精确匹配第 2 段 |
| `(US-\|America\|美国)` | 兼容多种命名风格，节点改名后仍有效 |

---

## 三、两种格式的机制差异

### 3.1 渲染路径不同

`functions/modules/subscription/main-handler.js:517`：

```js
export function shouldRenderClashYamlProfileTemplateLocally({
    isExternalMode, targetFormat, templateSource,
}) {
    if (!isExternalMode || targetFormat !== 'clash' || templateSource?.kind !== 'remote')
        return false;
    try {
        const parsed = new URL(String(templateSource.value || '').trim());
        return /\.ya?ml$/i.test(parsed.pathname);   // ← .yaml 走本地渲染
    } catch { … }
}
```

`functions/services/processor-service.js:38`：

```js
export function isIniTemplateSource(templateSource, builtinTemplateEntry = null) {
    if (builtinTemplateEntry?.format === 'ini') return true;
    if (templateSource?.kind === 'custom') return true;   // ← 粘贴的模板强制当 ini
    return getTemplateExtension(templateSource?.value) === 'ini';
}
```

| 模板来源 | 判定 | 渲染方式 |
|---|---|---|
| 远程 URL 且扩展名 `.yaml` / `.yml` | YAML | MiSub 本地渲染，组定义静态保留 |
| 远程 URL 且扩展名 `.ini` | ini | 交给 subconverter / ini pipeline 展开 |
| 「自定义规则模板」粘贴内容 | **强制 ini** | 即使内容是 YAML 也会被当 ini 解析，全部丢弃 |

> ⚠️ 这就是模板头部注释强调「必须用远程模板 URL 且扩展名 `.yaml`」的原因。

### 3.2 能力对比

| | YAML | ini |
|---|---|---|
| 组定义 | 静态写死在文件里 | `custom_proxy_group=` 指令，subconverter 展开 |
| 地区分组 | 自己写 `filter` 正则 | `<%regionStrategyChain%>` 自动展开地区组 |
| 节点注入 | `include-all-proxies: true` 或显式列名 | `.*` 正则匹配全部 |
| **`dns` 段** | ✅ 完整支持 | ❌ **不存在** |
| **`sniffer` 段** | ✅ 完整支持 | ❌ **不存在** |
| **`tun` 段** | ✅ 完整支持 | ❌ **不存在** |
| 规则集格式 | `.mrs`（二进制，体积小） | 只能 `.list`（文本） |
| 加载校验 | `mihomo -t` 直接验 | 需经 subconverter，出错难定位 |
| 可控性 | 完全可控，每个字段都能写 | 受 ini 语法限制 |

### 3.3 三个不可接受的损失

**1. `dns` 段**

本仓库模板有完整的 DNS 配置：`fake-ip` 模式、`nameserver-policy` 按域名分流、
`fake-ip-filter` 28 条 real-ip 规则、`proxy-server-nameserver` 防泄漏。
ini 格式没有这个段，subconverter 会直接丢弃。

**2. `sniffer` 段**

```yaml
sniffer:
  enable: true
  force-dns-mapping: true
  parse-pure-ip: true
  override-destination: true
  sniff:
    HTTP: { ports: [80, 8080-8880] }
    TLS:  { ports: [443, 8443] }
    QUIC: { ports: [443, 8443] }
```

没有 sniffer，**纯 IP 连接无法还原域名**，所有基于域名的规则（AI / Netflix /
Google 分流）对这类连接全部失效。

**3. `tun` 段**

```yaml
tun:
  enable: true
  stack: system
  auto-route: true
  device: DsotM-Tunnel
  route-exclude-address: [10.0.0.0/8, 100.64.0.0/10, …]
```

没有 tun，桌面端无法做全局透明代理。

---

## 四、ini 的唯一优势

`<%regionStrategyChain%>` 会按**实际匹配到的地区**自动生成地区组，不需要手写。

MiSub 的 `REGION_DISPLAY_CONFIG` 定义了 17 个地区（`region-groups.js:2`），
但 `groupNodeLinesByRegion()` 只为**有节点命中的**地区建组 —— 空地区不生成。
本仓库节点只有 4 个地区，所以内置模板实际只生成 4 个地区组
（实测：总 30 组，其中地区相关 9 个 = 4 个 select + 4 个测速 + `🚀 节点选择`）。

但这个优势可以用 YAML 的 `filter` 完全复现（见第二节实测），而且更精确：

| | ini 自动分组 | YAML filter |
|---|---|---|
| 匹配依据 | `/美\|US\|America/i` 等 13 条内置正则 | 自己写的正则 |
| 精确度 | 会误匹配（`US` 命中 `RUSSIA`） | 可用 `-US-` 精确到段 |
| 可定制 | 改不了（除非改 MiSub 源码） | 随时改 |
| 空组处理 | 只生成有节点命中的地区 | 只写需要的 |

---

## 五、本仓库的决定

**保留 YAML，不加地区组。**

### 5.1 为什么不加地区组

节点只有 4 个地区（US / DE / AU / HK），而现有 24 个**服务组**已经覆盖实际场景：

```
🤖AI  🔍Google  🎥Netflix  🎬Disney  📺Twitch  💬Twitter
✈️Telegram  🎮Steam  💳PayPal  💰Crypto  …
```

日常使用关心的是「这个网站走不走代理」，而不是「走美国还是德国」。
地区组是冗余维度。

### 5.2 如果以后要加

写法已验证，直接插入 `proxy-groups` 段（建议放在 `✋Manual Select` 之后、
服务组之前）：

```yaml
  - name: 🇺🇸 美国节点
    type: select
    include-all-proxies: true
    filter: "-US-"
    proxies:
      - "🌏️Main Proxy"
      - "♾️Auto Select"
      - "⚖Load Balance"
      - "DIRECT"

  - name: 🇩🇪 德国节点
    type: select
    include-all-proxies: true
    filter: "-DE-"
```

**注意**：`include-all-proxies: true` 与 `filter` 可以共存 —— `filter` 在
`AllProxies` 展开后做正则筛选（`parser.go:74-94`），顺序仍由
`slices.Sort` 决定，不影响节点排序契约。

> 排序契约的完整说明（字节序、国旗 emoji 的影响、命名校验脚本）见
> [`NODE-ORDERING.md`](./NODE-ORDERING.md)。

---

## 六、排查：为什么我的模板不生效

按顺序检查：

1. **模板是不是粘贴进去的？** `kind === 'custom'` 强制当 ini 解析，
   YAML 内容会被全部丢弃。必须用远程 URL。
2. **URL 扩展名是不是 `.yaml` / `.yml`？** 否则走 ini 路径。
3. **jsDelivr 缓存？** 用 `@<commit>` 锁定，不要用 `@main`。
   见 `tools/misub-lock.mjs`。
4. **`mihomo -t` 报错？** 本地先跑 `node tools/render-check.mjs` + `mihomo -t`。
5. **节点顺序不对？** 不是格式问题，是命名问题 —— 见
   [`NODE-ORDERING.md`](./NODE-ORDERING.md) 第十节排查清单。

---

## 参考

- MiSub `functions/modules/subscription/region-groups.js` — 17 个地区国旗配置
- MiSub `functions/modules/subscription/builtin-template-registry.js` — 6 个内置 ini 模板
- MiSub `functions/modules/subscription/main-handler.js:517` — `shouldRenderClashYamlProfileTemplateLocally`
- MiSub `functions/services/processor-service.js:38` — `isIniTemplateSource`
- mihomo `adapter/outboundgroup/parser.go:74-94` — `include-all-proxies` + `filter` 展开
- 本仓库 `docs/NODE-ORDERING.md` — 节点排序机制（配套文档）
- 本仓库 `templates/mihomo.yaml` — 24 个服务组
