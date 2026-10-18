import "server-only";

import {
  TalentSignalHttpError, TimeActivityListResponseSchema, TimeScheduleResponseSchema,
  TimeReviewResponseSchema, PersonSourceSyncListResponseSchema,
  PersonSourceSyncResponseSchema, PersonSourceSyncRunsResponseSchema,
  type TimeScope, type TimeActivityListResponse,
  type TimeScheduleResponse, type TimeScheduleMutationRequest,
  type TimeScheduleDeleteRequest, type TimeReviewRequest, type TimeReviewResponse,
  type PersonSourceSyncDeleteRequest, type PersonSourceSyncListQuery,
  type PersonSourceSyncListResponse, type PersonSourceSyncMutationRequest,
  type PersonSourceSyncResponse, type PersonSourceSyncRunsResponse,
} from "@talent-signal/contracts";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { authenticatedBackendClient } from "./backendAuth";

async function client() {
  const backend = await authenticatedBackendClient();
  if (!backend) throw new TalentSignalHttpError(401, "backend_session_expired", "请重新登录后查看时间记录。", null);
  return backend;
}

function invalid(): never {
  throw new TalentSignalHttpError(502, "time_contract_invalid", "时间记录暂时无法读取，请重试。", null);
}

export async function loadTimeActivities(scope: TimeScope, after?: string): Promise<TimeActivityListResponse> {
  const result = await (await client()).listTimeActivities(scope, after);
  if (!matchesTypeBox(TimeActivityListResponseSchema, result)) invalid();
  return result;
}

function schedule(result: TimeScheduleResponse): TimeScheduleResponse {
  if (!matchesTypeBox(TimeScheduleResponseSchema, result)) invalid();
  return result;
}

export async function loadTimeSchedule(id: string): Promise<TimeScheduleResponse> {
  return schedule(await (await client()).getTimeSchedule(id));
}
export async function saveTimeSchedule(id: string, input: TimeScheduleMutationRequest): Promise<TimeScheduleResponse> {
  return schedule(await (await client()).putTimeSchedule(id, input));
}
export async function removeTimeSchedule(id: string, input: TimeScheduleDeleteRequest): Promise<TimeScheduleResponse> {
  return schedule(await (await client()).deleteTimeSchedule(id, input));
}
export async function reviewTimeScope(input: TimeReviewRequest): Promise<TimeReviewResponse> {
  const result = await (await client()).reviewTimeRange(input);
  if (!matchesTypeBox(TimeReviewResponseSchema, result)) invalid();
  return result;
}

// ---- GET-131 one-person public source periodic observation (additive) ----

function personSourceSync(result: PersonSourceSyncResponse): PersonSourceSyncResponse {
  if (!matchesTypeBox(PersonSourceSyncResponseSchema, result)) invalid();
  return result;
}

export async function loadPersonSourceSyncs(query: PersonSourceSyncListQuery): Promise<PersonSourceSyncListResponse> {
  const result = await (await client()).listPersonSourceSyncs(query);
  if (!matchesTypeBox(PersonSourceSyncListResponseSchema, result)) invalid();
  return result;
}
export async function loadPersonSourceSync(id: string): Promise<PersonSourceSyncResponse> {
  return personSourceSync(await (await client()).getPersonSourceSync(id));
}
export async function savePersonSourceSync(id: string, input: PersonSourceSyncMutationRequest): Promise<PersonSourceSyncResponse> {
  return personSourceSync(await (await client()).putPersonSourceSync(id, input));
}
export async function removePersonSourceSync(id: string, input: PersonSourceSyncDeleteRequest): Promise<PersonSourceSyncResponse> {
  return personSourceSync(await (await client()).deletePersonSourceSync(id, input));
}
export async function loadPersonSourceSyncRuns(id: string): Promise<PersonSourceSyncRunsResponse> {
  const result = await (await client()).listPersonSourceSyncRuns(id);
  if (!matchesTypeBox(PersonSourceSyncRunsResponseSchema, result)) invalid();
  return result;
}
