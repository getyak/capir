import type { FastifyRequest } from "fastify";

/** URL query parameters may contain one-use auth proofs. Keep paths only. */
export function requestLogUrl(value: string): string {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const end = Math.min(query < 0 ? value.length : query, fragment < 0 ? value.length : fragment);
  return value.slice(0, end);
}

/** Central request/content redaction policy, including ephemeral conversations. */
export function requestLoggerOptions(level = process.env.LOG_LEVEL ?? "info") {
  return {
    level,
    serializers: {
      req(request: FastifyRequest) {
        return { id: request.id, method: request.method, url: requestLogUrl(request.url ?? ""),
          hostname: request.hostname, remoteAddress: request.ip,
          ...(request.socket.remotePort === undefined ? {} : { remotePort: request.socket.remotePort }) };
      },
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.body.payload",
        "body.payload",
        "req.body.messages",
        "body.messages",
        "req.body.messages[*].content",
        "body.messages[*].content",
        "req.body.password",
        "req.body.step_up.password",
        "req.body.step_up.identity_token",
        "req.body.attempt_secret",
        "req.body.code",
        "req.body.verifier",
        "req.body.state",
        "req.body.cancel_secret",
        "req.body.verification_secret",
        "req.body.identity_token",
        "req.body.proof.password",
        "req.body.proof.identity_token",
        "req.body.access_token",
        "req.body.audio_base64",
        "req.body.content_parts[*].content_text",
        "req.body.content_parts[*].content_base64",
        "req.body.image.data_base64",
        "req.body.expected_behavior",
        "req.body.review_note",
        "headers.authorization",
        "body.password",
        "body.step_up.password",
        "body.step_up.identity_token",
        "body.attempt_secret",
        "body.code",
        "body.verifier",
        "body.state",
        "body.cancel_secret",
        "body.verification_secret",
        "body.identity_token",
        "body.proof.password",
        "body.proof.identity_token",
        "body.access_token",
        "body.audio_base64",
        "body.content_parts[*].content_text",
        "body.content_parts[*].content_base64",
        "body.image.data_base64",
        "body.expected_behavior",
        "body.review_note",
        "access_token",
        "password_scrypt",
        "attempt_secret",
        "verification_secret",
        "identity_token",
      ],
      censor: "[redacted]",
    },
  };
}
