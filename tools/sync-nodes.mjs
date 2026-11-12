#!/usr/bin/env node
/**
 * sync-nodes.mjs — 从 MiSub 订阅同步节点名到模板的 select 组
 *
 * 背景：
 *   模板的 21 个 select 组显式列出节点名，以保证客户端「代理」页显示顺序
 *   与 proxies: 段一致（include-all-proxies 会让 mihomo 用
 *   slices.Sort(AllProxies) 按节点名字节序重排，与声明顺序无关；
 *   显式列名走 getProxies() 不排序。详见 docs/NODE-ORDERING.md）。
 *
 *   显式列名的代价：节点增删改名后模板会失效（组里引用不存在的节点，
 *   mihomo 启动时报错）。本脚本从订阅拉取实际节点名，重写所有 select 组。
 *
 * 用法：
 *   node tools/sync-nodes.mjs <订阅URL> [模板路径]
 *   node tools/sync-nodes.mjs --file <本地yaml> [模板路径]
 *
 * 示例：
 *   node tools/sync-nodes.mjs "https://example.com/fasciculus/user-xxx?clash=meta"
 *   node tools/sync-nodes.mjs --file /tmp/sub.yaml
 *
 * 退出码：
 *   0  无变更或已更新
 *   1  参数错误 / 拉取失败 / 解析失败
 *   2  检测到变更但 --check 模式下不写入
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const DEFAULT_TEMPLATE = 'templates/mihomo.yaml';

/** 从 Clash YAML 文本中提取 proxies: 段的节点名，保持原顺序 */
export function extractProxyNames(yamlText) {
    const lines = yamlText.split('\n');
    const names = [];
    let inProxies = false;
    let proxiesIndent = -1;

    for (const line of lines) {
        if (!inProxies) {
            const m = line.match(/^(\s*)proxies:\s*$/);
            if (m) {
                inProxies = true;
                proxiesIndent = m[1].length;
            }
            continue;
        }
        // 退出条件：遇到缩进不大于 proxies 的非空行
        if (line.trim() === '') continue;
        const indent = line.match(/^(\s*)/)[1].length;
        if (indent <= proxiesIndent) break;

        const nm = line.match(/^\s*-\s*name:\s*(.+?)\s*$/);
        if (nm) {
            let n = nm[1];
            // 去掉 YAML 引号
            if ((n.startsWith('"') && n.endsWith('"')) || (n.startsWith("'") && n.endsWith("'"))) {
                n = n.slice(1, -1);
            }
            names.push(n);
        }
    }
    return names;
}

/** 判断是否为「代理节点」而非策略组引用（DIRECT/REJECT/组名） */
export function isProxyNode(name, groupNames) {
    if (groupNames.has(name)) return false;
    if (name === 'DIRECT' || name === 'REJECT' || name === 'PASS') return false;
    return true;
}

/**
 * 重写模板中所有 select 组的节点列表。
 * - select 组：保留原有非节点项（组引用 / DIRECT / REJECT），追加新节点列表
 * - load-balance / url-test 组：保持 include-all-proxies 不动
 */
export function rewriteTemplate(templateText, nodeNames) {
    const lines = templateText.split('\n');

    // 先收集所有组名，用于区分「组引用」与「节点」
    const groupNames = new Set();
    for (const line of lines) {
        const m = line.match(/^  - name:\s*(.+?)\s*$/);
        if (m) groupNames.add(m[1].replace(/^["']|["']$/g, ''));
    }

    const out = [];
    let i = 0;
    let changed = 0;

    while (i < lines.length) {
        const line = lines[i];
        const gm = line.match(/^  - name:\s*(.+?)\s*$/);

        if (!gm) {
            out.push(line);
            i++;
            continue;
        }

        // 收集整组（注释行归属下一个组，不纳入本组）
        let j = i + 1;
        while (j < lines.length) {
            const l = lines[j];
            if (/^  - name:/.test(l)) break;
            if (/^[a-zA-Z][\w-]*:/.test(l)) break;
            if (/^  #/.test(l)) break; // 组间注释：归属下一段
            j++;
        }
        const block = lines.slice(i, j);

        const typeLine = block.find((b) => /^    type:\s*\S+/.test(b));
        const gtype = typeLine ? typeLine.match(/^    type:\s*(\S+)/)[1] : null;

        // 只处理 select 组；load-balance / url-test 保留 include-all 不动
        if (gtype !== 'select') {
            out.push(...block);
            i = j;
            continue;
        }

        // 拆解：去掉 include-all-proxies，保留非节点项
        const head = [];
        const keepItems = [];
        let inProxies = false;

        for (const b of block) {
            if (/include-all-proxies:\s*true/.test(b)) continue;
            if (/^    proxies:\s*$/.test(b)) {
                inProxies = true;
                continue;
            }
            if (inProxies) {
                const im = b.match(/^      - (.+?)\s*$/);
                if (im) {
                    const item = im[1].replace(/^["']|["']$/g, '');
                    // 只保留组引用 / DIRECT / REJECT；旧节点项一律丢弃后重建
                    if (!isProxyNode(item, groupNames)) keepItems.push(item);
                    continue;
                }
                if (b.trim() === '') continue;
                // 非列表项：退出 proxies 段，后续内容进 head（如 url/interval）
                inProxies = false;
            }
            head.push(b);
        }

        // 去重（保序）
        const seen = new Set();
        const uniqKeep = [];
        for (const it of keepItems) {
            if (!seen.has(it)) {
                seen.add(it);
                uniqKeep.push(it);
            }
        }

        // 重建：head + proxies: + 保留项 + 节点列表
        const rebuilt = [...head];
        // 若 head 里没有 proxies: 行（原组无 proxies 段），补一个
        rebuilt.push('    proxies:');
        for (const it of uniqKeep) rebuilt.push(`      - "${it}"`);
        for (const n of nodeNames) rebuilt.push(`      - "${n}"`);

        out.push(...rebuilt);
        changed++;
        i = j;
    }

    return { text: out.join('\n'), changed };
}

async function fetchSubscription(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'clash-verge/v2.5.10' },
        redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
}

async function main() {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(`用法：
  node tools/sync-nodes.mjs <订阅URL> [模板路径]
  node tools/sync-nodes.mjs --file <本地yaml> [模板路径]
  node tools/sync-nodes.mjs --check <订阅URL> [模板路径]

选项：
  --file   从本地 YAML 读取节点（不联网）
  --check  只检查是否有差异，不写入（有差异退出码 2）`);
        exit(0);
    }

    let source;
    let templatePath = DEFAULT_TEMPLATE;
    let checkOnly = false;

    if (args[0] === '--check') {
        checkOnly = true;
        source = { kind: 'url', value: args[1] };
        if (args[2]) templatePath = args[2];
    } else if (args[0] === '--file') {
        source = { kind: 'file', value: args[1] };
        if (args[2]) templatePath = args[2];
    } else {
        source = { kind: 'url', value: args[0] };
        if (args[1]) templatePath = args[1];
    }

    if (!source.value) {
        console.error('错误：缺少订阅 URL 或文件路径');
        exit(1);
    }

    let subText;
    try {
        subText = source.kind === 'file' ? readFileSync(source.value, 'utf8') : await fetchSubscription(source.value);
    } catch (e) {
        console.error(`拉取失败：${e.message}`);
        exit(1);
    }

    const nodeNames = extractProxyNames(subText);
    if (nodeNames.length === 0) {
        console.error('解析失败：订阅中未找到 proxies 节点');
        exit(1);
    }
    console.log(`从订阅解析到 ${nodeNames.length} 个节点`);

    const templateText = readFileSync(templatePath, 'utf8');
    const { text, changed } = rewriteTemplate(templateText, nodeNames);

    if (text === templateText) {
        console.log('✓ 模板已是最新，无需更新');
        exit(0);
    }

    if (checkOnly) {
        console.log(`✗ 检测到差异（${changed} 个 select 组），未写入`);
        exit(2);
    }

    writeFileSync(templatePath, text, 'utf8');
    console.log(`✓ 已更新 ${templatePath}（${changed} 个 select 组，${nodeNames.length} 个节点）`);
    console.log('  下一步：git diff 确认，然后 npm run verify && git commit');
}

if (import.meta.url === `file://${argv[1]}`) {
    main().catch((e) => {
        console.error(e);
        exit(1);
    });
}
