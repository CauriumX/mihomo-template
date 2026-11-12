import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractProxyNames, isProxyNode, rewriteTemplate } from '../tools/sync-nodes.mjs';

const SAMPLE_SUB = `port: 7890
proxies:
  - name: "🇺🇸A100-XX-AAA-BBB-01"
    type: vless
    server: a.example.com
    port: 443
  - name: "🇪🇸B200-YY-CCC-DDD-01"
    type: vless
    server: b.example.com
    port: 443
proxy-groups:
  - name: 🌏️Main Proxy
    type: select
`;

test('extractProxyNames 保持订阅原始顺序', () => {
    const names = extractProxyNames(SAMPLE_SUB);
    assert.deepEqual(names, ['🇺🇸A100-XX-AAA-BBB-01', '🇪🇸B200-YY-CCC-DDD-01']);
});

test('extractProxyNames 在 proxies 段结束后停止', () => {
    const names = extractProxyNames(SAMPLE_SUB);
    // proxy-groups 里的 name 不应被当作节点
    assert.ok(!names.includes('🌏️Main Proxy'));
});

test('extractProxyNames 处理空 proxies', () => {
    assert.deepEqual(extractProxyNames('proxies: []\nproxy-groups:\n'), []);
});

test('isProxyNode 排除组引用与内置策略', () => {
    const groups = new Set(['🌏️Main Proxy', '♾️Auto Select']);
    assert.equal(isProxyNode('DIRECT', groups), false);
    assert.equal(isProxyNode('REJECT', groups), false);
    assert.equal(isProxyNode('♾️Auto Select', groups), false);
    assert.equal(isProxyNode('🇺🇸A100-XX-AAA-BBB-01', groups), true);
});

const TEMPLATE = `proxies: []
proxy-groups:
  - name: 🌏️Main Proxy
    type: select
    include-all-proxies: true
    proxies:
      - ♾️Auto Select
      - DIRECT
      - REJECT

  - name: ♾️Auto Select
    type: url-test
    include-all-proxies: true
    url: https://cp.cloudflare.com

  - name: ⚖Load Balance
    type: load-balance
    include-all-proxies: true
    url: https://cp.cloudflare.com
`;

test('rewriteTemplate 把 select 组的 include-all 换成显式节点', () => {
    const { text, changed } = rewriteTemplate(TEMPLATE, ['N1', 'N2']);
    assert.equal(changed, 1);
    const mainBlock = text.split('  - name: ♾️Auto Select')[0];
    assert.ok(!/include-all-proxies/.test(mainBlock), 'select 组不应再有 include-all');
    assert.ok(text.includes('      - "N1"'));
    assert.ok(text.includes('      - "N2"'));
});

test('rewriteTemplate 保留组引用与 DIRECT/REJECT', () => {
    const { text } = rewriteTemplate(TEMPLATE, ['N1']);
    assert.ok(text.includes('      - "♾️Auto Select"'));
    assert.ok(text.includes('      - "DIRECT"'));
    assert.ok(text.includes('      - "REJECT"'));
});

test('rewriteTemplate 不动 load-balance 组', () => {
    const { text } = rewriteTemplate(TEMPLATE, ['N1']);
    const lb = text.split('⚖Load Balance')[1];
    assert.ok(lb.includes('include-all-proxies: true'), 'load-balance 应保留 include-all');
});

test('rewriteTemplate 幂等：重复执行结果不变', () => {
    const once = rewriteTemplate(TEMPLATE, ['N1', 'N2']).text;
    const twice = rewriteTemplate(once, ['N1', 'N2']).text;
    assert.equal(once, twice);
});

test('rewriteTemplate 节点变更后正确替换', () => {
    const once = rewriteTemplate(TEMPLATE, ['N1', 'N2']).text;
    const updated = rewriteTemplate(once, ['X1']).text;
    assert.ok(updated.includes('      - "X1"'));
    assert.ok(!updated.includes('      - "N1"'));
    assert.ok(!updated.includes('      - "N2"'));
});

test('真实模板：所有 select 组节点数一致', () => {
    const real = readFileSync('templates/mihomo.yaml', 'utf8');
    const nodes = extractProxyNames(
        'proxies:\n' + Array.from({ length: 30 }, (_, i) => `  - name: "N${i + 1}"\n    type: vless\n`).join('')
    );
    assert.equal(nodes.length, 30);

    const { text } = rewriteTemplate(real, nodes);
    const selectBlocks = text.split(/\n  - name: /).slice(1).filter((b) => /^    type: select/m.test(b));
    assert.ok(selectBlocks.length > 0, '应找到 select 组');
    for (const b of selectBlocks) {
        const count = (b.match(/^      - "N\d+"$/gm) || []).length;
        assert.equal(count, 30, `每组应有 30 个节点，实际 ${count}`);
    }
});
