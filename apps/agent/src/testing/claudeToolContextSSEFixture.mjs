/** GET-128 bounded tool context: real-SDK wire measurement and multi-step
 * discovery regression. Synthetic data, public prompt text and loopback HTTP
 * only. Inject current product modules, never an SDK stub or a fabricated host
 * result. The caller owns the registered artifact directory and any OS network
 * sandbox. ToolSearch tool results are produced by the pinned CLI's genuine
 * local discovery over the registered Run-only MCP catalog; this peer only
 * scripts the model side of the deterministic transcript.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';

const MODEL = 'claude-sonnet-5';
const PREFIX = 'mcp__talent_signal__';
const FINAL = 'The synthetic record shows the contact asked for role scope before choosing a meeting time.';
const FINAL_JSON = '{"outcome":"clarification","title":"Synthetic","body":"Synthetic scoped answer."}';
const HOSTILE_QUERY = 'Ada Lovelace';
const VALID_QUERY = 'Ada Lovelace';
const SOURCE = 'synthetic-evidence-0001';
const CATALOG = ['contact_workspace_search', 'contact_workspace_read', 'contact_workspace_propose_create',
  'contact_workspace_propose_update', 'memory_review', 'mcp_connections'];
const ESSENTIAL = ['read_response_preference', 'stage_calendar_draft'];
const CORE = ['memory_review_recall', 'memory_review_propose'];
const ANSWER_TOOLS = ['cite_evidence', 'read_relationship_memory'];

export const TOOL_CONTEXT_MODES = ['natural', 'json', 'answer'];

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null));
}

function toolWire(tool) {
  const hasSchema = tool.input_schema !== undefined || tool.parameters !== undefined;
  const hasDescription = tool.description !== undefined;
  return {
    name: tool.name ?? null,
    descriptionBytes: hasDescription ? bytes(tool.description) : 0,
    schemaBytes: hasSchema ? bytes(tool.input_schema ?? tool.parameters) : 0,
    deferredFlag: tool.defer_loading === true || tool._meta?.['anthropic/alwaysLoad'] === false ? 'deferred'
      : tool._meta?.['anthropic/alwaysLoad'] === true ? 'alwaysLoad' : 'unset',
  };
}

/** Capture the actual public wire request without retaining user secrets. */
function measureRequest(index, body, headers, catalog, essential) {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const raw = JSON.stringify(body);
  return {
    index,
    bodyBytes: Buffer.byteLength(raw),
    systemBytes: bytes(body.system),
    toolsBytes: bytes(body.tools),
    messagesBytes: bytes(body.messages),
    bodyKeys: Object.keys(body).sort(),
    betaHeaders: String(headers['anthropic-beta'] ?? ''),
    tools: tools.map(toolWire),
    toolNames: tools.map(tool => tool.name ?? null),
    // Deferred catalog visibility by actual original names anywhere in the
    // request (system reminders and loaded schemas both count as visible).
    catalogVisibility: Object.fromEntries(catalog.map(name => [name, raw.includes(name)])),
    essentialVisibility: Object.fromEntries(essential.map(name => [name, raw.includes(name)])),
    toolSearchVisible: raw.includes('ToolSearch'),
  };
}

function protocolTrace(body) {
  const toolUses = [];
  const toolResults = [];
  for (const message of body.messages ?? []) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type === 'tool_use') toolUses.push({ name: block.name, input: block.input ?? null });
      if (block.type === 'tool_result') {
        const text = Array.isArray(block.content) ? block.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
          : typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        toolResults.push({ is_error: block.is_error === true, text, raw: JSON.stringify(block.content ?? null).slice(0, 8_000) });
      }
    }
  }
  return { toolUses, toolResults };
}

/**
 * Run one real pinned-SDK conversation against a deterministic loopback peer.
 * mode: "natural" (ordinary text) | "json" (legacy structured adapter).
 * expect: "eager" (legacy full schemas, no ToolSearch) | "discovery" (bounded).
 */
export async function runToolContextCase({ mode, expect, runtime, sdkQuery: query, schema: z, ChatProvider,
  systemPrompt, toolManifest = ['contact_workspace', 'memory_review', 'mcp_connections'],
  deadlineMs = 150_000, authorityFault }) {
  assert(TOOL_CONTEXT_MODES.includes(mode));
  assert(expect === 'eager' || expect === 'discovery');
  assert(authorityFault === undefined || (mode === 'natural' && expect === 'discovery'
    && ['source', 'lease'].includes(authorityFault)));
  assert(runtime?.runClaudeHarness && query && z && ChatProvider, 'Pass the real production harness, SDK query, Zod and ClaudeChatProvider.');
  const catalog = expect === 'discovery' ? [...CATALOG.filter(name => name !== 'memory_review'), ...CORE, 'stage_calendar_draft'] : CATALOG;
  const essential = expect === 'discovery' ? ['read_response_preference'] : ESSENTIAL;
  const deferred = catalog.filter(name => !CORE.includes(name) && name !== 'mcp_connections');
  const started = performance.now();
  const events = [];
  const record = (event, metadata = {}) => events.push({ afterMs: Math.round(performance.now() - started), event, ...metadata });
  const sockets = new Set();
  const requests = [];
  const traces = [];
  let requestCount = 0;
  let runtimeDirectory;
  let serverFailure;
  let result;
  let failure;
  let sdkOptions;
  const invokeCalls = [];
  const completions = [];
  let harnessToolCalls = null;
  let providerAnswer;
  const external = new AbortController();
  let revoked = false;
  const authority = { sourceChecks: 0, leaseChecks: 0, rejectedChecks: 0, searchGates: 0,
    leaseFinished: null, storeAppends: 0 };
  const assertAuthority = async kind => {
    authority[kind === 'source' ? 'sourceChecks' : 'leaseChecks'] += 1;
    if (revoked && authorityFault === kind) {
      authority.rejectedChecks += 1;
      throw new Error(kind === 'source' ? 'SOURCE_REVOKED' : 'GENERATION_REVOKED');
    }
  };
  // A host-issued, disposable SessionStore exercises the actual SDK lease
  // boundary. It is not a mock SDK or a prebuilt tool-discovery result.
  const sessionEntries = new Map();
  const sessionKey = key => JSON.stringify([key.projectKey, key.sessionId, key.subpath ?? null]);
  const continuation = authorityFault === 'lease' ? {
    sessionID: randomUUID(), resume: false,
    store: {
      append: async (key, entries) => {
        authority.storeAppends += 1;
        const previous = sessionEntries.get(sessionKey(key)) ?? [];
        const known = new Set(previous.map(entry => entry.uuid).filter(Boolean));
        sessionEntries.set(sessionKey(key), [...previous, ...structuredClone(entries)
          .filter(entry => !entry.uuid || !known.has(entry.uuid))]);
      },
      load: async key => structuredClone(sessionEntries.get(sessionKey(key)) ?? null),
      listSubkeys: async () => [],
    },
    assertCurrent: () => assertAuthority('lease'),
    finish: async completed => { authority.leaseFinished = completed; sessionEntries.clear(); },
  } : undefined;

  const toolUse = (name, input) => ({
    block: { type: 'tool_use', id: `toolu_tool_context_${++toolUseCounter}`, name, input: {} },
    delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    stopReason: 'tool_use',
  });
  let toolUseCounter = 0;

  /** The scripted model side of the transcript; host execution stays real. */
  function plannedStep(index) {
    if (mode === 'answer') {
      if (index === 1) return toolUse(PREFIX + 'read_relationship_memory', {});
      if (index === 2) return toolUse(PREFIX + 'cite_evidence', { source_ids: [SOURCE] });
      return { block: { type: 'text', text: '' }, delta: { type: 'text_delta', text: FINAL } };
    }
    if (expect === 'eager') {
      if (index === 1) return toolUse(PREFIX + 'contact_workspace_search', { query: VALID_QUERY });
      return { block: { type: 'text', text: '' }, delta: { type: 'text_delta', text: mode === 'json' ? FINAL_JSON : FINAL } };
    }
    if (index === 1) return toolUse('ToolSearch', { query: 'contact memory review', max_results: 10 });
    if (index === 2) return toolUse('ToolSearch', { query: `select:${PREFIX}mcp_connections,${PREFIX}contact_workspace_read,${PREFIX}contact_workspace_propose_create,${PREFIX}contact_workspace_propose_update,${PREFIX}stage_calendar_draft,NotRegisteredTool` });
    if (index === 3) return toolUse(PREFIX + 'contact_workspace_search', { query: HOSTILE_QUERY, exfiltrate: 'PRIVATE_HOSTILE_KEY' });
    if (index === 4) return toolUse(PREFIX + 'contact_workspace_search', { query: VALID_QUERY });
    return { block: { type: 'text', text: '' }, delta: { type: 'text_delta', text: mode === 'json' ? FINAL_JSON : FINAL } };
  }

  function send(response, event) {
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    record('mock_sse', { type: event.type, ...(event.content_block?.type ? { blockType: event.content_block.type } : {}) });
  }
  function stream(response, index, step) {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache',
      'request-id': `req-tool-context-${index}`, connection: 'keep-alive' });
    const initial = { id: `msg_tool_context_${index}`, type: 'message', role: 'assistant', model: MODEL,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100 + index, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } };
    send(response, { type: 'message_start', message: initial });
    send(response, { type: 'content_block_start', index: 0, content_block: step.block });
    if (step.delta) send(response, { type: 'content_block_delta', index: 0, delta: step.delta });
    send(response, { type: 'content_block_stop', index: 0 });
    send(response, { type: 'message_delta', delta: { stop_reason: step.stopReason ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: 12 } });
    send(response, { type: 'message_stop' });
    response.end();
    record('mock_eof', { index });
  }

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
      if (request.method !== 'POST' || pathname !== '/v1/messages') {
        record('unexpected_http_route', { method: request.method, pathname });
        response.writeHead(404).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'Tool context fixture accepts only Messages.' } }));
        return;
      }
      let raw = '';
      for await (const chunk of request) { raw += chunk; assert(raw.length < 2_000_000); }
      const body = JSON.parse(raw);
      requestCount += 1;
      const index = requestCount;
      requests.push(measureRequest(index, body, request.headers, catalog, essential));
      traces.push({ index, ...protocolTrace(body) });
      record('mock_request', { index, tools: requests[index - 1].toolNames });
      assert.equal(body.model, MODEL);
      assert.equal(body.stream, true);
      stream(response, index, plannedStep(index));
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

  const sdkWrapped = ({ prompt, options }) => {
    if (authorityFault) {
      // Revoke only when the genuine CLI reaches the first search, after
      // initial source/lease admission. Keep production assertCurrent intact.
      const hooks = options.hooks.PreToolUse[0].hooks;
      const originalGate = hooks[0];
      hooks[0] = async (...args) => {
        if (args[0].tool_name === 'ToolSearch') {
          authority.searchGates += 1;
          revoked = true;
        }
        return originalGate(...args);
      };
    }
    runtimeDirectory = options.cwd;
    sdkOptions = { tools: [...(options.tools ?? [])], allowedTools: [...(options.allowedTools ?? [])],
      enableToolSearch: options.env.ENABLE_TOOL_SEARCH ?? null, disallowedTools: [...(options.disallowedTools ?? [])] };
    record('sdk_options', sdkOptions);
    const real = query({ prompt, options: { ...options, env: { ...options.env, ANTHROPIC_BASE_URL: baseUrl } } });
    return {
      close: () => real.close(), return: (...args) => real.return(...args),
      async *[Symbol.asyncIterator]() {
        for await (const item of real) {
          if (item.type === 'result') {
            record('sdk_result', { subtype: item.subtype, is_error: item.is_error, turns: item.num_turns,
              terminalReason: item.terminal_reason ?? null, toolCalls: null });
          }
          yield item;
        }
        record('sdk_stream_done');
      },
    };
  };

  try {
    const configuration = { model: MODEL, baseUrl: 'https://api.hao.ai/anthropic',
      credential: { name: 'ANTHROPIC_API_KEY', value: 'synthetic-tool-context-key-no-real-credential' }, taskBudgetEnabled: false };
    const provider = new ChatProvider(configuration,
      async (config, input, signal) => {
        try {
          const outcome = await runtime.runClaudeHarness(config, { ...input,
            onToolCompletion: receipt => { completions.push(receipt.name); record('host_tool_completed', { name: receipt.name }); } },
          signal, sdkWrapped, null);
          harnessToolCalls = outcome.toolCalls;
          return outcome;
        } catch (error) {
          harnessToolCalls = error?.receipt?.toolCalls ?? harnessToolCalls;
          throw error;
        }
      });
    const invokeTool = async (name, input) => {
      invokeCalls.push({ name, input });
      record('host_invoke_tool', { name, operation: input?.operation ?? null });
      return { ok: true, callID: `synthetic-call-${invokeCalls.length}`, name,
        data: { operation: 'search', matches: [{ person: { id: 'synthetic-person' }, relationship_context: { id: 'synthetic-relationship' } }] } };
    };
    if (mode === 'answer') {
      providerAnswer = await provider.answer({
        objective: 'What is the safest next question to ask this synthetic contact?',
        context_blocks: [{ block_id: 'synthetic-block-0001', block_key: 'synthetic-follow-up-gap', type: 'relationship_context',
          status: 'confirmed', headline: 'Synthetic follow-up context',
          summary: 'The contact asked for role scope before choosing a meeting time.',
          items: ['No role scope was included in the synthetic exchange.'], evidence_fragment_ids: [SOURCE] }],
        allowed_citation_ids: [SOURCE], signal: external.signal,
      });
      record('host_success', { answerBodyMatches: providerAnswer.body === FINAL, citations: providerAnswer.citation_ids });
    } else {
      const request = {
        runID: `tool-context-${mode}-${randomUUID()}`,
        objective: 'What is the safest next question to ask this synthetic contact about role scope?',
        systemPrompt: systemPrompt ?? 'Synthetic tool context regression. Public prompt text only. No external actions.',
        outputMode: mode === 'json' ? 'json' : undefined,
        scopeSummary: { kind: 'workspace_conversation', workspaceID: 'synthetic-workspace', sessionID: null,
          currentPersonID: null, currentRelationshipContextID: null },
        toolManifest,
        budget: { maxTurns: 12, maxToolCalls: 8, maxDurationMs: deadlineMs, maxTaskTokens: 32_000, maxEstimatedUsd: 1 },
        responsePreference: { responseStyle: 'conclusion_first', sourceID: `user-preference:${randomUUID()}:1`, updatedAt: new Date().toISOString() },
        calendarContext: { sourceRequestID: randomUUID(), referenceTime: new Date().toISOString(), timeZone: 'Asia/Shanghai' },
        assertCurrent: () => assertAuthority('source'),
        ...(continuation ? { continuation: async () => continuation } : {}),
      };
      result = await provider.run(request, invokeTool, external.signal);
      record('host_success', { turns: result.turns, completions: result.toolCompletions.length,
        terminalReason: result.terminalReason });
    }
  } catch (error) {
    failure = { name: error.name, code: error.message,
      ...(error instanceof runtime.ClaudeHarnessInterruption || error instanceof runtime.ClaudeHarnessFailure ? { receipt: error.receipt } : {}) };
    record('host_failure', { name: error.name, code: error.message });
  } finally {
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

  const expectedSteps = authorityFault ? 1 : mode === 'answer' ? 3 : expect === 'eager' ? 2 : 5;
  const allToolResults = () => traces.flatMap(entry => entry.toolResults).map(entry => `${entry.text}\n${entry.raw}`).join('\n');
  const toolReferenceNames = () => traces.flatMap(entry => entry.toolResults).flatMap(entry => {
    try { return JSON.parse(entry.raw); } catch { return []; }
  }).filter(block => block && block.type === 'tool_reference').map(block => block.tool_name);
  const finalBody = () => result?.structuredOutput?.body ?? null;
  let assertionFailure;
  try {
    assert.equal(serverFailure, undefined, JSON.stringify(serverFailure));
    assert.equal(requests.length, expectedSteps, `expected ${expectedSteps} Messages requests, got ${requests.length}`);
    assert.equal(workspaceRemoved, true, 'The real harness must dispose its own SDK workspace.');
    const first = requests[0];
    const catalogTools = first.tools.filter(tool => catalog.includes((tool.name ?? '').replace(PREFIX, '')));
    const originalName = tool => (tool.name ?? '').replace(PREFIX, '');
    const essentialTools = first.tools.filter(tool => essential.includes(originalName(tool)));
    if (mode !== 'answer') {
      assert.deepEqual(essentialTools.map(originalName).sort(), [...essential].sort(),
        'essential tools must be present, not an empty schema-check loop');
      for (const tool of essentialTools) assert(tool.schemaBytes > 0, `${tool.name} must stay visible upfront`);
    }
    if (authorityFault) {
      assert.equal(authority.searchGates, 1);
      assert(authority.rejectedChecks > 0, 'the production authority callback must reject at discovery');
      assert.equal(toolReferenceNames().length, 0, 'revoked discovery must expose no tool references');
      assert.equal(invokeCalls.length, 0);
      assert.deepEqual(completions, []);
      assert.equal(result, undefined);
      assert.equal(failure?.code, authorityFault === 'source' ? 'SOURCE_REVOKED' : 'GENERATION_REVOKED');
      if (authorityFault === 'lease') {
        assert(authority.leaseChecks > 1, 'the host-issued lease must be admitted before it is revoked');
        assert.equal(authority.leaseFinished, false, 'the SDK lease must finish as failed after cleanup');
        assert.equal(sessionEntries.size, 0);
      }
    } else if (expect === 'eager' && mode === 'answer') {
      assert.equal(first.toolSearchVisible, false);
      assert.equal(sdkOptions.enableToolSearch, null, 'legacy runs must not force SDK tool search');
      assert(sdkOptions.tools.every(name => name !== 'ToolSearch'));
      const answerTools = first.tools.filter(tool => ANSWER_TOOLS.includes((tool.name ?? '').replace(PREFIX, '')));
      assert.equal(answerTools.length, ANSWER_TOOLS.length, 'legacy relationship answers keep their full tool set');
      for (const tool of answerTools) assert(tool.schemaBytes > 0, `${tool.name} must keep its full schema eagerly`);
      assert.deepEqual(completions, ['read_relationship_memory', 'cite_evidence']);
      assert.equal(harnessToolCalls, 2);
      assert.equal(providerAnswer?.body, FINAL);
      assert.deepEqual(providerAnswer?.citation_ids, [SOURCE]);
    } else if (expect === 'eager') {
      assert.equal(first.toolSearchVisible, false);
      assert.equal(sdkOptions.enableToolSearch, null, 'legacy runs must not force SDK tool search');
      assert(sdkOptions.tools.every(name => name !== 'ToolSearch'));
      assert.equal(catalogTools.length, catalog.length, 'legacy runs keep the full admitted catalog in the first request');
      for (const tool of catalogTools) assert(tool.schemaBytes > 0, `${tool.name} must keep its full schema eagerly`);
      for (const tool of essentialTools) assert(tool.schemaBytes > 0);
      assert.equal(invokeCalls.length, 1);
      assert.equal(invokeCalls[0].name, 'contact_workspace');
      assert.equal(invokeCalls[0].input.operation, 'search');
      assert.deepEqual(completions, ['contact_workspace_search']);
      assert.equal(harnessToolCalls, 1);
      assert.equal(finalBody(), mode === 'json' ? 'Synthetic scoped answer.' : FINAL);
    } else {
      assert.equal(sdkOptions.enableToolSearch, 'true', 'bounded runs must explicitly enable SDK tool search');
      assert(sdkOptions.tools.includes('ToolSearch'));
      assert(sdkOptions.allowedTools.includes('ToolSearch'));
      assert.equal(first.toolSearchVisible, true, 'ToolSearch must be visible in the first request');
      assert.deepEqual(first.catalogVisibility, Object.fromEntries(catalog.map(name => [name, true])),
        'every admitted capability remains visible by its original catalog name');
      const deferredTools = catalogTools.filter(tool => deferred.includes(originalName(tool)));
      assert(deferredTools.every(tool => tool.schemaBytes === 0),
        `secondary catalog schemas must stay out of the first request: ${JSON.stringify(deferredTools)}`);
      const coreTools = catalogTools.filter(tool => CORE.includes(originalName(tool)));
      assert.deepEqual(coreTools.map(originalName).sort(), [...CORE].sort(), 'core Memory must be present without discovery');
      for (const tool of coreTools) assert(tool.schemaBytes > 0, `${tool.name} must stay visible upfront`);
      assert(catalogTools.find(tool => originalName(tool) === 'mcp_connections')?.schemaBytes > 0,
        'the account MCP discovery entry must remain visible before any ToolSearch');
      for (const tool of essentialTools) assert(tool.schemaBytes > 0, `${tool.name} must stay visible upfront`);
      // Discoverability by actual original names and operation semantics,
      // resolved only over this Run's registered MCP catalog.
      const discoveryResults = allToolResults();
      const references = toolReferenceNames();
      assert(references.length > 0, 'genuine discovery must reference registered tools');
      assert(references.every(name => name !== 'NotRegisteredTool'), 'unknown names must never resolve to a tool');
      assert((traces[1]?.toolResults ?? []).some(entry => /contact_workspace|memory_review/.test(`${entry.text}${entry.raw}`)),
        'semantic discovery must surface catalog capabilities');
      for (const name of deferred) assert(references.includes(PREFIX + name), `discovery must reference ${name}`);
      // Dynamic discovery loads the selected capability's real schema.
      const loaded = requests.slice(1).flatMap(entry => entry.tools)
        .filter(tool => (tool.name ?? '').endsWith('mcp_connections'));
      assert(loaded.some(tool => tool.schemaBytes > 0), 'select discovery must load the registered capability schema');
      // Hostile keys never reach governed host execution and are denied.
      assert(invokeCalls.every(call => !JSON.stringify(call.input).includes('PRIVATE_HOSTILE_KEY')));
      assert(invokeCalls.length === 1 && invokeCalls[0].input.query === VALID_QUERY);
      const denialEvidence = (failure?.receipt?.permissionDenials ?? result?.permissionDenials ?? []);
      assert(denialEvidence.includes('TOOL_INPUT_INVALID') || discoveryResults.includes('TOOL_INPUT_INVALID'),
        `hostile keys must be denied: ${JSON.stringify(denialEvidence)}`);
      // Discovery counts once per actual invocation and never as completion.
      assert.deepEqual(completions, ['contact_workspace_search']);
      assert.equal(harnessToolCalls, 3, 'two searches plus one genuine capability call');
      assert.equal(finalBody(), mode === 'json' ? 'Synthetic scoped answer.' : FINAL);
    }
  } catch (error) { assertionFailure = { name: error.name, message: error.message }; }
  return {
    mode, expect, authorityFault: authorityFault ?? null, authority,
    passed: !assertionFailure, assertionFailure: assertionFailure ?? null,
    elapsedMs: Math.round(performance.now() - started), requestCount, requests, traces,
    sdkOptions: sdkOptions ?? null, invokeCalls, completions,
    providerAnswer: providerAnswer ? { body: providerAnswer.body, citation_ids: providerAnswer.citation_ids,
      kind: providerAnswer.kind, input_tokens: providerAnswer.input_tokens, output_tokens: providerAnswer.output_tokens } : null,
    firstToolsBytes: requests[0]?.toolsBytes ?? null,
    result: result ? { structuredOutput: result.structuredOutput, turns: result.turns,
      toolCompletions: result.toolCompletions, permissionDenials: result.permissionDenials,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens, terminalReason: result.terminalReason } : null,
    harnessToolCalls, failure: failure ?? null, workspaceRemoved, events,
  };
}
