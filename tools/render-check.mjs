#!/usr/bin/env node
/**
 * render-check.mjs — 把模板渲染成 mihomo 可加载的完整配置
 *
 * 用途：
 *   模板的 proxies: [] 是空的（由 MiSub 注入节点），直接交给 mihomo -t
 *   会因 select 组引用不存在的节点而失败。本脚本注入占位节点，
 *   让 mihomo 能真正完成加载期校验。
 *
 * 这是 CI 的关键一环：结构断言只能查 key 是否存在，
 * 查不出非法枚举值（如 fake-ip-filter-mode: rule）、组名拼错、
 * provider behavior 与文件格式不匹配这类加载期错误。
 *
 * 用法：
 *   node tools/render-check.mjs [模板路径] > rendered.yaml
 *   node tools/render-check.mjs [模板路径] --out rendered.yaml
 *
 * 退出码：
 *   0  渲染成功
 *   1  模板解析失败 / 组引用了不存在的节点且无法补全
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

const BUILTIN = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE']);

/** 极简 YAML 读取：只解析本模板用到的结构，避免引入依赖 */
export function parseTemplate(text) {
    const lines = text.split('\n');
    const groups = [];
    const proxies = [];

    let section = null;
    let current = null;

    for (const raw of lines) {
        const line = raw.replace(/\t/g, '  ');
        const trimmed = line.trim();

        // 顶层键
        if (/^[a-zA-Z-]+:/.test(line)) {
            const key = line.split(':')[0];
            if (key === 'proxy-groups' || key === 'proxies') {
                section = key;
                current = null;
                continue;
            }
            if (!line.startsWith(' ')) {
                section = null;
                current = null;
            }
            continue;
        }

        if (!section) continue;

        // 列表项起始 "- name: xxx"
        const nameMatch = trimmed.match(/^-\s+name:\s*(.+?)\s*$/);
        if (nameMatch) {
            current = { name: unquote(nameMatch[1]), proxies: [], includeAll: false };
            (section === 'proxy-groups' ? groups : proxies).push(current);
            continue;
        }

        if (!current) continue;

        // 组的 include-all-proxies 标记（节点由 mihomo 自动展开，无需列名）
        if (section === 'proxy-groups' && /^include-all-proxies:\s*true\s*$/.test(trimmed)) {
            current.includeAll = true;
            continue;
        }

        // proxies: 列表项（组内成员）
        const itemMatch = trimmed.match(/^-\s+(.+?)\s*$/);
        if (itemMatch && section === 'proxy-groups') {
            current.proxies.push(unquote(itemMatch[1]));
        }
    }

    return { groups, proxies };
}

function unquote(s) {
    s = s.trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

/** 收集所有被组引用、但不是组本身也不是内置策略的节点名 */
export function collectPlaceholderNodes(groups) {
    const groupNames = new Set(groups.map((g) => g.name));
    const needed = new Set();
    for (const g of groups) {
        for (const p of g.proxies) {
            if (BUILTIN.has(p) || groupNames.has(p)) continue;
            needed.add(p);
        }
    }
    return [...needed].sort();
}

/**
 * 占位节点名。
 * 模板改用 include-all-proxies 后，组内不再显式列名，渲染时无从得知节点名；
 * 但 mihomo 加载期仍需至少一个真实节点才能展开 include-all-proxies，
 * 否则组为空、校验也失去意义。故注入固定占位节点。
 */
export const PLACEHOLDER_NODE = '__render_check_placeholder__';

/** 生成占位 proxies: 段 */
export function buildProxiesBlock(names) {
    if (names.length === 0) return 'proxies: []\n';
    const body = names
        .map(
            (n) =>
                `  - name: "${n}"\n` +
                `    type: socks5\n` +
                `    server: 127.0.0.1\n` +
                `    port: 1080\n`
        )
        .join('');
    return `proxies:\n${body}`;
}

/** 把模板里的 proxies: [] 替换成占位节点 */
export function render(templateText) {
    const { groups } = parseTemplate(templateText);
    const names = collectPlaceholderNodes(groups);

    // 有组依赖 include-all-proxies 时，必须至少注入一个节点，
    // 否则 mihomo 展开后组内为空，无法完成加载期校验。
    if (names.length === 0 && groups.some((g) => g.includeAll)) {
        names.push(PLACEHOLDER_NODE);
    }

    const block = buildProxiesBlock(names);

    if (!/^proxies:\s*\[\]\s*$/m.test(templateText)) {
        throw new Error('模板中未找到 "proxies: []" 占位行，无法注入节点');
    }

    return {
        yaml: templateText.replace(/^proxies:\s*\[\]\s*$/m, block.trimEnd()),
        injected: names.length,
    };
}

function main() {
    const args = argv.slice(2).filter((a) => !a.startsWith('--'));
    const outIdx = argv.indexOf('--out');
    const outPath = outIdx !== -1 ? argv[outIdx + 1] : null;
    const tplPath = args[0] || 'templates/mihomo.yaml';

    let text;
    try {
        text = readFileSync(tplPath, 'utf8');
    } catch (e) {
        console.error(`无法读取模板: ${tplPath} — ${e.message}`);
        exit(1);
    }

    let result;
    try {
        result = render(text);
    } catch (e) {
        console.error(`渲染失败: ${e.message}`);
        exit(1);
    }

    if (outPath) {
        writeFileSync(outPath, result.yaml, 'utf8');
        console.error(`已写入 ${outPath}（注入 ${result.injected} 个占位节点）`);
    } else {
        stdout.write(result.yaml);
        console.error(`已渲染（注入 ${result.injected} 个占位节点）`);
    }
}

if (import.meta.url === `file://${argv[1]}`) {
    main();
}
