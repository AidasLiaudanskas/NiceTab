#!/usr/bin/env node
// 分类桥接服务：扩展无法直接执行本地命令，所以用一个本地小服务代跑 `claude -p`。
// 只监听 127.0.0.1，且只接受来自扩展页面的请求。
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CLASSIFY_BRIDGE_PORT || 8787);
const HOST = '127.0.0.1';
// 单次请求上限，防止卡死
const TIMEOUT_MS = 180_000;

function resolveClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const native = join(homedir(), '.local/bin/claude');
  // npm 全局安装的 claude 可能缺少原生二进制，优先用原生安装路径
  return existsSync(native) ? native : 'claude';
}

const CLAUDE_BIN = resolveClaudeBin();
// 分类用的模型，可用 CLASSIFY_MODEL 覆盖
const MODEL = process.env.CLASSIFY_MODEL || 'claude-sonnet-5-5';

// Claude Code 默认会加载大量工具定义，这里尽量裁剪掉以降低开销
const BASE_ARGS = [
  '-p',
  '--model',
  MODEL,
  '--output-format',
  'json',
  '--exclude-dynamic-system-prompt-sections',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--disallowed-tools',
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'NotebookEdit',
  'TodoWrite',
];

function runClaude(system, prompt) {
  return new Promise((resolve, reject) => {
    execFile(
      CLAUDE_BIN,
      [...BASE_ARGS, '--system-prompt', system, prompt],
      { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, cwd: homedir() },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message));
        let envelope;
        try {
          envelope = JSON.parse(stdout);
        } catch {
          return reject(new Error(`claude returned non-JSON: ${stdout.slice(0, 300)}`));
        }
        if (envelope.is_error) return reject(new Error(String(envelope.result || 'claude error')));
        resolve({ result: envelope.result, costUsd: envelope.total_cost_usd });
      },
    );
  });
}

// 浏览器会强制带上 Origin，页面脚本无法伪造，用它挡掉普通网页的调用
function allowedOrigin(origin) {
  return !!origin && origin.startsWith('chrome-extension://');
}

function send(res, status, body, origin) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': origin || '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

// 知识库的收件目录。文件名由这边生成，绝不采用请求里的路径 —— 这个端口虽然
// 只听 127.0.0.1，但毕竟是浏览器页面能直接调的，不能让它决定写到哪。
const KB_INGEST_DIR =
  process.env.KB_INGEST_DIR || join(homedir(), 'kb', 'to-ingest');

function renderIngestMarkdown(items) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map();
  for (const item of items) {
    const kind = String(item.kind || 'other');
    const list = groups.get(kind);
    list ? list.push(item) : groups.set(kind, [item]);
  }
  let md = `# Stale readings from saved tabs\n\nSurfaced from the NiceTab library on ${today}.\n`;
  for (const [kind, list] of groups) {
    md += `\n## ${kind} (${list.length})\n\n`;
    for (const item of list) {
      md += `- [${String(item.title || item.url).replace(/[\[\]]/g, '')}](${item.url})\n`;
      const note = [item.saved && `saved ${item.saved}`, item.why].filter(Boolean).join(' — ');
      if (note) md += `  - ${note}\n`;
    }
  }
  return `${md}\n---\n\n${items.length} items total.\n`;
}

async function writeIngestFile(items) {
  await mkdir(KB_INGEST_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = join(KB_INGEST_DIR, `tabs-${stamp}.md`);
  await writeFile(file, renderIngestMarkdown(items), 'utf8');
  return file;
}

const server = createServer((req, res) => {
  const origin = req.headers.origin;

  if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
  if (req.url === '/health') return send(res, 200, { ok: true, bin: CLAUDE_BIN }, origin);

  const route = req.method === 'POST' ? req.url : undefined;
  if (route !== '/classify' && route !== '/kb-ingest') {
    return send(res, 404, { error: 'not found' }, origin);
  }
  if (!allowedOrigin(origin)) {
    return send(res, 403, { error: 'only extension pages may call this bridge' }, origin);
  }

  let raw = '';
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) req.destroy();
  });
  req.on('end', async () => {
    try {
      const body = JSON.parse(raw);
      if (route === '/kb-ingest') {
        const items = Array.isArray(body.items) ? body.items : [];
        if (!items.length) throw new Error('items is required');
        if (items.some(item => !item?.url)) throw new Error('every item needs a url');
        const file = await writeIngestFile(items);
        console.log(`[bridge] kb-ingest · ${items.length} items -> ${file}`);
        return send(res, 200, { file, count: items.length }, origin);
      }
      const { system, prompt } = body;
      if (!system || !prompt) throw new Error('system and prompt are required');
      const out = await runClaude(system, prompt);
      console.log(`[bridge] ok · $${(out.costUsd ?? 0).toFixed(4)}`);
      send(res, 200, out, origin);
    } catch (err) {
      console.error('[bridge] failed:', err.message);
      send(res, 500, { error: err.message }, origin);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on http://${HOST}:${PORT}`);
  console.log(`[bridge] ${CLAUDE_BIN} · model ${MODEL}`);
});
