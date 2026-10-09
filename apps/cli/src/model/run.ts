import { CapirCliError } from '../errors.js';
import { resolveEnvironment } from '../config.js';
import { parseModelArgs } from './args.js';
import { loadConfig, mutateConfig, selectProfile, credential, validateProfile, profileName } from './config.js';
import { fail, LIMIT, type ModelArgs, type SelectedProfile } from './types.js';
import { readInput } from './input.js';
import { generate, discover, type RequestOptions } from './provider.js';
import { sanitize, SafeText, writeOutput, OutputAborted } from './output.js';
import { runChat } from './chat.js';
export let forceModelExit = false;
async function print(value: unknown, human: boolean, signal: AbortSignal) { await writeOutput(human ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`, signal); }
function addProfile(args: ModelArgs) {
  const v = args.values;
  const provider = v.provider;
  return validateProfile({ provider, base_url: v['base-url'], model: v.model, auth: v.auth ?? 'environment', ...(v['api-key-env'] !== undefined ? { api_key_env: v['api-key-env'] } : {}), ...(provider === 'openai-compatible' ? { token_limit_field: v['token-limit-field'] ?? 'max_completion_tokens', system_role: v['system-role'] ?? 'system', stream_usage: args.flags.has('stream-usage') } : Object.fromEntries(['token-limit-field', 'system-role', 'stream-usage'].filter(x => args.flags.has(x)).map(x => [x, true]))) });
}
export async function runModelCli(argv: string[]): Promise<boolean> {
  forceModelExit = false;
  let args: ModelArgs | null = null;
  let selected: SelectedProfile | undefined;
  let key = '';
  let safe: SafeText | undefined;
  let partial = '';
  let partialBytes = 0;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => controller.abort(new CapirCliError('CAPIR_MODEL_CANCELLED', 130, 'Cancelled; the response is incomplete.'));
  const outputError = (error: NodeJS.ErrnoException) => controller.abort(new CapirCliError(error.code === 'EPIPE' ? 'CAPIR_MODEL_PIPE_CLOSED' : 'CAPIR_MODEL_OUTPUT', error.code === 'EPIPE' ? 0 : 3, error.code === 'EPIPE' ? 'Output pipe closed.' : 'Output could not be written.'));
  process.once('SIGINT', cancel);
  process.stdout.on('error', outputError);
  const diagnosticError = () => controller.abort(new CapirCliError('CAPIR_MODEL_OUTPUT', 3, 'Diagnostic output is unavailable.'));
  process.stderr.on('error', diagnosticError);
  const deadline = (seconds = 120) => { if (timer)
    return; timer = setTimeout(() => controller.abort(new CapirCliError('CAPIR_MODEL_TIMEOUT', 3, 'Request deadline exceeded; no automatic retry.')), seconds * 1000); };
  try {
    args = parseModelArgs(argv);
    if (!args)
      return false;
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    if (!(major > 22 || major === 22 && minor >= 19))
      fail('CAPIR_MODEL_RUNTIME', 'Upgrade Node to >=22.19.0 before using direct model commands.', 3);
    // Chat owns a separate deadline for each generation, not its idle session.
    if (args.command !== 'chat')
      deadline(Number(args.values.timeout ?? 120));
    if (args.command === 'auto') {
      if (process.stdin.isTTY)
        return false;
      deadline();
      const input = await readInput(controller.signal, LIMIT.input);
      if (!input)
        return false;
      args.command = 'ask';
      args.positionals = [input];
      args.flags.add('input-collected');
    }
    if (args.flags.has('help')) {
      await print({ schema_version: 'capir.v1', ok: true, commands: ['ask <text> [--profile name] [--json]', 'chat [--profile name]', 'models add|list|show|use|remove', 'doctor [--profile name]'], note: 'Explicit environment-name model keys; auth/sandbox configuration is independent.' }, true, controller.signal);
      return true;
    }
    if (args.command.startsWith('models ')) {
      const command = args.command;
      const name = args.positionals[0];
      let result: unknown;
      if (command === 'models add') {
        profileName(name);
        const profile = addProfile(args);
        const config = mutateConfig(process.env, c => {
          if (Object.hasOwn(c.profiles, name!) && !args!.flags.has('replace'))
            fail('CAPIR_MODEL_EXISTS', 'Profile exists; use --replace explicitly.');
          c.profiles[name!] = profile;
          if (args!.flags.has('default'))
            c.default_profile = name!;
        });
        result = { profile: name, ...profile, default_profile: config.default_profile };
      }
      else if (command === 'models use' || command === 'models remove') {
        profileName(name);
        const config = mutateConfig(process.env, c => {
          selectProfile(c, name);
          if (command === 'models use')
            c.default_profile = name!;
          else {
            delete c.profiles[name!];
            if (c.default_profile === name)
              c.default_profile = null;
          }
        });
        result = { profile: name, default_profile: config.default_profile };
      }
      else {
        const config = loadConfig(process.env);
        if (command === 'models show')
          result = selectProfile(config, name);
        else {
          if (args.flags.has('remote')) {
            selected = selectProfile(config, args.values.profile);
            key = credential(selected.profile, process.env);
            deadline();
            const catalog = await discover(selected.profile, key, controller.signal);
            result = { profile: selected.name, ...catalog, models: catalog.models.map(m => ({ id: sanitize(m.id, key), ...m.display_name !== undefined ? { display_name: sanitize(m.display_name, key) } : {} })), cursor: catalog.cursor === null ? null : sanitize(catalog.cursor, key) };
          }
          else
            result = { default_profile: config.default_profile, profiles: Object.entries(config.profiles).map(([name, profile]) => ({ name, ...profile })) };
        }
      }
      await print({ schema_version: 'capir.v1', ok: true, command, ...result as object }, args.flags.has('human'), controller.signal);
      return true;
    }
    if (args.command === 'doctor') {
      const checks: Record<string, unknown> = { runtime: process.versions.node, required_runtime: '>=22.19.0', runtime_supported: true, network: 'not_checked', authorization: 'not_checked', sandbox: 'not_selected' };
      let failure: CapirCliError | undefined;
      try {
        const selected = selectProfile(loadConfig(process.env), args.values.profile);
        credential(selected.profile, process.env);
        checks.profile = selected.name;
        checks.endpoint = 'syntax_valid';
        checks.credential = 'configured';
      }
      catch (e) {
        failure = e as CapirCliError;
        checks.model_setup = 'failed';
      }
      if (args.values.env) {
        try {
          resolveEnvironment(args.values.env);
          checks.sandbox = 'origins_valid_grant_not_checked';
        }
        catch {
          checks.sandbox = 'configuration_invalid';
          failure ??= new CapirCliError('CAPIR_ENVIRONMENT_INVALID', 2, 'Check the selected sandbox environment configuration.');
        }
      }
      await print({ schema_version: 'capir.v1', command: 'doctor', ok: !failure, checks, ...failure ? { error: { code: failure.code, message: failure.message } } : {} }, args.flags.has('human'), controller.signal);
      process.exitCode = failure?.exitCode ?? 0;
      return true;
    }
    if (args.command === 'chat') {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        fail('CAPIR_MODEL_TTY', 'Chat requires an interactive input/output terminal.');
      selected = selectProfile(loadConfig(process.env), args.values.profile);
      key = credential(selected.profile, process.env);
      const model = args.values.model ?? selected.profile.model;
      validateProfile({ ...selected.profile, model });
      const system = args.values.system ?? '';
      if (Buffer.byteLength(system) > LIMIT.input)
        fail('CAPIR_MODEL_INPUT_LIMIT', 'System instruction exceeds 128 KiB.');
      process.exitCode = await runChat(selected, key, { model, system, maxTokens: Number(args.values['max-tokens'] ?? 1024), stream: !args.flags.has('no-stream') }, Number(args.values.timeout ?? 120), controller.signal, cancel);
      return true;
    }
    if (!timer)
      deadline(Number(args.values.timeout ?? 120));
    const stdin = args.flags.has('input-collected') ? '' : !process.stdin.isTTY || args.flags.has('stdin') ? await readInput(controller.signal, LIMIT.input) : '';
    const positional = args.positionals.join(' ');
    const input = stdin && positional ? `${stdin}\n\n${positional}` : stdin || positional;
    const system = args.values.system ?? '';
    if (!input.trim())
      fail('CAPIR_MODEL_INPUT', 'Supply prompt text or pipe nonempty UTF-8 input.');
    if (Buffer.byteLength(input) + Buffer.byteLength(system) > LIMIT.input)
      fail('CAPIR_MODEL_INPUT_LIMIT', 'Combined prompt/system exceeds 128 KiB; send less text.');
    selected = selectProfile(loadConfig(process.env), args.values.profile);
    key = credential(selected.profile, process.env);
    const model = args.values.model ?? selected.profile.model;
    validateProfile({ ...selected.profile, model });
    const options: RequestOptions = { model, system, maxTokens: Number(args.values['max-tokens'] ?? 1024), stream: !args.flags.has('no-stream') };
    safe = new SafeText(key);
    const emit = async (text: string) => {
      const chunk = safe!.push(text);
      partialBytes += Buffer.byteLength(chunk);
      if (partialBytes > LIMIT.text)
        fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Sanitized response exceeds 2 MiB; partial response.', 5);
      partial += chunk;
      if (!args!.flags.has('json') && options.stream && chunk)
        await writeOutput(chunk, controller.signal);
    };
    const result = await generate(selected.profile, key, options, [{ role: 'user', content: input }], emit, controller.signal);
    const tail = safe.finish();
    partialBytes += Buffer.byteLength(tail);
    if (partialBytes > LIMIT.text)
      fail('CAPIR_MODEL_RESPONSE_LIMIT', 'Sanitized response exceeds 2 MiB; partial response.', 5);
    partial += tail;
    if (args.flags.has('json'))
      await writeOutput(JSON.stringify({ schema_version: 'capir.v1', ok: true, command: 'ask', profile: selected.name, provider: selected.profile.provider, model: sanitize(model, key), response: { text: partial, complete: true, finish_reason: result.finish_reason }, usage: result.usage }) + '\n', controller.signal);
    else {
      if (options.stream) {
        if (tail)
          await writeOutput(tail, controller.signal);
      }
      else
        await writeOutput(partial, controller.signal);
      if (!partial.endsWith('\n'))
        await writeOutput('\n', controller.signal);
    }
    return true;
  }
  catch (error) {
    if (!args && error instanceof Error && 'parsedModelArgs' in error)
      args = (error as Error & {
        parsedModelArgs: ModelArgs;
      }).parsedModelArgs;
    const aborted = controller.signal.aborted ? controller.signal.reason : error instanceof OutputAborted ? error.reason : undefined;
    const e = aborted instanceof CapirCliError ? aborted : error instanceof CapirCliError ? error : (error as {
      input?: boolean;
    })?.input ? new CapirCliError('CAPIR_MODEL_INPUT', 2, 'Input must be valid UTF-8 and within 128 KiB.') : new CapirCliError('CAPIR_MODEL_TRANSPORT', 3, 'Model request could not be completed; no automatic retry.');
    process.exitCode = e.exitCode;
    if (e.exitCode === 0)
      return true;
    const outputFailure = async (cause: unknown) => {
      const reason = controller.signal.aborted ? controller.signal.reason : cause instanceof OutputAborted ? cause.reason : cause;
      const failure = reason instanceof CapirCliError ? reason : new CapirCliError('CAPIR_MODEL_OUTPUT', 3, 'Output could not be completed.');
      process.exitCode = failure.exitCode;
      if (failure.exitCode === 0)
        return;
      forceModelExit = true;
      controller.abort(failure);
      // Node keeps pending stdio write requests alive even after unref().
      // Flush a bounded diagnostic, then the entry exits after owned cleanup.
      const flush = new AbortController();
      const flushTimer = setTimeout(() => flush.abort(failure), 100);
      try {
        await writeOutput(`${failure.code}: ${sanitize(failure.message, key)} Partial output.\n`, flush.signal, process.stderr);
      }
      catch { /* no recursive output recovery */ }
      finally {
        clearTimeout(flushTimer);
      }
    };
    if (process.stdout.destroyed || error instanceof OutputAborted) {
      await outputFailure(error);
      return true;
    }
    let tail = safe?.finish() ?? '';
    if (Buffer.byteLength(partial) + Buffer.byteLength(tail) > LIMIT.text)
      tail = '';
    partial += tail;
    if (!timer && args?.command !== 'chat')
      deadline();
    // An already cancelled request may deliver its final error once, using a
    // short cleanup budget; it never regains generation authority.
    const cleanup = new AbortController();
    const cleanupTimer = controller.signal.aborted || args?.command === 'chat' ? setTimeout(() => cleanup.abort(e), 1000) : undefined;
    const errorSignal = cleanupTimer ? cleanup.signal : controller.signal;
    try {
      if (args?.command === 'ask' || args?.command === 'chat') {
        if (args.flags.has('json')) {
          await print({ schema_version: 'capir.v1', ok: false, command: args.command, ...selected ? { profile: selected.name, provider: selected.profile.provider, model: sanitize(args.values.model ?? selected.profile.model, key) } : {}, error: { code: e.code, message: sanitize(e.message, key) }, response: { text: partial, complete: false, finish_reason: typeof (error as {
                finish_reason?: unknown;
              })?.finish_reason === 'string' ? sanitize((error as {
                finish_reason: string;
              }).finish_reason, key) : null }, usage: (error as {
              usage?: unknown;
            })?.usage ?? { input_tokens: null, output_tokens: null, total_tokens: null } }, false, errorSignal);
        }
        else {
          if (tail && !args.flags.has('no-stream'))
            await writeOutput(tail, errorSignal);
          if (partial && !args.flags.has('no-stream') && !partial.endsWith('\n'))
            await writeOutput('\n', errorSignal);
          await writeOutput(`${e.code}: ${sanitize(e.message, key)}${partial ? ' Partial response; this turn did not complete.' : ''}\n`, errorSignal, process.stderr);
        }
      }
      else
        await print({ schema_version: 'capir.v1', ok: false, command: args?.command ?? 'model', error: { code: e.code, message: sanitize(e.message, key) } }, false, errorSignal);
    }
    catch (outputError) {
      await outputFailure(outputError);
    }
    finally {
      if (cleanupTimer)
        clearTimeout(cleanupTimer);
    }
    return true;
  }
  finally {
    if (timer)
      clearTimeout(timer);
    process.off('SIGINT', cancel);
    process.stdout.off('error', outputError);
    process.stderr.off('error', diagnosticError);
  }
}
