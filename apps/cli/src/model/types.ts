import { CapirCliError } from '../errors.js';
export type Provider = 'openai-compatible' | 'anthropic';
export interface ModelProfile {
  provider: Provider;
  base_url: string;
  model: string;
  auth: 'environment' | 'none';
  api_key_env?: string;
  token_limit_field?: 'max_completion_tokens' | 'max_tokens';
  system_role?: 'system' | 'developer';
  stream_usage?: boolean;
}
export interface ModelConfig {
  schema_version: 'capir.models.v1';
  default_profile: string | null;
  profiles: Record<string, ModelProfile>;
}
export interface SelectedProfile {
  name: string;
  profile: ModelProfile;
}
export interface ModelArgs {
  command: string;
  positionals: string[];
  values: Record<string, string>;
  flags: Set<string>;
}
export interface Message {
  role: 'user' | 'assistant';
  content: string;
}
export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}
export interface ModelResponse {
  text: string;
  finish_reason: string | null;
  usage: Usage;
}
export const LIMIT = { input: 128 * 1024, context: 256 * 1024, turns: 64, text: 2 * 1024 * 1024, event: 256 * 1024, body: 8 * 1024 * 1024, error: 8192, config: 64 * 1024, discovery: 1024 * 1024 };
export function fail(code: string, message: string, exit: 0 | 1 | 2 | 3 | 4 | 5 | 130 = 2): never { throw new CapirCliError(code, exit, message); }
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function numeric(value: unknown): number | null { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null; }
