/** Real-SDK protocol regression peer: synthetic data and loopback HTTP only.
 * Inject current product modules, never an SDK stub or a fabricated host result.
 * The caller owns the registered artifact directory and optional OS network sandbox.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

const MODEL = 'claude-sonnet-5';
const PREFIX = 'mcp__talent_signal__';
const FINAL = 'Provide the missing role scope, then ask whether it addresses the contact’s question.';
const PARTIAL = 'Provide the missing role scope';
const SOURCE = 'synthetic-evidence-0001';
export const OFFLINE_SSE_MODES = ['complete', 'fixed-provider', 'fixed-continuous-stall', 'fixed-cancel',
  'fixed-terminal-open', 'fixed-keepalive', 'fixed-max-turns', 'fixed-header-silence'];
const FIXED_DEADLINES = { 'fixed-provider': 60_000, 'fixed-continuous-stall': 12_000, 'fixed-cancel': 30_000,
  'fixed-terminal-open': 15_000, 'fixed-keepalive': 12_000, 'fixed-max-turns': 30_000, 'fixed-header-silence': 12_000 };
const CANONICAL_INPUT = { objective: 'What is the safest next question to ask this synthetic contact?', context_blocks: [{
  block_id: 'synthetic-block-0001', block_key: 'synthetic-follow-up-gap', type: 'relationship_context', status: 'confirmed',
  headline: 'Synthetic follow-up context', summary: 'The contact asked for role scope before choosing a meeting time.',
  items: ['No role scope was included in the synthetic exchange.'], evidence_fragment_ids: [SOURCE],
}], allowed_citation_ids: [SOURCE] };

/** A deterministic HTTP peer, not a mocked SDK or a fabricated host result. */
export async function runOfflineSSECase({ mode, deadlineMs = FIXED_DEADLINES[mode] ?? 3_000,
  maxTurns = mode.endsWith('max-turns') ? 3 : 6, runtime, sdkQuery: query, schema: z, ChatProvider }) {
  assert(OFFLINE_SSE_MODES.includes(mode));
  assert(runtime?.runClaudeHarness && query && z, 'Pass the real production harness, SDK query and Zod schema factory.');
  const api = runtime;
  const started = performance.now();
  const events = [];
  const record = (event, metadata = {}) => events.push({ afterMs: Math.round(performance.now() - started), event, ...metadata });
  const sockets = new Set();
  const openResponses = new Set();
  const intervals = new Set();
  const completedTools = [];
  const toolCalls = { read_relationship_memory: 0, cite_evidence: 0 };
  let requestCount = 0;
  let runtimeDirectory;
  let serverFailure;
  let result;
  let failure;
  let sdkResult;
  let providerAnswer;
  let observedPolicy;
  let keepaliveCount = 0;
  const external = new AbortController();
  let cancelTimer;

  function holdResponse(response, index, blockType, keepalive = false) {
    openResponses.add(response);
    let interval;
    if (keepalive) {
      interval = setInterval(() => { response.write(': synthetic keepalive\n\n'); keepaliveCount += 1; }, 250);
      intervals.add(interval);
    }
    response.once('close', () => { openResponses.delete(response); clearInterval(interval); intervals.delete(interval);
      record('mock_held_connection_closed', { index }); });
    record('mock_holding_without_eof', { index, blockType, keepalive });
    if (mode === 'fixed-cancel' && index === 3) {
      // Cancel the final stalled response, never SDK startup or either tool.
      // Scheduling this at the protocol barrier keeps the scenario stable on
      // a loaded host without renewing the harness's original overall budget.
      cancelTimer = setTimeout(() => {
        record('caller_cancelled'); external.abort(new Error('USER_CANCELLED'));
      }, 2_000);
    }
  }

  function message(index, content, stopReason = 'end_turn') {
    return { id: `msg_offline_${mode.replaceAll('-', '_')}_${index}`, type: 'message', role: 'assistant', model: MODEL,
      content, stop_reason: stopReason, stop_sequence: null,
      usage: { input_tokens: 100 + index, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 } };
  }
  function send(response, event) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    record('mock_sse', { type: event.type, ...(event.index === undefined ? {} : { index: event.index }),
      ...(event.delta?.stop_reason ? { stopReason: event.delta.stop_reason } : {}),
      ...(event.content_block?.type ? { blockType: event.content_block.type } : {}) });
  }
  function stream(response, index, block, delta, { hold = false, terminalOpen = false, keepalive = false, stopReason = 'end_turn' } = {}) {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache',
      'request-id': `req-offline-${mode}-${index}`, connection: 'keep-alive' });
    const initial = message(index, [], null);
    initial.usage.output_tokens = 1;
    send(response, { type: 'message_start', message: initial });
    send(response, { type: 'content_block_start', index: 0, content_block: block });
    send(response, { type: 'content_block_delta', index: 0, delta });
    send(response, { type: 'content_block_stop', index: 0 });
    if (hold) {
      holdResponse(response, index, block.type, keepalive);
      return;
    }
    send(response, { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 12 } });
    send(response, { type: 'message_stop' });
    if (terminalOpen) { holdResponse(response, index, block.type); return; }
    response.end();
    record('mock_eof', { index });
  }
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method !== 'POST' || pathname !== '/v1/messages') {
        record('unexpected_http_route', { method: request.method, pathname });
        response.writeHead(404).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Offline fixture accepts only Messages.' } }));
        return;
      }
      let bytes = '';
      for await (const chunk of request) { bytes += chunk; assert(bytes.length < 500_000); }
      const body = JSON.parse(bytes);
      requestCount += 1;
      const index = requestCount;
      record('mock_request', { index, stream: body.stream === true, model: body.model,
        thinkingType: body.thinking?.type ?? null, effort: body.output_config?.effort ?? null,
        maxTokens: body.max_tokens, messageCount: body.messages?.length,
        priorToolResults: body.messages?.flatMap(item => Array.isArray(item.content) ? item.content : [])
          .filter(item => item.type === 'tool_result').map(item => item.tool_use_id) ?? [] });
      assert.equal(body.model, MODEL);
      if (mode === 'fixed-header-silence') {
        // Deliberately send neither headers nor body; do not assume which
        // native first-byte recovery branch will run before the host deadline.
        holdResponse(response, index, 'no_headers');
        return;
      }
      if (index <= 2) {
        assert.equal(body.stream, true);
        const name = index === 1 ? 'read_relationship_memory' : 'cite_evidence';
        const input = index === 1 ? { block_types: ['relationship_context'] } : { source_ids: [SOURCE] };
        stream(response, index, { type: 'tool_use', id: `toolu_offline_${index}`, name: PREFIX + name, input: {} },
          { type: 'input_json_delta', partial_json: JSON.stringify(input) }, { stopReason: 'tool_use' });
      } else {
        const persistentHold = mode === 'fixed-continuous-stall' || mode === 'fixed-keepalive';
        const hold = (index === 3 || persistentHold) && mode !== 'complete' && mode !== 'fixed-terminal-open';
        if (!body.stream) {
          assert.equal(hold, false, 'A first final response must stream before watchdog recovery.');
          response.writeHead(200, { 'content-type': 'application/json', 'request-id': `req-offline-${mode}-${index}` });
          response.end(JSON.stringify(message(index, [{ type: 'text', text: FINAL }])));
          record('mock_complete_json', { index });
        } else {
          stream(response, index, { type: 'text', text: '' },
            { type: 'text_delta', text: hold ? PARTIAL : FINAL },
            { hold, terminalOpen: mode === 'fixed-terminal-open', keepalive: mode === 'fixed-keepalive' });
        }
      }
    } catch (error) {
      serverFailure = { name: error.name, message: error.message };
      record('mock_server_failure', serverFailure);
      response.destroy(error);
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('connect', (_request, socket) => { record('blocked_proxy_connect'); socket.destroy(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  record('mock_listening', { address: '127.0.0.1' });
  const sdkQuery = ({ prompt, options }) => {
    runtimeDirectory = options.cwd;
    record('sdk_options_policy', { enabled: options.env.CLAUDE_ENABLE_BYTE_WATCHDOG ?? null,
      timeoutMs: options.env.CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS ?? null });
    // Preserve real product policy, budget, hooks and session. Only route the
    // synthetic gateway to this peer; never set a watchdog in the fixture.
    const real = query({ prompt, options: { ...options,
      env: { ...options.env, ANTHROPIC_BASE_URL: baseUrl } } });
    return {
      close: () => real.close(), return: (...args) => real.return(...args),
      async *[Symbol.asyncIterator]() {
        for await (const item of real) {
          if (item.type === 'assistant') {
            record('sdk_assistant', { blockTypes: item.message.content.map(block => block.type),
              stopReason: item.message.stop_reason, messageID: item.message.id });
          } else if (item.type === 'result') {
            sdkResult = { subtype: item.subtype, is_error: item.is_error, sessionID: item.session_id,
              turns: item.num_turns, terminalReason: item.terminal_reason ?? null, modelUsage: item.modelUsage,
              resultLength: item.result?.length ?? null, resultEqualsExpected: item.result === FINAL,
              errors: item.errors ?? null };
            record('sdk_result', sdkResult);
          } else if (item.type === 'system') {
            record('sdk_system', { subtype: item.subtype,
              ...(item.subtype === 'init' ? { model: item.model } : {}),
              ...(item.subtype === 'api_retry' ? { attempt: item.attempt, delayMs: item.retry_delay_ms, status: item.error_status } : {}),
              ...(item.hook_name ? { hookName: item.hook_name } : {}),
              ...(item.outcome ? { outcome: item.outcome } : {}) });
          }
          yield item;
        }
        record('sdk_stream_done');
      },
    };
  };
  try {
    const configuration = { model: MODEL, baseUrl,
      credential: { name: 'ANTHROPIC_API_KEY', value: 'synthetic-offline-key-no-real-credential' }, taskBudgetEnabled: false };
    const completion = receipt => { completedTools.push(receipt.name); record('host_tool_completed', { name: receipt.name }); };
    const request = {
      objective: 'What is the safest next question to ask this synthetic contact?',
      systemPrompt: 'Use read_relationship_memory and cite_evidence to ground a concise answer. No external actions.',
      messageID: randomUUID(), effort: 'medium',
      tools: [
        { name: 'read_relationship_memory', description: 'Read the synthetic governed relationship snapshot.',
          schema: z.strictObject({ block_types: z.array(z.string()).optional() }), readOnly: true, alwaysLoad: true,
          execute: async () => { toolCalls.read_relationship_memory += 1; record('host_tool', { name: 'read_relationship_memory' });
            return { content: [{ type: 'text', text: JSON.stringify({ blocks: [{ summary: 'The contact asked for role scope before choosing a meeting time.', evidence_fragment_ids: [SOURCE] }] }) }] }; } },
        { name: 'cite_evidence', description: 'Select supporting synthetic source IDs.',
          schema: z.strictObject({ source_ids: z.array(z.string()).min(1) }), readOnly: true, alwaysLoad: true,
          execute: async ({ source_ids }) => { assert.deepEqual(source_ids, [SOURCE]); toolCalls.cite_evidence += 1; record('host_tool', { name: 'cite_evidence' });
            return { content: [{ type: 'text', text: JSON.stringify({ cited_source_ids: source_ids }) }] }; } },
      ],
      budget: { maxTurns, maxToolCalls: 12, maxDurationMs: deadlineMs, maxTaskTokens: 32_000, maxEstimatedUsd: 1 },
      ...(mode === 'complete' ? {} : { byteStreamIdleTimeoutMs: 10_000 }),
      assertCurrent: async () => {}, onToolCompletion: completion,
    };
    if (mode === 'fixed-provider') {
      assert(ChatProvider, 'Pass the real production ClaudeChatProvider for the provider entry test.');
      const ClaudeChatProvider = ChatProvider;
      const provider = new ClaudeChatProvider({ ...configuration, baseUrl: 'https://api.hao.ai/anthropic' },
        async (config, input, signal) => {
          observedPolicy = { byteStreamIdleTimeoutMs: input.byteStreamIdleTimeoutMs, budget: input.budget,
            toolNames: input.tools.map(tool => tool.name), everyToolReadOnly: input.tools.every(tool => tool.readOnly),
            configuredEndpoint: config.baseUrl };
          record('provider_policy', observedPolicy);
          result = await api.runClaudeHarness(config, { ...input, onToolCompletion: completion,
            tools: input.tools.map(tool => ({ ...tool, execute: async (...args) => {
              toolCalls[tool.name] += 1; record('host_tool', { name: tool.name });
              return tool.execute(...args);
            } })) }, signal, sdkQuery, null);
          return result;
        });
      providerAnswer = await provider.answer({ ...CANONICAL_INPUT, signal: external.signal });
    } else result = await api.runClaudeHarness(configuration, request, external.signal, sdkQuery, null);
    record('host_success', { terminalReason: result.terminalReason, turns: result.turns, toolCalls: result.toolCalls,
      modelResponses: result.modelResponses, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  } catch (error) {
    failure = { name: error.name, code: error.message,
      ...(error instanceof api.ClaudeHarnessInterruption || error instanceof api.ClaudeHarnessFailure ? { receipt: error.receipt } : {}) };
    record('host_failure', { name: error.name, code: error.message });
  } finally {
    clearTimeout(cancelTimer);
    for (const interval of intervals) clearInterval(interval);
    for (const response of openResponses) response.destroy();
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    record('mock_closed', { remainingSockets: sockets.size });
  }
  let workspaceRemoved = true;
  if (runtimeDirectory) {
    const { access } = await import('node:fs/promises');
    workspaceRemoved = await access(runtimeDirectory).then(() => false, () => true);
  }
  let assertionFailure;
  try {
    assert.equal(serverFailure, undefined, JSON.stringify(serverFailure));
    assert.deepEqual(toolCalls, mode === 'fixed-header-silence' ? { read_relationship_memory: 0, cite_evidence: 0 }
      : { read_relationship_memory: 1, cite_evidence: 1 });
    assert.deepEqual(completedTools, mode === 'fixed-header-silence' ? [] : ['read_relationship_memory', 'cite_evidence']);
    assert.equal(workspaceRemoved, true, 'The real harness must dispose its own SDK workspace.');
    // Recovery stays in the same SDK session and must retain the original tool
    // receipts rather than replay either read/cite capability.
    for (const event of events.filter(item => item.event === 'mock_request' && item.index >= 3)) {
      assert.deepEqual(event.priorToolResults, ['toolu_offline_1', 'toolu_offline_2']);
    }
    assert(events.filter(item => item.event === 'unexpected_http_route').every(item =>
      item.method === 'HEAD' && item.pathname === '/api/hello'), 'Only the known local CLI health probe is additional traffic.');
    if (mode.endsWith('max-turns')) {
      assert.equal(result, undefined, 'A truncated answer cannot become success when recovery exceeds the original turn budget.');
      // The pinned CLI may count the partial-response recovery differently from
      // num_turns. The product's independent receipt budget remains authoritative.
      assert(sdkResult?.turns > maxTurns);
      assert(failure?.receipt.turns > maxTurns);
      assert.equal(failure?.code, 'CLAUDE_HARNESS_ERROR_MAX_TURNS');
      assert.equal(requestCount, 4);
    } else if (mode === 'fixed-cancel') {
      assert.equal(result, undefined);
      assert.equal(sdkResult, undefined);
      assert.equal(failure?.code, 'USER_CANCELLED');
      assert.equal(requestCount, 3);
    } else if (mode === 'fixed-header-silence') {
      assert.equal(result, undefined);
      assert.equal(sdkResult, undefined);
      assert.equal(failure?.code, 'CLAUDE_HARNESS_TIMEOUT');
      assert(performance.now() - started < deadlineMs + 3_500, 'Header silence must not renew the original host budget.');
      assert(requestCount >= 1);
    } else if (mode === 'fixed-continuous-stall' || mode === 'fixed-keepalive') {
      assert.equal(result, undefined);
      assert.equal(sdkResult, undefined);
      assert.equal(failure?.code, 'CLAUDE_HARNESS_TIMEOUT');
      assert(performance.now() - started < deadlineMs + 3_500, 'Native recovery must not renew the host deadline.');
      if (mode === 'fixed-keepalive') { assert(keepaliveCount >= 20); assert.equal(requestCount, 3); }
      else assert.equal(requestCount, 4);
    } else if (mode === 'complete' || mode === 'fixed-provider' || mode === 'fixed-terminal-open') {
      assert(result, JSON.stringify(failure));
      assert(sdkResult, 'Only a genuine SDK result establishes success.');
      assert.equal(result.text, FINAL);
      assert.equal(result.toolCalls, 2);
      assert.equal(sdkResult.subtype, 'success');
      assert.equal(sdkResult.is_error, false);
      assert(result.turns <= maxTurns);
      if (mode === 'complete') assert.equal(requestCount, 3);
      if (mode === 'fixed-terminal-open') assert.equal(requestCount, 3);
      if (mode === 'fixed-provider') {
        assert.equal(observedPolicy.byteStreamIdleTimeoutMs, 20_000);
        assert.equal(observedPolicy.budget.maxDurationMs, 60_000);
        assert.equal(observedPolicy.everyToolReadOnly, true);
        assert.equal(providerAnswer.body, FINAL);
        assert.deepEqual(providerAnswer.citation_ids, [SOURCE]);
        assert.equal(requestCount, 4);
        assert(events.find(event => event.event === 'sdk_options_policy')?.timeoutMs === '20000');
      }
    }
  } catch (error) { assertionFailure = { name: error.name, message: error.message }; }
  return { mode, deadlineMs, maxTurns, passed: !assertionFailure, assertionFailure: assertionFailure ?? null,
    providerPolicy: observedPolicy ?? null, keepaliveCount,
    unsafePartialSuccess: Boolean(result && result.text !== FINAL), elapsedMs: Math.round(performance.now() - started), requestCount,
    toolCalls, completedTools, sdkResult: sdkResult ?? null, result: result ? { ...result, text: undefined, structuredOutput: undefined } : null,
    failure: failure ?? null, workspaceRemoved, events };
}

