import { fail, type ModelArgs } from './types.js';
const REQUEST = ['profile', 'model', 'system', 'max-tokens', 'timeout', 'no-stream', 'human', 'stdin', 'json', 'help'];
const SETS: Record<string, string[]> = {
  ask: REQUEST, chat: REQUEST.filter(x => !['stdin', 'json'].includes(x)),
  'models add': ['provider', 'base-url', 'model', 'api-key-env', 'auth', 'token-limit-field', 'system-role', 'stream-usage', 'replace', 'default', 'human', 'json', 'help'],
  'models list': ['remote', 'profile', 'human', 'json', 'help'], 'models show': ['human', 'json', 'help'],
  'models use': ['human', 'json', 'help'], 'models remove': ['human', 'json', 'help'], doctor: ['profile', 'env', 'human', 'json', 'help']
};
const BOOL = new Set(['no-stream', 'human', 'stdin', 'json', 'help', 'remote', 'stream-usage', 'replace', 'default']);
export function parseModelArgs(argv: string[]): ModelArgs | null {
  let args = argv[0] === '--' ? argv.slice(1) : argv.slice();
  if (args[0]?.startsWith('--') && !['--env', '--server', '--version', '--help'].includes(args[0])) {
    let index = 0;
    const valueFlags = new Set([...Object.values(SETS).flat().filter(flag => !BOOL.has(flag)), 'env', 'server', 'client-label']);
    while (args[index]?.startsWith('-') && args[index] !== '--') {
      const flag = args[index]!.slice(2);
      index += valueFlags.has(flag) ? 2 : 1;
    }
    const root = args[index];
    if (root && ['auth', 'sandbox', 'help', 'test'].includes(root))
      return null;
    if (root && ['ask', 'chat', 'doctor', 'models'].includes(root)) {
      const width = root === 'models' ? 2 : 1;
      args = [...args.slice(index, index + width), ...args.slice(0, index), ...args.slice(index + width)];
    }
    else if (root && !/\s|(?=[^\x00-\x7f])\p{L}/u.test(root) && args[index - 1] !== '--') {
      fail('CAPIR_CLI_UNKNOWN_COMMAND', 'Unknown command; use ask for single-word literal prompts.');
    }
  }
  const first = args[0];
  if (first === undefined)
    return { command: 'auto', positionals: [], values: {}, flags: new Set() };
  if (['auth', 'sandbox', 'help', 'test', '--version', '--help', '-h', '--env', '--server'].includes(first))
    return null;
  let command: string;
  let tokens: string[];
  if (first === 'models') {
    command = `models ${args[1] ?? ''}`;
    tokens = args.slice(2);
    if (!Object.hasOwn(SETS, command))
      fail('CAPIR_CLI_UNKNOWN_COMMAND', 'Use models add, list, show, use or remove.');
  }
  else if (['ask', 'chat', 'doctor'].includes(first)) {
    command = first;
    tokens = args.slice(1);
  }
  else if (first.startsWith('--')) {
    command = 'ask';
    tokens = args;
  }
  else if (/\s|(?=[^\x00-\x7f])\p{L}/u.test(first)) {
    command = 'ask';
    tokens = args;
  }
  else
    return null;
  const result: ModelArgs = { command, positionals: [], values: Object.create(null), flags: new Set() };
  try {
    let literal = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token === '--' && command === 'ask' && !literal) {
        literal = true;
        continue;
      }
      if (literal || !token.startsWith('-')) {
        result.positionals.push(token);
        continue;
      }
      const flag = token === '-h' ? 'help' : token.slice(2);
      if (!token.startsWith('--') && token !== '-h' || !SETS[command]!.includes(flag))
        fail('CAPIR_CLI_UNKNOWN_FLAG', 'This command does not accept the supplied option.');
      result.flags.add(flag);
      if (!BOOL.has(flag)) {
        const value = tokens[++i];
        if (value === undefined || value.startsWith('--'))
          fail('CAPIR_CLI_INVALID_ARGUMENT', `--${flag} requires a value.`);
        if (Object.hasOwn(result.values, flag) && result.values[flag] !== value)
          fail('CAPIR_CLI_INVALID_ARGUMENT', `Conflicting --${flag} values.`);
        result.values[flag] = value;
      }
    }
    if (result.flags.has('json') && result.flags.has('human'))
      fail('CAPIR_CLI_INVALID_ARGUMENT', 'Choose --json or --human.');
    if (command === 'models list' && result.flags.has('profile') && !result.flags.has('remote'))
      fail('CAPIR_CLI_INVALID_ARGUMENT', '--profile requires models list --remote.');
    const target = ['models add', 'models show', 'models use', 'models remove'].includes(command);
    if (command !== 'ask' && result.positionals.length !== (target ? 1 : 0) && !result.flags.has('help'))
      fail('CAPIR_CLI_INVALID_ARGUMENT', target ? 'Supply exactly one profile name.' : 'Unexpected positional text.');
    if (!['ask', 'chat'].includes(first) && !first.startsWith('--') && first !== 'models' && command === 'ask' && result.positionals.length !== 1)
      fail('CAPIR_CLI_INVALID_ARGUMENT', 'Use ask for multiple prompt arguments.');
    for (const [name, max] of [['timeout', 900], ['max-tokens', 16384]] as const) {
      const value = result.values[name];
      if (value !== undefined && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max))
        fail('CAPIR_CLI_INVALID_ARGUMENT', `--${name} must be an integer between 1 and ${max}.`);
    }
    if (first === '--human' && result.positionals.length === 0 && result.flags.size === 1)
      result.command = 'auto';
    if (first.startsWith('--') && result.positionals.length > 1)
      fail('CAPIR_CLI_INVALID_ARGUMENT', 'Use ask for multiple prompt arguments.');
    return result;
  }
  catch (error) {
    if (error instanceof Error)
      Object.assign(error, { parsedModelArgs: result });
    throw error;
  }
}
