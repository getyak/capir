import {
  AccountSettingsSchema,
  AccountMutationSchema,
  CompleteCredentialChangeRequestSchema,
  CredentialChangeAttemptSchema,
  CredentialChangeResultSchema,
  CredentialChangeReadbackSchema,
  ReadCredentialChangeResultRequestSchema,
  ErrorResponseSchema,
  StartCredentialChangeRequestSchema,
  type AccountMutation,
  type CompleteCredentialChangeRequest,
  type ReadCredentialChangeResultRequest,
  type StartCredentialChangeRequest,
} from '@talent-signal/contracts';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Pool } from 'pg';
import type { BackendConfig } from '../config.js';
import { ApiError } from '../lib/apiError.js';
import { mailDeliveryFromConfig } from '../lib/mail.js';
import type { MailDelivery } from '../lib/mail.js';
import { readAccountSettings, mutateAccountSettings } from './accountManagement.js';
import {
  completeCredentialChange,
  readCredentialChangeResult,
  startCredentialChange,
} from './accountLoginMethods.js';
import { registerPasswordSignupRoutes } from './accountPasswordSignup.js';
import { registerAccountReconciliationRoutes } from './accountReconciliation.js';

/**
 * Trusted operation origin: the actual browser Origin when present and
 * allowed, or the client label for native clients. A client-supplied JSON
 * `origin` field is never authority.
 */
function trustedOrigin(config: BackendConfig, request: FastifyRequest, clientLabel: string): string {
  const header = request.headers.origin;
  if (typeof header === 'string' && header.length > 0) {
    if (!config.allowedOrigins.includes(header)) {
      throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'This request origin is not allowed.');
    }
    return header;
  }
  return `client:${clientLabel}`;
}

export function registerAccountManagement(
  app: FastifyInstance,
  pool: Pool,
  authenticate: preHandlerHookHandler,
  config: BackendConfig,
  mail?: MailDelivery,
): void {
  const labEnabled = config.internalLabEnabled === true;
  const response = { 200: AccountSettingsSchema, '4xx': ErrorResponseSchema };
  const security = [{ bearerSession: [] }];
  app.get('/v1/account/settings', { preHandler: authenticate, schema: { tags: ['account'], security, response } }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return readAccountSettings(pool, request.auth, labEnabled);
  });
  app.post<{ Body: AccountMutation }>('/v1/account/settings', {
    preHandler: authenticate,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['account'], security, body: AccountMutationSchema, response },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return mutateAccountSettings(pool, request.auth, request.body, labEnabled);
  });

  // Step-up bound, intent-scoped credential changes. The attempt binds the
  // operation to this account, user, auth session, provider, origin, nonce and
  // revisions; commit rechecks all of them and returns settings readback.
  app.post<{ Body: StartCredentialChangeRequest }>('/v1/account/login-methods/attempts', {
    preHandler: authenticate,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['account'],
      security,
      body: StartCredentialChangeRequestSchema,
      response: { 201: CredentialChangeAttemptSchema, '4xx': ErrorResponseSchema },
    },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return reply.status(201).send(
      await startCredentialChange(
        pool,
        config,
        request.auth,
        request.body,
        trustedOrigin(config, request, request.body.client_label),
      ),
    );
  });

  app.post<{ Body: CompleteCredentialChangeRequest }>('/v1/account/login-methods/complete', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: {
      tags: ['account'],
      security,
      body: CompleteCredentialChangeRequestSchema,
      response: { 200: CredentialChangeResultSchema, '4xx': ErrorResponseSchema },
    },
  }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    return completeCredentialChange(
      pool,
      config,
      request.auth,
      request.body,
      typeof request.headers.origin === 'string' && request.headers.origin.length > 0
        ? request.headers.origin
        : null,
      {},
      labEnabled,
    );
  });

  // Outcome inspection is business-read-only. POST keeps the held proof
  // out of URLs, and all replies (including denied lookups) are non-cacheable.
  app.post<{ Body: ReadCredentialChangeResultRequest }>('/v1/account/login-methods/result', {
    preHandler: authenticate,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    onSend: async (_request, reply, payload) => {
      reply.header('cache-control', 'private, no-store');
      return payload;
    },
    schema: {
      tags: ['account'], security,
      body: ReadCredentialChangeResultRequestSchema,
      response: { 200: CredentialChangeReadbackSchema, '4xx': ErrorResponseSchema },
    },
  }, async (request) => {
    const origin = typeof request.headers.origin === 'string' && request.headers.origin.length > 0
      ? trustedOrigin(config, request, '') : null;
    return readCredentialChangeResult(pool, request.auth, request.body, origin);
  });

  registerPasswordSignupRoutes(app, pool, config, mail ?? mailDeliveryFromConfig(config.mailTransport));
  registerAccountReconciliationRoutes(app, pool, config, authenticate, labEnabled);
}
