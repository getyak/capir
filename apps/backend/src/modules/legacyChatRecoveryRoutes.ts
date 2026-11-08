import { Type } from "@sinclair/typebox";
import { CONTRACT_VERSION, ErrorResponseSchema, UnscopedChatTaskResponseSchema } from "@talent-signal/contracts";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { Pool } from "pg";
import type { BackendConfig } from "../config.js";
import { ApiError } from "../lib/apiError.js";
import { admitLegacyChatAuthority } from "./legacyChatAuthority.js";
import { cancelLegacyChatExecution, readLegacyChatStatus, resolveLegacyChatExecution } from "./legacyChatRecovery.js";

const Key = Type.Object({ idempotency_key: Type.String({ minLength: 1,maxLength: 128,pattern: "^[^\\u0000]+$" }) },{ additionalProperties: false });
const Status = Type.Object({ contract_version: Type.Literal(CONTRACT_VERSION),task_id: Type.String({ format: "uuid" }),
  state: Type.Union(["admitted","dispatch_started","result_ready","completed","cancelled","expired",
    "authority_lost","unknown","result_unavailable","content_unavailable"].map(state => Type.Literal(state))) },{ additionalProperties: false });
type KeyInput = { idempotency_key: string };

export function registerLegacyChatRecoveryRoutes(app: FastifyInstance,pool: Pool,config: BackendConfig,
  authenticate: preHandlerHookHandler,audience?: readonly string[]): void {
  const response = { 200: Status,201: UnscopedChatTaskResponseSchema,"4xx": ErrorResponseSchema,"5xx": ErrorResponseSchema };
  const security = [{ bearerSession: [] }];
  const rejectExtra = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => key !== "idempotency_key")) throw new ApiError(400,"LEGACY_CHAT_RECOVERY_INVALID","Provide only the original idempotency key.");
  };
  const onRequest = async (_request: FastifyRequest,reply: { header: (key: string,value: string) => unknown }) => {
    reply.header("cache-control","private, no-store");
  };
  const options = { preHandler: authenticate,onRequest,config: { rateLimit: { max: 120,timeWindow: "1 minute" } } };
  app.get<{ Querystring: KeyInput }>("/v1/chat/unscoped-task-status",{
    ...options,preValidation: async request => rejectExtra(request.query),schema: { security,querystring: Key,response },
  },async (request,reply) => {
    const authority = await admitLegacyChatAuthority(pool,request.auth,request.headers.authorization,config,audience);
    try {
      const state = await readLegacyChatStatus({ pool,auth: request.auth,authority,key: request.query.idempotency_key });
      if (state.completed) return reply.header("idempotent-replayed",true).status(201).send(state.completed.body);
      return { contract_version: CONTRACT_VERSION,task_id: state.taskID,state: state.state };
    } finally { authority.dispose(); }
  });
  app.post<{ Body: KeyInput }>("/v1/chat/unscoped-task-cancel",{
    ...options,bodyLimit: 2048,preValidation: async request => rejectExtra(request.body),schema: { security,body: Key,response },
  },async (request,reply) => {
    const authority = await admitLegacyChatAuthority(pool,request.auth,request.headers.authorization,config,audience);
    try {
      const state = await cancelLegacyChatExecution({ pool,auth: request.auth,authority,key: request.body.idempotency_key });
      if (state.completed) return reply.header("idempotent-replayed",true).status(201).send(state.completed.body);
      return { contract_version: CONTRACT_VERSION,task_id: state.taskID,state: state.state };
    } finally { authority.dispose(); }
  });
  app.post<{ Body: KeyInput }>("/v1/chat/unscoped-task-resolve",{
    ...options,bodyLimit: 2048,preValidation: async request => rejectExtra(request.body),schema: { security,body: Key,response },
  },async (request,reply) => {
    const authority = await admitLegacyChatAuthority(pool,request.auth,request.headers.authorization,config,audience);
    try {
      const result = await resolveLegacyChatExecution({ pool,auth: request.auth,authority,config,key: request.body.idempotency_key });
      return reply.header("idempotent-replayed",result.replayed).status(201).send(result.body);
    } finally { authority.dispose(); }
  });
}
