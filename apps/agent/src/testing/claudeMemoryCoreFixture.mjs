/** Pinned SDK loopback protocol only. Synthetic peer, no remote model or DB. */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const OBJECTIVE = '接下来两周我想练习陶艺，之后是否继续还没决定。';
const TOOL = 'mcp__talent_signal__memory_review_propose';
const FINAL = '已整理为待确认的阶段目标。';

export async function runMemoryCoreProtocolCase({ runtime, ChatProvider, configurationFactory, invalidCommit = false, invalidKind, calendarMode }) {
  const requests = [];
  const hostCalls = [];
  const sockets = new Set();
  let receipt, result, failure;
  const objective = calendarMode ? '2026年10月20日 09:00 练习陶艺，持续一小时。' : OBJECTIVE;
  const proposal = { ...(invalidCommit ? { operation: 'commit' } : {}), contact_decision: 'none',
    items: [{ scope: 'self', operation: 'add', statement_kind: 'source_statement', dependence_kind: 'independent_self',
      display_text: '用户计划未来两周练习陶艺，之后是否继续尚未决定。', speaker: 'self', time_status: 'future',
      sensitivity: 'normal', source_excerpt: OBJECTIVE, source_locator: { kind: 'message' },
      reason: '用于后续学习建议，并保留两周阶段和之后未定的限制。' }] };
  if (invalidKind === 'missing_scope') delete proposal.items[0].scope;
  if (invalidKind === 'missing_contact') delete proposal.contact_decision;
  if (invalidKind === 'top_scope') proposal.scope = 'self';
  if (invalidKind === 'empty') proposal.items = [];
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || !request.url?.startsWith('/v1/messages')) { response.writeHead(404).end(); return; }
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const definitions = [];
    const collect = (value, deferred = false) => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(item => collect(item, deferred)); return; }
      const hidden = deferred || value.defer_loading === true;
      if (typeof value.name === 'string') definitions.push({ name: value.name, type: value.type ?? null, deferred: hidden,
        required: value.input_schema?.required ?? [], properties: Object.keys(value.input_schema?.properties ?? {}),
        itemRequired: value.input_schema?.properties?.items?.items?.required ?? [] });
      for (const child of Object.values(value)) if (child && typeof child === 'object') collect(child, hidden);
    };
    collect(body.tools);
    const memory = definitions.find(tool => tool.name === TOOL);
    const references = [];
    const collectReferences = value => {
      if (Array.isArray(value)) return value.forEach(collectReferences);
      if (!value || typeof value !== 'object') return;
      if (value.type === 'tool_reference') references.push(value.tool_name);
      for (const child of Object.values(value)) if (child && typeof child === 'object') collectReferences(child);
    };
    collectReferences(body.messages);
    requests.push({ model: body.model, stream: body.stream, memoryPresent: Boolean(memory),
      memoryDeferred: memory?.deferred === true, definitions, references,
      calendarInCatalog: JSON.stringify(body).includes('stage_calendar_draft'),
      calendarSchemaPresent: definitions.some(tool => tool.name === 'mcp__talent_signal__stage_calendar_draft'),
      contactSchemaPresent: definitions.some(tool => tool.name.includes('contact_workspace')) });
    const index = requests.length;
    let name = TOOL, input = proposal;
    let useTool = index === 1;
    if (calendarMode) {
      name = index === 1 ? 'ToolSearch' : 'mcp__talent_signal__stage_calendar_draft';
      input = index === 1 ? { query: 'select:mcp__talent_signal__stage_calendar_draft' } : {
        title: '练习陶艺', starts_at: '2026-10-20T09:00:00Z', ends_at: '2026-10-20T10:00:00Z',
        time_zone: 'UTC', source_excerpt: objective, finish_preparation: true,
      };
      useTool = index === 1 || (calendarMode === 'enabled' && index === 2);
    }
    const block = useTool ? { type: 'tool_use', id: `toolu_memory_core_${index}`, name, input: {} } : { type: 'text', text: '' };
    const delta = useTool ? { type: 'input_json_delta', partial_json: JSON.stringify(input) }
      : { type: 'text_delta', text: invalidCommit || invalidKind ? '没有保存或准备任何记忆。' : FINAL };
    const send = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    send({ type: 'message_start', message: { id: `msg_memory_core_${index}`, type: 'message', role: 'assistant',
      model: 'claude-sonnet-5', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
    send({ type: 'content_block_start', index: 0, content_block: block });
    send({ type: 'content_block_delta', index: 0, delta });
    send({ type: 'content_block_stop', index: 0 });
    send({ type: 'message_delta', delta: { stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
    send({ type: 'message_stop' }); response.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const configuration = configurationFactory({ HAO_ANTHROPIC_API_KEY: 'synthetic-loopback-only',
      ANTHROPIC_BASE_URL: 'https://api.hao.ai/anthropic', TALENT_SIGNAL_AGENT_MODEL: 'anthropic/claude-sonnet-5',
      TALENT_SIGNAL_CLAUDE_TASK_BUDGET_ENABLED: 'false' });
    const provider = new ChatProvider(configuration, async (config, request, signal) => {
      receipt = await runtime.runClaudeHarness({ ...config, baseUrl: `http://127.0.0.1:${server.address().port}` },
        { ...request, apiRetryLimit: 0 }, signal, undefined, null);
      return receipt;
    });
    result = await provider.run({ runID: randomUUID(), messageID: randomUUID(), objective, sessionTitleRequested: false,
      systemPrompt: 'Use only the admitted product tools with this synthetic source. Prepare no accepted-state write.',
      scopeSummary: { kind: 'workspace_conversation', workspaceID: randomUUID(), sessionID: randomUUID(), currentPersonID: null, currentRelationshipContextID: null },
      toolManifest: ['contact_workspace', 'memory_review'],
      ...(calendarMode !== 'unavailable' ? { calendarContext: { sourceRequestID: randomUUID(),
        referenceTime: '2026-10-19T00:00:00Z', timeZone: 'UTC' } } : {}),
      selfMemoryContext: { kind: 'private_self_memory', status: 'complete', items: [], continuation: null },
      budget: { maxTurns: 4, maxToolCalls: 6, maxDurationMs: 40_000, maxTaskTokens: 24_000, maxEstimatedUsd: 0.15 },
    }, async (name, input) => {
      hostCalls.push({ name, input });
      return { ok: true, callID: randomUUID(), name, data: { operation: 'propose', proposal_id: randomUUID(), review_only: true } };
    }, new AbortController().signal);
  } catch (error) { failure = { name: error.name, message: error.message }; }
  finally {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  return { invalidCommit, invalidKind: invalidKind ?? null, calendarMode: calendarMode ?? null, requests, hostCalls,
    calendarDraft: result?.calendarDraft ?? null, receipt: receipt ? { toolCalls: receipt.toolCalls,
    toolCompletions: receipt.toolCompletions, terminalReason: receipt.terminalReason, permissionDenials: receipt.permissionDenials, apiRetries: receipt.apiRetries } : null,
    completed: Boolean(result), failure: failure ?? null, scope: 'Synthetic native protocol characterization; no model quality, database or accepted Memory write.' };
}
