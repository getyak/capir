import { readSync, fstatSync, mkdirSync, chmodSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { configDirectory } from '../config.js';
import { ProcessLock } from '../lock.js';
import { fail, object, LIMIT, type ModelConfig, type ModelProfile, type SelectedProfile } from './types.js';
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
export function profileName(name: unknown): string { if (typeof name !== 'string' || !NAME.test(name))
  fail('CAPIR_MODEL_CONFIG', 'Profile names must be lowercase letters, digits, underscores or hyphens, starting with a letter (1–32 characters).'); return name; }
export function baseUrl(value: unknown): string {
  if (typeof value !== 'string' || /[\s\x00-\x1f\x7f]/.test(value))
    fail('CAPIR_MODEL_CONFIG', 'Invalid model base URL.');
  let url: URL;
  try {
    url = new URL(value);
  }
  catch {
    fail('CAPIR_MODEL_CONFIG', 'Supply an absolute canonical HTTPS model base URL.');
  }
  const canonical = url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/$/, ''));
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) || url.protocol === 'http:' && !['127.0.0.1', '[::1]'].includes(url.hostname) || !([canonical, `${canonical}/`].includes(value)) || /\/\/|%2e|%2f|%5c/i.test(url.pathname))
    fail('CAPIR_MODEL_CONFIG', 'Use a canonical HTTPS prefix URL without credentials, query, fragment or normalized paths; HTTP requires literal loopback.');
  return canonical;
}
function fields(raw: Record<string, unknown>, allowed: string[]) { if (Object.keys(raw).some(k => !allowed.includes(k)))
  fail('CAPIR_MODEL_CONFIG', 'Unknown model configuration field.'); }
export function validateProfile(raw: unknown): ModelProfile {
  if (!object(raw))
    fail('CAPIR_MODEL_CONFIG', 'Invalid model profile.');
  const provider = raw.provider;
  if (provider !== 'openai-compatible' && provider !== 'anthropic')
    fail('CAPIR_MODEL_CONFIG', 'Choose provider openai-compatible or anthropic.');
  fields(raw, ['provider', 'base_url', 'model', 'auth', 'api_key_env', ...(provider === 'openai-compatible' ? ['token_limit_field', 'system_role', 'stream_usage'] : [])]);
  const url = baseUrl(raw.base_url);
  const model = raw.model;
  if (typeof model !== 'string' || model.length < 1 || model.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(model))
    fail('CAPIR_MODEL_CONFIG', 'Supply a model ID with 1–200 characters and no controls.');
  if (raw.auth !== 'none' && raw.auth !== 'environment')
    fail('CAPIR_MODEL_CONFIG', 'Choose environment authentication or explicit keyless loopback authentication.');
  const result: ModelProfile = { provider, base_url: url, model, auth: raw.auth };
  if (raw.auth === 'none') {
    if (!['127.0.0.1', '[::1]'].includes(new URL(url).hostname) || Object.hasOwn(raw, 'api_key_env'))
      fail('CAPIR_MODEL_CONFIG', 'Keyless authentication requires literal loopback and no key reference.');
  }
  else {
    if (typeof raw.api_key_env !== 'string' || !/^[A-Z_][A-Z0-9_]{0,63}$/.test(raw.api_key_env) || raw.api_key_env === 'CAPIR_TOKEN')
      fail('CAPIR_MODEL_CONFIG', 'Supply an explicit model API-key environment name; CAPIR_TOKEN is scoped sandbox authorization.');
    result.api_key_env = raw.api_key_env;
  }
  if (provider === 'openai-compatible') {
    if (!['max_completion_tokens', 'max_tokens'].includes(String(raw.token_limit_field)) || !['system', 'developer'].includes(String(raw.system_role)) || typeof raw.stream_usage !== 'boolean')
      fail('CAPIR_MODEL_CONFIG', 'Invalid OpenAI request configuration.');
    result.token_limit_field = raw.token_limit_field as NonNullable<ModelProfile['token_limit_field']>;
    result.system_role = raw.system_role as NonNullable<ModelProfile['system_role']>;
    result.stream_usage = raw.stream_usage;
  }
  return result;
}
export function loadConfig(env: NodeJS.ProcessEnv): ModelConfig {
  let raw: unknown;
  try {
    const file = join(configDirectory(env), 'models.json');
    const fd = openSync(file, 'r');
    try {
      const stats = fstatSync(fd);
      if (!stats.isFile() || stats.size > LIMIT.config)
        fail('CAPIR_MODEL_CONFIG', 'Model configuration exceeds 64 KiB or is not a regular file.');
      // Inspect and read the same descriptor. The bounded buffer also denies
      // growth after inspection without allocating from an untrusted size.
      const data = Buffer.alloc(LIMIT.config + 1);
      let bytes = 0;
      while (bytes < data.length) {
        const count = readSync(fd, data, bytes, data.length - bytes, bytes);
        if (count === 0) break;
        bytes += count;
      }
      if (bytes > LIMIT.config)
        fail('CAPIR_MODEL_CONFIG', 'Model configuration exceeds 64 KiB.');
      raw = JSON.parse(data.subarray(0, bytes).toString('utf8'));
    } finally { closeSync(fd); }
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { schema_version: 'capir.models.v1', default_profile: null, profiles: Object.create(null) };
    fail('CAPIR_MODEL_CONFIG', 'Cannot read valid models.json configuration (maximum 64 KiB).');
  }
  if (!object(raw))
    fail('CAPIR_MODEL_CONFIG', 'Invalid model configuration.');
  fields(raw, ['schema_version', 'default_profile', 'profiles']);
  if (raw.schema_version !== 'capir.models.v1' || !object(raw.profiles) || Object.keys(raw.profiles).length > 32 || raw.default_profile !== null && typeof raw.default_profile !== 'string')
    fail('CAPIR_MODEL_CONFIG', 'Invalid model configuration schema.');
  const profiles: Record<string, ModelProfile> = Object.create(null);
  for (const [name, value] of Object.entries(raw.profiles))
    profiles[profileName(name)] = validateProfile(value);
  if (raw.default_profile !== null && !Object.hasOwn(profiles, raw.default_profile as string))
    fail('CAPIR_MODEL_CONFIG', 'Default model profile does not exist.');
  return { schema_version: 'capir.models.v1', default_profile: raw.default_profile as string | null, profiles };
}
export function selectProfile(config: ModelConfig, name?: string): SelectedProfile { const chosen = name ?? config.default_profile; if (!chosen || !Object.hasOwn(config.profiles, chosen))
  fail('CAPIR_MODEL_SETUP', 'Configure models add <name> ... --default or select --profile <name>.'); return { name: chosen, profile: config.profiles[chosen]! }; }
export function credential(profile: ModelProfile, env: NodeJS.ProcessEnv): string {
  if (profile.auth === 'none')
    return '';
  const key = env[profile.api_key_env!] ?? '';
  if (!key.trim())
    fail('CAPIR_MODEL_AUTH', 'Set the selected profile API-key environment variable.', 4);
  if (key.length > 4096 || !/^[\x21-\x7e]+$/.test(key))
    fail('CAPIR_MODEL_AUTH_FORMAT', 'Model API keys must be at most 4096 ASCII characters without whitespace.');
  return key;
}
export function mutateConfig(env: NodeJS.ProcessEnv, change: (config: ModelConfig) => void): ModelConfig {
  const dir = configDirectory(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return new ProcessLock(join(dir, 'models.mutex')).run(() => {
    const config = loadConfig(env);
    change(config);
    if (Object.keys(config.profiles).length > 32)
      fail('CAPIR_MODEL_CONFIG', 'At most 32 model profiles are supported.');
    const data = JSON.stringify(config, null, 2) + '\n';
    if (Buffer.byteLength(data) > LIMIT.config)
      fail('CAPIR_MODEL_CONFIG', 'Model configuration exceeds 64 KiB.');
    const temp = join(dir, `.models-${randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, data);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, join(dir, 'models.json'));
    }
    finally {
      if (fd !== undefined)
        closeSync(fd);
      try {
        unlinkSync(temp);
      }
      catch { /* already renamed */ }
    }
    return config;
  });
}
