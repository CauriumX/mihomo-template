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
[![Version](https://img.shields.io/badge/Version-0.1.2-4285F4.svg)][tags]
[![License: MIT](https://img.shields.io/badge/License%3A%20MIT-FBBC05.svg)][osi]

</div>

<h1 align="center">mihomo-template</h1>

<div align="center">

> Subscription template source, pinned and kernel-verified.

</div>

> [!NOTE]
> Every check in this repository runs against a real mihomo binary, not a schema.
> A YAML linter accepts an illegal enum value; the kernel does not.

<div align="center">

English | [简体中文](README.zh-CN.md)

</div>

---

## Why

A mihomo template is not a config file you write once. It is the routing table
every client reads at start-up, and it is referenced by URL from a release
repository. Change a provider path or a group name and every subscriber breaks,
silently, on their next restart.

This repository holds the source of that template, under conditions that make
breakage detectable before it ships.

## What

The template source for the mihomo rules pipeline:

- **24 proxy groups**, all using `include-all-proxies: true`
- **27 rule-providers**, every URL carrying `{{RULES_VERSION}}` instead of a live ref
- **85 rules**, ordered so that rejects and subscription updates run first

It does not publish. Rendering and release happen in
[mihomo-apply](https://github.com/CauriumX/mihomo-apply).

## Structure

```
templates/mihomo.yaml      template source, version placeholders
tools/render-check.mjs     inject placeholder nodes, then load in mihomo
tools/sync-nodes.mjs       regenerate explicit proxy lists from a live profile
docs/NODE-ORDERING.md      how mihomo orders nodes, measured not assumed
docs/TEMPLATE-FORMAT.md    ini versus YAML, measured
```

## Quick start

Verify locally before pushing. Every command below also runs in CI.

```sh
# 1. Structure: top-level keys, undefined groups, undefined providers
python3 -c "import yaml; d=yaml.safe_load(open('templates/mihomo.yaml')); print(len(d['proxy-groups']), len(d['rule-providers']), len(d['rules']))"

# 2. Version contract: every ruleset URL must use {{RULES_VERSION}}
grep -c '@{{RULES_VERSION}}/' templates/mihomo.yaml

# 3. Load in a real kernel — the only check that catches illegal enum values
node tools/render-check.mjs templates/mihomo.yaml --out /tmp/rendered.yaml
mihomo -t -d /tmp -f /tmp/rendered.yaml
```

## Design rules

**Version placeholders, never a live ref.** A template pinned to `@main` while
its rulesets drift is an incompatibility that produces no error — only a wrong
routing table. The placeholder is replaced at release time, so template and
rulesets always ship at one tag.

**`mrs` does not support `DOMAIN-KEYWORD`.** mihomo's `domainStrategy.Insert()`
treats the whole line as a literal domain and ignores the prefix. The 14 keyword
rules that matter (Crypto and PayPal) are inlined in `rules:`, before the
matching `RULE-SET`.

**Subscription domains route direct.** `cdn.jsdelivr.net`, `jsdelivr.net`, and
`pages.dev` are the first three rules. A client updating its subscription sends
that request through this same routing table; if the request proxy fails, the
client can never fetch a working config again.

**Node order is decided by the kernel, not by declaration.** mihomo sorts by
node name. Names must therefore be sortable without a flag emoji prefix —
`A100-US-...` orders correctly, `🇺🇸A100-...` does not.

## Adopting

The template depends on mihomo features (`include-all-proxies`, `mrs` format).
It works without MiSub, at the cost of filling `proxies:` by hand.

Before editing `rules:`, read `docs/NODE-ORDERING.md`. The ordering is measured
against the kernel, not inferred from the config.

## Feedback

Issues and PRs are welcome. For a routing mistake, include the domain and the
group it landed in. For an ordering complaint, include the full proxy list as
the client shows it — the cause is usually a name that does not sort as expected.

## License

MIT © CauriumX

[ci]: https://github.com/CauriumX/mihomo-template/actions
[tags]: https://github.com/CauriumX/mihomo-apply/tags
[osi]: https://opensource.org/licenses/MIT