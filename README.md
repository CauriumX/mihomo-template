# mihomo-template

> Subscription template source, pinned and kernel-verified.

<div align="center">

[![CI](https://img.shields.io/badge/CI-passing-34A853.svg)][ci]
[![Version](https://img.shields.io/badge/Version-0.1.2-4285F4.svg)][tags]
[![License: MIT](https://img.shields.io/badge/License%3A%20MIT-FBBC05.svg)][osi]

</div>

## Why

A mihomo template is not a config file you write once. It is the routing table
every client reads at start-up, and it is referenced by URL from a release
repository. Change a provider path or a group name and every subscriber breaks,
silently, on their next restart.

This repository holds the source of that template, under conditions that make
breakage detectable before it ships: structure assertions, a version contract,
and a real kernel load.

## What

The template source for the mihomo rules pipeline:

- **24 proxy groups**, all using `include-all-proxies: true`
- **27 rule-providers**, every URL carrying `{{RULES_VERSION}}` instead of a
  live ref
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

Verify the template locally before pushing. Every check below also runs in CI.

```sh
# 1. Structure: top-level keys, undefined groups, undefined providers
python3 - <<'PY'
import yaml
d = yaml.safe_load(open('templates/mihomo.yaml'))
print(len(d['proxy-groups']), len(d['rule-providers']), len(d['rules']))
PY

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

## Adopting

The template depends on mihomo features (`include-all-proxies`, `mrs` format).
It works without MiSub, at the cost of filling `proxies:` by hand.

Before editing `rules:`, read `docs/NODE-ORDERING.md`. Node order is decided by
`mihomo`'s `slices.Sort` over node names, not by declaration order.

## License

MIT

[ci]: https://github.com/CauriumX/mihomo-template/actions
[tags]: https://github.com/CauriumX/mihomo-apply/tags
[osi]: https://opensource.org/licenses/MIT