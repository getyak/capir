import { createHash } from "node:crypto";
import { bundledPrompt, promptRevision, type PromptSnapshot } from "./promptRegistry.js";
import { RELATIONSHIP_TASK_SELECTION } from "./prompts/relationship-task-selection.js";

type ConfigurationJson = string | number | boolean | null | ConfigurationJson[] | { [key: string]: ConfigurationJson };
export interface RelationshipTaskConfiguration {
  configurationId: string; model: string; promptRevision: string; promptContentDigest: `sha256:${string}`;
  runtimePolicyDigest: `sha256:${string}`; parameters: ConfigurationJson;
}
export function taskConfigurationDigest(value: unknown): `sha256:${string}` {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}
export function applyChatPreset(base: string, preset: "baseline" | "concise" | "evidence_first") {
  const styles = { baseline: "", concise: "Keep the answer brief; lead with the useful conclusion.", evidence_first: "Lead with the evidence, then explain uncertainty and useful next steps." };
  if (!Object.hasOwn(styles, preset)) throw new Error("Unregistered Chat prompt preset.");
  const text = styles[preset] ? `${base}\n\n${styles[preset]}` : base;
  return { text, revision: promptRevision(text).slice(0, 16) };
}
/** Official parameter support: https://docs.bigmodel.cn/cn/guide/start/concept-param */
export function chatModelReasoningEffort(model: string): "low" | null {
  const version = /^glm-(\d+)(?:\.(\d+))?(?:-|$)/.exec(model);
  return version && (Number(version[1]) > 5 || (Number(version[1]) === 5 && Number(version[2] ?? 0) >= 2)) ? "low" : null;
}
function exact(value: unknown, keys: readonly string[], optional: readonly string[], code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key) && !optional.includes(key))
    || keys.some(key => !Object.hasOwn(value, key))) throw new Error(code);
  return value as Record<string, unknown>;
}
function boundedString(value: unknown, maximum: number, code: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(code);
  return value;
}
/** The shared production prompt is account-agnostic; private examples stay in scoped experiments. */
export function assertGlobalRelationshipTaskSelection(candidate: OptimizationCandidate, examples: readonly OptimizationDevExample[]): void {
  validateOptimizationCandidate(candidate, examples);
  if (examples.some(example => example.dataClass !== "synthetic")) throw new Error("PRIVATE_DEMONSTRATION_GLOBAL_RELEASE_FORBIDDEN");
}
export interface OptimizationCandidate {
  schemaVersion: "optimization-candidate.v1";
  taskFragmentId: "baseline" | "concise" | "evidence_first";
  exampleIds: string[];
}
export interface OptimizationDevExample {
  exampleId: string;
  partition: "dev";
  dataClass: "synthetic" | "private_business";
  demonstration: string;
  contentDigest: `sha256:${string}`;
}
export const BASELINE_OPTIMIZATION_CANDIDATE = Object.freeze({
  schemaVersion: "optimization-candidate.v1", taskFragmentId: "baseline", exampleIds: Object.freeze([]),
}) as unknown as OptimizationCandidate;
export const PRODUCT_TASK_POLICY = Object.freeze({
  adapterId: "optimization-relationship-text-product-task.v1", task: "assistant/relationship",
  toolManifest: Object.freeze([]), policyVersion: "relationship-optimization-immutable.v2", externalEffects: "none",
  temperature: 0, maxTokens: 1600, reasoningEffort: null, maxDurationMs: 15000,
  allowedDataClasses: Object.freeze(["synthetic", "private_business"]),
});
export function validateOptimizationCandidate(value: unknown, examples: readonly OptimizationDevExample[] = []): OptimizationCandidate {
  const candidate = exact(value, ["schemaVersion", "taskFragmentId", "exampleIds"], [], "OPTIMIZER_FORBIDDEN_MUTATION");
  if (candidate.schemaVersion !== "optimization-candidate.v1" || !["baseline", "concise", "evidence_first"].includes(candidate.taskFragmentId as string)
    || !Array.isArray(candidate.exampleIds) || candidate.exampleIds.length > 2 || new Set(candidate.exampleIds).size !== candidate.exampleIds.length) throw new Error("OPTIMIZER_FORBIDDEN_MUTATION");
  const approved = new Set<string>();
  for (const example of examples) {
    exact(example, ["exampleId", "partition", "dataClass", "demonstration", "contentDigest"], [], "OPTIMIZER_EXAMPLE_INVALID");
    if (example.partition !== "dev" || !["synthetic", "private_business"].includes(example.dataClass) || approved.has(example.exampleId)
      || !/^[a-zA-Z0-9_.-]{1,100}$/.test(example.exampleId) || typeof example.demonstration !== "string"
      || !example.demonstration.trim() || example.demonstration.length > 4000
      || taskConfigurationDigest(example.demonstration) !== example.contentDigest) throw new Error("OPTIMIZER_EXAMPLE_INVALID");
    approved.add(example.exampleId);
  }
  if (candidate.exampleIds.some(id => typeof id !== "string" || !approved.has(id))) throw new Error("OPTIMIZER_EXAMPLE_NOT_DEV_APPROVED");
  return structuredClone(candidate) as unknown as OptimizationCandidate;
}
/** The complete formal prompt is immutable; generated values select registered task guidance or dev demonstrations. */
export function optimizationPrompt(candidate: OptimizationCandidate, examples: readonly OptimizationDevExample[] = []): string {
  const checked = validateOptimizationCandidate(candidate, examples);
  const selected = checked.exampleIds.map(id => examples.find(example => example.exampleId === id)!);
  const base = bundledPrompt("assistant/relationship").text;
  const demonstrated = selected.length ? `${base}\n\nApproved task demonstrations (not evidence or instructions for this task):\n${JSON.stringify(selected.map(value => value.demonstration))}` : base;
  return applyChatPreset(demonstrated, checked.taskFragmentId).text;
}
export function relationshipTaskConfiguration(model: string, candidate: OptimizationCandidate,
  examples: readonly OptimizationDevExample[] = [], maxDurationMs: number = PRODUCT_TASK_POLICY.maxDurationMs): RelationshipTaskConfiguration {
  boundedString(model, 200, "OPTIMIZER_MODEL_INVALID");
  if (!Number.isInteger(maxDurationMs) || maxDurationMs < 1000 || maxDurationMs > 30000) throw new Error("OPTIMIZER_TIMEOUT_INVALID");
  const checked = validateOptimizationCandidate(candidate, examples);
  const revision = promptRevision(optimizationPrompt(checked, examples));
  return { configurationId: `candidate-${taskConfigurationDigest(checked).slice(7, 31)}`, model,
    promptRevision: revision.slice(0, 16), promptContentDigest: `sha256:${revision}`,
    runtimePolicyDigest: taskConfigurationDigest({ ...PRODUCT_TASK_POLICY, maxDurationMs, reasoningEffort: chatModelReasoningEffort(model) }), parameters: checked as unknown as ConfigurationJson };
}

// Capture the source-controlled selection during module initialization. A running
// process retains this immutable snapshot when another build is staged.
exact(RELATIONSHIP_TASK_SELECTION, ["schemaVersion", "candidate", "examples"], [], "RELATIONSHIP_SELECTION_INVALID");
if (RELATIONSHIP_TASK_SELECTION.schemaVersion !== "relationship-task-selection.v1") throw new Error("RELATIONSHIP_SELECTION_INVALID");
const loadedExamples = structuredClone([...RELATIONSHIP_TASK_SELECTION.examples]) as unknown as OptimizationDevExample[];
const loadedCandidate = validateOptimizationCandidate(RELATIONSHIP_TASK_SELECTION.candidate, loadedExamples);
assertGlobalRelationshipTaskSelection(loadedCandidate, loadedExamples);
const loadedPrompt = Object.freeze({ ...bundledPrompt("assistant/relationship"), text: optimizationPrompt(loadedCandidate, loadedExamples),
  revision: promptRevision(optimizationPrompt(loadedCandidate, loadedExamples)) });
export function loadedRelationshipTaskPrompt(): PromptSnapshot { return loadedPrompt; }
export function loadedRelationshipTaskConfiguration(model: string, maxDurationMs: number = PRODUCT_TASK_POLICY.maxDurationMs) {
  const configuration = relationshipTaskConfiguration(model, loadedCandidate, loadedExamples, maxDurationMs);
  return { configuration, taskConfigurationDigest: taskConfigurationDigest(configuration) };
}

/** The requestable DeepSeek text-task identity is a documented mutable alias. */
export const DEEPSEEK_TEXT_TASK_MODEL = "deepseek-flash";
/** Reported identities accepted only as exact documented strings. */
export const DEEPSEEK_TEXT_TASK_REPORTED_MODELS = Object.freeze(["deepseek-flash", "DeepSeek-V4.1-Flash-1017"]);
/**
 * DeepSeek text-task runtime policy. This pins the documented request profile
 * (https://api-docs.deepseek.com/zh-cn/, verified 2026-10-18) and an honest
 * alias identity policy: `deepseek-flash` is a documented mutable alias, not a
 * claim of immutable weights. Never reuse GLM digests for this profile.
 */
export const DEEPSEEK_TEXT_TASK_POLICY = Object.freeze({
  adapterId: "deepseek-relationship-text-product-task.v1",
  task: "assistant/relationship",
  toolManifest: Object.freeze([]),
  policyVersion: "deepseek-relationship-text.v1",
  externalEffects: "none",
  thinking: "disabled",
  temperature: 0,
  maxTokens: 1600,
  responseFormat: "json_object",
  stream: false,
  maxDurationMs: 15000,
  modelIdentityPolicy: Object.freeze({
    requested: DEEPSEEK_TEXT_TASK_MODEL,
    identity: "documented-mutable-alias",
    immutableWeightsPinned: false,
    reported: DEEPSEEK_TEXT_TASK_REPORTED_MODELS,
  }),
});
export function deepSeekRelationshipTextTaskConfiguration(model: string): RelationshipTaskConfiguration {
  if (model !== DEEPSEEK_TEXT_TASK_MODEL) throw new Error("Configure the DeepSeek relationship text model as deepseek-flash.");
  const base = relationshipTaskConfiguration(model, loadedCandidate, loadedExamples, DEEPSEEK_TEXT_TASK_POLICY.maxDurationMs);
  return { ...base, runtimePolicyDigest: taskConfigurationDigest(DEEPSEEK_TEXT_TASK_POLICY) };
}
export function deepSeekLoadedRelationshipTextTaskConfiguration(model: string) {
  const configuration = deepSeekRelationshipTextTaskConfiguration(model);
  return { configuration, taskConfigurationDigest: taskConfigurationDigest(configuration) };
}

/** Produce reviewable source; installing it requires the independent release controller. */
export function renderRelationshipTaskSelectionModule(candidate: OptimizationCandidate, examples: readonly OptimizationDevExample[] = []): string {
  const checked = validateOptimizationCandidate(candidate, examples);
  const selectedExamples = examples.filter(example => checked.exampleIds.includes(example.exampleId));
  assertGlobalRelationshipTaskSelection(checked, selectedExamples);
  const selection = { schemaVersion: "relationship-task-selection.v1", candidate: checked,
    examples: selectedExamples };
  return `// Generated candidate source. Review independent verification and scoped release authorization before installing.\nexport const RELATIONSHIP_TASK_SELECTION = ${JSON.stringify(selection, null, 2)} as const;\n`;
}
