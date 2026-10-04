import { events } from './sse.js';
import { fail, object, numeric, LIMIT, type ModelProfile, type Message, type ModelResponse, type Usage } from './types.js';
export interface RequestOptions {
  model: string;
  system: string;
  maxTokens: number;
  stream: boolean;
  textLimit?: number;
}
function json(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (object(value))
      return value;
  }
  catch { }
  fail('CAPIR_MODEL_PROTOCOL', 'Provider returned malformed JSON.', 3);
}
function record(value: unknown): Record<string, unknown> { return object(value) ? value : {}; }
function headers(profile: ModelProfile, key: string): Record<string, string> { return { 'content-type': 'application/json', ...(profile.provider === 'anthropic' ? { 'anthropic-version': '2023-06-01', ...(key ? { 'x-api-key': key } : {}) } : key ? { authorization: `Bearer ${key}` } : {}) }; }
export async function boundedBody(response: Response, signal: AbortSignal, limit: number): Promise<string> {
  if (!response.body)
    fail('CAPIR_MODEL_PROTOCOL', 'Provider returned an empty body.', 3);
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let result = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) {
        result += decoder.decode();
        return result;
      }
      bytes += chunk.value.length;
      if (bytes > limit)
        fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Provider response body exceeds the limit.', 5);
      result += decoder.decode(chunk.value, { stream: true });
    }
  }
  finally {
    await reader.cancel().catch(() => { });
    reader.releaseLock();
  }
}
async function checkHTTP(response: Response, signal: AbortSignal) {
  if (response.ok)
    return;
  try {
    await boundedBody(response, signal, LIMIT.error);
  }
  catch { /* never expose an untrusted error body */ }
  const status = response.status;
  fail('CAPIR_MODEL_HTTP', `Provider HTTP ${status}; no automatic retry was made.`, status === 401 || status === 403 ? 4 : status === 429 ? 5 : 3);
}
export async function generate(profile: ModelProfile, key: string, options: RequestOptions, messages: Message[], onText: (text: string) => Promise<void>, signal: AbortSignal): Promise<ModelResponse> {
  const anthropic = profile.provider === 'anthropic';
  const body: Record<string, unknown> = { model: options.model, stream: options.stream, messages: anthropic ? messages : [...(options.system ? [{ role: profile.system_role ?? 'system', content: options.system }] : []), ...messages], ...(anthropic ? { max_tokens: options.maxTokens, ...options.system ? { system: options.system } : {} } : { [profile.token_limit_field ?? 'max_completion_tokens']: options.maxTokens }) };
  if (!anthropic && options.stream && profile.stream_usage)
    body.stream_options = { include_usage: true };
  const response = await fetch(profile.base_url + (anthropic ? '/messages' : '/chat/completions'), { method: 'POST', headers: headers(profile, key), body: JSON.stringify(body), redirect: 'error', signal });
  await checkHTTP(response, signal);
  let text = '';
  let textBytes = 0;
  let finish: string | null = null;
  let terminal = false;
  let supported = false;
  let refused = false;
  let tools = false;
  const usage: Usage = { input_tokens: null, output_tokens: null, total_tokens: null };
  const updateUsage = (u: unknown) => {
    const value = record(u);
    if (anthropic) {
      if (Object.hasOwn(value, 'input_tokens'))
        usage.input_tokens = numeric(value.input_tokens);
      if (Object.hasOwn(value, 'output_tokens'))
        usage.output_tokens = numeric(value.output_tokens);
    }
    else {
      usage.input_tokens = numeric(value.prompt_tokens);
      usage.output_tokens = numeric(value.completion_tokens);
      usage.total_tokens = numeric(value.total_tokens);
    }
  };
  const append = async (value: unknown) => {
    if (typeof value !== 'string')
      return;
    supported = true;
    textBytes += Buffer.byteLength(value);
    if (textBytes > (options.textLimit ?? LIMIT.text))
      fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Response exceeds the text/context budget; this turn is incomplete.', 5);
    text += value;
    await onText(value);
  };
  const reason = (value: unknown) => {
    if (typeof value !== 'string')
      return;
    if (finish !== null && finish !== value)
      fail('CAPIR_MODEL_PROTOCOL', 'Provider sent conflicting terminal reasons; response is incomplete.', 3);
    finish = value;
  };
  try {
    if (options.stream) {
      if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || !response.body)
        fail('CAPIR_MODEL_PROTOCOL', 'Expected an SSE response.', 3);
      for await (const event of events(response.body, signal)) {
        if (!anthropic && !['message', 'error'].includes(event.event))
          continue;
        if (!anthropic && event.data === '[DONE]') {
          terminal = true;
          break;
        }
        if (anthropic && !['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop', 'error'].includes(event.event))
          continue;
        const data = json(event.data);
        if (data.error || event.event === 'error' || data.type === 'error')
          fail('CAPIR_MODEL_PROVIDER_ERROR', 'Provider reported an in-band error; the response is incomplete.', 3);
        if (anthropic) {
          if (data.type !== event.event)
            fail('CAPIR_MODEL_PROTOCOL', 'Anthropic event type does not match its data.', 3);
          if (event.event === 'message_start')
            updateUsage(record(data.message).usage);
          else if (event.event === 'content_block_start') {
            const block = record(data.content_block);
            if (block.type === 'text')
              await append(block.text);
            else if (block.type === 'tool_use')
              tools = true;
          }
          else if (event.event === 'content_block_delta') {
            const delta = record(data.delta);
            if (delta.type === 'text_delta')
              await append(delta.text);
          }
          else if (event.event === 'message_delta') {
            reason(record(data.delta).stop_reason);
            if (data.usage)
              updateUsage(data.usage);
          }
          else if (event.event === 'message_stop') {
            terminal = true;
            break;
          }
        }
        else {
          if (data.usage)
            updateUsage(data.usage);
          if (!Array.isArray(data.choices))
            fail('CAPIR_MODEL_PROTOCOL', 'OpenAI stream has no choices array.', 3);
          const choice = record(data.choices.find(x => record(x).index === 0));
          const delta = record(choice.delta);
          if (delta.refusal)
            refused = true;
          if (delta.tool_calls || delta.function_call)
            tools = true;
          await append(delta.content);
          reason(choice.finish_reason);
        }
      }
    }
    else {
      const data = json(await boundedBody(response, signal, LIMIT.body));
      if (data.error)
        fail('CAPIR_MODEL_PROVIDER_ERROR', 'Provider reported an error.', 3);
      updateUsage(data.usage);
      if (anthropic) {
        if (Array.isArray(data.content))
          for (const value of data.content) {
            const block = record(value);
            if (block.type === 'text')
              await append(block.text);
            else if (block.type === 'tool_use')
              tools = true;
          }
        reason(data.stop_reason);
      }
      else {
        const choices = Array.isArray(data.choices) ? data.choices : [];
        const choice = record(choices.find(x => record(x).index === 0) ?? choices[0]);
        const message = record(choice.message);
        if (message.refusal)
          refused = true;
        if (message.tool_calls || message.function_call)
          tools = true;
        await append(message.content);
        reason(choice.finish_reason);
      }
      terminal = true;
    }
    if (!terminal || !finish)
      fail('CAPIR_MODEL_INCOMPLETE', 'Provider ended without required terminal markers; partial response.', 3);
    if (refused || finish === 'content_filter' || finish === 'refusal')
      fail('CAPIR_MODEL_REFUSAL', 'The model refused the request.', 1);
    if (finish === 'length' || finish === 'max_tokens')
      fail('CAPIR_MODEL_TOKEN_LIMIT', 'Token budget reached; partial response.', 5);
    if (tools || !['stop', 'end_turn', 'stop_sequence'].includes(finish))
      fail('CAPIR_MODEL_UNSUPPORTED', 'Unsupported model completion; no tools were executed.', 3);
    if (!supported || text.length === 0)
      fail('CAPIR_MODEL_NO_TEXT', 'The model returned no supported text.', 3);
    return { text, finish_reason: finish, usage };
  }
  catch (error) {
    if (error instanceof Error)
      Object.assign(error, { finish_reason: finish, usage });
    throw error;
  }
}
export async function discover(profile: ModelProfile, key: string, signal: AbortSignal) {
  const response = await fetch(profile.base_url + '/models', { headers: headers(profile, key), redirect: 'error', signal });
  await checkHTTP(response, signal);
  const data = json(await boundedBody(response, signal, LIMIT.discovery));
  if (!Array.isArray(data.data))
    fail('CAPIR_MODEL_DISCOVERY_UNAVAILABLE', 'Provider does not expose supported model discovery.', 3);
  const models = data.data.slice(0, 100).map(value => {
    const model = record(value);
    if (typeof model.id !== 'string' || model.id.length > 200)
      fail('CAPIR_MODEL_PROTOCOL', 'Invalid model catalog entry.', 3);
    return { id: model.id, ...typeof model.display_name === 'string' ? { display_name: model.display_name.slice(0, 200) } : {} };
  });
  return { models, has_more: typeof data.has_more === 'boolean' ? data.has_more || data.data.length > 100 : data.data.length > 100 ? true : null, cursor: typeof data.last_id === 'string' ? data.last_id.slice(0, 200) : null };
}
