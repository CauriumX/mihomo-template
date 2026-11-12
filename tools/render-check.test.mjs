import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    parseTemplate,
    collectPlaceholderNodes,
    buildProxiesBlock,
    render,
    PLACEHOLDER_NODE,
} from '../tools/render-check.mjs';

const SAMPLE = `proxies: []

proxy-groups:
  - name: 🌏️Main
    type: select
    proxies:
      - ♾️Auto
      - DIRECT
      - REJECT
      - 🇺🇸US-01
      - 🇪🇸ES-01
  - name: ♾️Auto
    type: url-test
    include-all-proxies: true
`;

test('parseTemplate 提取组名与成员', () => {
    const { groups } = parseTemplate(SAMPLE);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].name, '🌏️Main');
    assert.deepEqual(groups[0].proxies, ['♾️Auto', 'DIRECT', 'REJECT', '🇺🇸US-01', '🇪🇸ES-01']);
});

test('collectPlaceholderNodes 排除内置策略与组名', () => {
    const { groups } = parseTemplate(SAMPLE);
    const names = collectPlaceholderNodes(groups);
    assert.deepEqual(names, ['🇪🇸ES-01', '🇺🇸US-01']);
    assert.ok(!names.includes('DIRECT'));
    assert.ok(!names.includes('REJECT'));
    assert.ok(!names.includes('♾️Auto'), '组名不应被当成节点');
});

test('collectPlaceholderNodes 结果去重且有序', () => {
    const groups = [
        { name: 'A', proxies: ['🇺🇸US-01', '🇪🇸ES-01'] },
        { name: 'B', proxies: ['🇪🇸ES-01', '🇺🇸US-01'] },
    ];
    const names = collectPlaceholderNodes(groups);
    assert.equal(names.length, 2);
    assert.deepEqual(names, [...names].sort(), '应保持排序');
});

test('buildProxiesBlock 生成合法 socks5 占位节点', () => {
    const block = buildProxiesBlock(['🇺🇸US-01']);
    assert.match(block, /^proxies:\n/);
    assert.match(block, /name: "🇺🇸US-01"/);
    assert.match(block, /type: socks5/);
    assert.match(block, /server: 127\.0\.0\.1/);
});

test('buildProxiesBlock 空列表回退为 []', () => {
    assert.equal(buildProxiesBlock([]), 'proxies: []\n');
});

test('render 替换 proxies: [] 占位行', () => {
    const { yaml, injected } = render(SAMPLE);
    assert.equal(injected, 2);
    assert.ok(!/^proxies:\s*\[\]\s*$/m.test(yaml), '占位行应被替换');
    assert.match(yaml, /name: "🇺🇸US-01"/);
});

test('render 在缺少 proxies: [] 时抛错', () => {
    assert.throws(
        () => render('proxy-groups:\n  - name: A\n    type: select\n'),
        /未找到 "proxies: \[\]"/,
    );
});

test('render 幂等：对已渲染结果再跑不重复注入', () => {
    const once = render(SAMPLE).yaml;
    // 已渲染后 proxies: [] 不存在，应抛错而不是叠加
    assert.throws(() => render(once), /未找到 "proxies: \[\]"/);
});

test('真实模板：渲染后所有 select 组引用都能解析', () => {
    const tpl = readFileSync('templates/mihomo.yaml', 'utf8');
    const { yaml, injected } = render(tpl);
    // 模板已改用 include-all-proxies：组内不再显式列名，
    // 渲染器会注入至少一个占位节点供 mihomo 展开。
    assert.ok(injected > 0, '真实模板应注入占位节点');

    const { groups } = parseTemplate(yaml);
    const groupNames = new Set(groups.map((g) => g.name));
    const builtin = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);

    // 解析注入的节点名
    const proxyNames = new Set(
        [...yaml.matchAll(/^\s+- name: "(.+?)"$/gm)].map((m) => m[1]),
    );

    const unresolved = [];
    for (const g of groups) {
        for (const p of g.proxies) {
            if (builtin.has(p) || groupNames.has(p) || proxyNames.has(p)) continue;
            unresolved.push(`${g.name} → ${p}`);
        }
    }
    assert.deepEqual(unresolved, [], `未解析的引用: ${unresolved.join(', ')}`);
});

test('parseTemplate 识别 include-all-proxies 标记', () => {
    const { groups } = parseTemplate(SAMPLE);
    assert.equal(groups[0].includeAll, false);
    assert.equal(groups[1].includeAll, true);
});

test('render：仅靠 include-all-proxies 的模板也注入占位节点', () => {
    const tpl = `proxies: []\n\nproxy-groups:\n  - name: 🌏️Main\n    type: select\n    proxies:\n      - DIRECT\n      - REJECT\n    include-all-proxies: true\n`;
    const { yaml, injected } = render(tpl);
    assert.equal(injected, 1);
    assert.match(yaml, new RegExp(`- name: "${PLACEHOLDER_NODE}"`));
    assert.ok(!/^proxies:\s*\[\]\s*$/m.test(yaml), '占位行应被替换');
});
