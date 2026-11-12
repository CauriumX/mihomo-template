# CauriumX mihomo-template

> MiSub / mihomo 订阅模板。定义分流逻辑、代理组、规则引用，不含节点。

## 仓库定位

本仓库只维护模板源文件，不发布。发布由 [mihomo-apply](https://github.com/CauriumX/mihomo-apply) 完成。

```
mihomo-rules        ← 规则集产物
    │
mihomo-apply        ← 版本化发布（模板 + 规则集同版本）
    │
mihomo-template     ← 本仓库：模板源（含版本占位符）
```

## 模板结构

```yaml
proxy-groups:        24 个组，全部 include-all-proxies: true
rule-providers:      27 个，URL 使用 {{RULES_VERSION}} 占位符
rules:               68 条，按优先级排列
```

### 分流优先级

```
1.  本地网段          → DIRECT
2.  QUIC 443          → REJECT
3.  邮件端口          → DIRECT
4.  NTP / 局域网      → DIRECT
5.  系统连通性检测    → Main Proxy
6.  Google 服务       → 🔍Google
7.  AdGuard           → DIRECT
8.  googleapis        → 🔍Google
9.  本地进程          → DIRECT
10. 百度网盘上传      → REJECT
11. AD-Site           → REJECT
12. PayPal 钓鱼       → REJECT
13. AI-Site           → 🤖AI
14. …（服务分流）
15. China-Site        → 🇨🇳China Services
16. China-IP          → 🇨🇳China Services
17. MATCH             → Main Proxy
```

为什么这个顺序：AD 必须在所有分流之前（REJECT 优先）；AI 在大厂之前（copilot / meta.ai 归 AI 组）；国内在最后（范围最大）。

## 版本占位符

模板不写死版本：

```yaml
url: "https://cdn.jsdelivr.net/gh/CauriumX/mihomo-apply@{{RULES_VERSION}}/site/AI-Site.mrs"
```

`{{RULES_VERSION}}` 在发布时被替换成实际 tag（如 `v0.1.0`）。

这解决了旧架构的缺陷：模板锁 commit 但规则集漂 `@main`，两者可能不兼容。

## 文档

- [`docs/NODE-ORDERING.md`](docs/NODE-ORDERING.md) — 节点排序机制（mihomo 内核行为实证）
- [`docs/TEMPLATE-FORMAT.md`](docs/TEMPLATE-FORMAT.md) — ini vs YAML 格式对比

## 与 MiSub 的关系

模板依赖 MiSub 的节点注入，但模板本身是 mihomo 原生 YAML：

| MiSub 特性 | 用途 | 模板使用 |
|---|---|---|
| `include-all-proxies: true` | 节点注入 | 24 个组全部使用 |
| `filter` / `exclude-filter` | 组内过滤 | 未使用 |
| `addFlagEmoji` | 节点名国旗 | 模板侧不控制 |

即使不用 MiSub，模板也能工作 —— 只是节点需要手工填 `proxies:`。

## 校验

```sh
# 模板结构断言
python3 -c "import yaml; d=yaml.safe_load(open('templates/mihomo.yaml')); print(len(d['proxy-groups']), len(d['rule-providers']), len(d['rules']))"

# 版本占位符检查（在 mihomo-rules 仓库）
node tools/check-version-contract.mjs
```

## License

MIT
