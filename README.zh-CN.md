<div align="center">

<a href="https://github.com/CauriumX/mihomo-template">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/hero-dark.svg">
    <img alt="mihomo-template" src="assets/hero-light.svg" width="1640">
  </picture>
</a>

</div>

<div align="center">

[![CI](https://img.shields.io/badge/CI-passing-34A853.svg)][ci]
[![版本](https://img.shields.io/badge/版本-0.1.2-4285F4.svg)][tags]
[![License: MIT](https://img.shields.io/badge/License%3A%20MIT-FBBC05.svg)][osi]

</div>

<h1 align="center">mihomo-template</h1>

<div align="center">

> 订阅模板源，版本锁定并经内核校验。

</div>

> [!NOTE]
> 本仓库的每项检查都跑在真实的 mihomo 二进制上，不是 schema。YAML linter 会放过一个
> 非法的枚举值；内核不会。

<div align="center">

[English](README.md) | 简体中文

</div>

---

## 为什么

mihomo 模板不是写一次就完的配置文件。它是每个客户端启动时读取的路由表，而且被发布仓通过 URL 引用。改一个 provider 路径或组名，所有订阅者会在下次重启时失效 —— 静默地。

本仓库持有这份模板的源文件，并让破坏在发布前就能被检出。

## 是什么

mihomo 规则体系的模板源：

- **24 个代理组**，全部使用 `include-all-proxies: true`
- **27 个规则提供者**，每个 URL 携带 `{{RULES_VERSION}}` 而不是活的 ref
- **85 条规则**，顺序保证拦截与订阅更新先执行

本仓库不发布。渲染与发布在 [mihomo-apply](https://github.com/CauriumX/mihomo-apply) 完成。

## 目录

```
templates/mihomo.yaml      模板源，含版本占位符
tools/render-check.mjs     注入占位节点，再交给 mihomo 加载
tools/sync-nodes.mjs       从实际 profile 重新生成显式节点列表
docs/NODE-ORDERING.md      mihomo 如何排序节点，实测而非推断
docs/TEMPLATE-FORMAT.md    ini 与 YAML 对比，实测
```

## 快速开始

推送前先在本地校验。下面每条命令在 CI 里也会跑。

```sh
# 1. 结构：顶层键、未定义的组、未定义的 provider
python3 -c "import yaml; d=yaml.safe_load(open('templates/mihomo.yaml')); print(len(d['proxy-groups']), len(d['rule-providers']), len(d['rules']))"

# 2. 版本契约：每个规则集 URL 都必须用 {{RULES_VERSION}}
grep -c '@{{RULES_VERSION}}/' templates/mihomo.yaml

# 3. 真实内核加载 —— 唯一能抓到非法枚举值的检查
node tools/render-check.mjs templates/mihomo.yaml --out /tmp/rendered.yaml
mihomo -t -d /tmp -f /tmp/rendered.yaml
```

## 设计约束

**用版本占位符，不用活的 ref。** 模板锁在 `@main` 而规则集漂移，是一种不产生任何报错的不兼容 —— 只有一张错的路由表。占位符在发布时被替换，所以模板与规则集永远同一个 tag。

**`mrs` 不支持 `DOMAIN-KEYWORD`。** mihomo 的 `domainStrategy.Insert()` 把整行当字面量域名，忽略前缀。真正生效的 14 条关键词规则（Crypto 与 PayPal）内联在 `rules:` 里，位置在对应的 `RULE-SET` 之前。

**订阅域名走直连。** `cdn.jsdelivr.net`、`jsdelivr.net`、`pages.dev` 是前三条规则。客户端更新订阅时，这个请求走的就是这张路由表；如果请求用的代理失效，客户端就再也拉不到可用的配置。

**节点顺序由内核决定，不由声明顺序。** mihomo 按节点名排序。因此名字必须可排序且不带国旗前缀 —— `A100-US-...` 顺序正确，`🇺🇸A100-...` 不正确。

## 采纳

模板依赖 mihomo 的特性（`include-all-proxies`、`mrs` 格式）。不用 MiSub 也能工作，代价是手工填 `proxies:`。

编辑 `rules:` 之前请先读 `docs/NODE-ORDERING.md`。那里的排序结论是对着内核实测的，不是从配置推断的。

## 反馈

欢迎 issue 与 PR。分流错误请附域名和它落到的组。排序问题请附客户端显示的完整节点列表 —— 原因通常是一个排序不如预期的名字。

## License

MIT © CauriumX

[ci]: https://github.com/CauriumX/mihomo-template/actions
[tags]: https://github.com/CauriumX/mihomo-apply/tags
[osi]: https://opensource.org/licenses/MIT