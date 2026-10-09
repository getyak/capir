import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface BackendConfig {
  allowedOrigins: string[];
  appleSignInAudiences: string[];
  appleSignInEnabled: boolean;
  googleSignInAudiences?: string[];
  databaseUrl: string;
  host: string;
  passwordAuthEnabled: boolean;
  passwordRegistrationEnabled: boolean;
  port: number;
  retentionSweepIntervalMs: number;
  sessionTtlSeconds: number;
  simulatedAuthEnabled: boolean;
  internalLabEnabled?: boolean;
  /** Internal test-account provisioning (`capir test create`). Disabled by default. */
  capirTests?: {
    enabled: boolean;
    /** High-entropy operator service credential; only its hash reaches the database. */
    provisioningKey?: string;
    /** Operator credential generation; rotation must bump it to revoke live entries. */
    provisioningGeneration: number;
    /** Exact registered origin pair for provisioning requests and Web entry. */
    webOrigin?: string;
    backendOrigin?: string;
    /** Trusted Web consumer key for the private one-use handoff exchange. */
    webConsumerKey?: string;
    maxActiveRuns: number;
  } | undefined;
  /**
   * Browser-owned CLI authorization (`capir-auth.v2`). Disabled by default and
   * enabled only through the explicit CAPIR_AUTH_ENABLED gate together with an
   * exact configured backend/Web origin pair. Discovery never adds trust.
   */
  capirAuth?: {
    enabled: boolean;
    webOrigin: string;
    backendOrigin: string;
    /** One-use authorization-code lifetime (seconds). */
    codeTtlSeconds: number;
    /** Opaque access-token lifetime (seconds). */
    accessTtlSeconds: number;
    /** Rotating refresh idle deadline (seconds). */
    refreshIdleTtlSeconds: number;
    /** Rotating refresh absolute deadline (seconds). */
    refreshAbsoluteTtlSeconds: number;
  } | undefined;
  /** Server-side mail transport for account verification (Resend). */
  mailTransport?: { apiKey: string; fromEmail: string };
  /** Base URL used to build email verification links (Web origin). */
  verificationBaseUrl?: string;
  tls?: { certificatePem: string; privateKeyPem: string };
  chatMediaStorage?:
    | { provider: "local"; directory: string }
    | {
        provider: "s3";
        bucket: string;
        endpoint?: string;
        forcePathStyle: boolean;
        region: string;
      };
}

function requireValue(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value === "true";
}

function pkcs8PrivateKeyBoundary(kind: "BEGIN" | "END"): string {
  return `-----${kind} ${["PRIVATE", "KEY"].join(" ")}-----`;
}

function readTlsFile(path: string, label: string, isPrivate: boolean): string {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute.`);

  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOOP") {
      throw new Error(`${label} must be a regular file, not a symlink.`);
    }
    throw error;
  }

  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) {
      throw new Error(`${label} must be a regular file, not a symlink.`);
    }
    if (metadata.size < 1 || metadata.size > 64 * 1024) {
      throw new Error(`${label} must be between 1 byte and 64 KiB.`);
    }
    if (typeof process.geteuid === "function" && metadata.uid !== process.geteuid()) {
      throw new Error(`${label} must be owned by the backend user.`);
    }
    if (isPrivate && (metadata.mode & 0o077) !== 0) {
      throw new Error(`${label} must not be group- or world-readable.`);
    }
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

export function loadTlsIdentity(
  certificatePath: string,
  privateKeyPath: string,
): NonNullable<BackendConfig["tls"]> {
  const certificatePem = readTlsFile(certificatePath, "TLS certificate", false);
  const privateKeyPem = readTlsFile(privateKeyPath, "TLS private key", true);
  if (!certificatePem.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("TLS certificate is not PEM encoded.");
  }
  if (!privateKeyPem.includes(pkcs8PrivateKeyBoundary("BEGIN"))) {
    throw new Error("TLS private key is not PEM encoded.");
  }
  return { certificatePem, privateKeyPem };
}

export function loadConfig(): BackendConfig {
  const nodeEnvironment = process.env.NODE_ENV ?? "development";
  const simulatedAuthEnabled = parseBoolean(
    process.env.SIMULATED_AUTH_ENABLED,
    nodeEnvironment !== "production",
  );
  const internalLabEnabled = parseBoolean(
    process.env.TALENT_SIGNAL_INTERNAL_LAB_ENABLED,
    nodeEnvironment !== "production",
  );

  if (nodeEnvironment === "production" && simulatedAuthEnabled) {
    throw new Error("Simulated authentication cannot run in production.");
  }
  const passwordAuthEnabled = parseBoolean(
    process.env.PASSWORD_AUTH_ENABLED,
    nodeEnvironment !== "production",
  );
  const passwordRegistrationEnabled = parseBoolean(
    process.env.PASSWORD_REGISTRATION_ENABLED,
    nodeEnvironment !== "production",
  );
  if (passwordRegistrationEnabled && !passwordAuthEnabled) {
    throw new Error(
      "PASSWORD_AUTH_ENABLED is required when password registration is enabled.",
    );
  }
  const appleSignInAudiences = (process.env.APPLE_SIGN_IN_AUDIENCES ?? "")
    .split(",")
    .map((audience) => audience.trim())
    .filter(Boolean);
  const appleSignInEnabled = parseBoolean(
    process.env.APPLE_SIGN_IN_ENABLED,
    appleSignInAudiences.length > 0,
  );
  if (appleSignInEnabled && appleSignInAudiences.length === 0) {
    throw new Error(
      "APPLE_SIGN_IN_AUDIENCES is required when Apple sign-in is enabled.",
    );
  }
  const chatMediaProvider = process.env.CHAT_MEDIA_STORAGE_PROVIDER ?? "local";
  if (chatMediaProvider !== "local" && chatMediaProvider !== "s3") {
    throw new Error("CHAT_MEDIA_STORAGE_PROVIDER must be local or s3.");
  }
  const chatMediaStorage: NonNullable<BackendConfig["chatMediaStorage"]> =
    chatMediaProvider === "s3"
      ? {
          provider: "s3",
          bucket: requireValue("CHAT_MEDIA_S3_BUCKET"),
          region: requireValue("CHAT_MEDIA_S3_REGION"),
          forcePathStyle: parseBoolean(
            process.env.CHAT_MEDIA_S3_FORCE_PATH_STYLE,
            false,
          ),
          ...(process.env.CHAT_MEDIA_S3_ENDPOINT?.trim()
            ? { endpoint: process.env.CHAT_MEDIA_S3_ENDPOINT.trim() }
            : {}),
        }
      : {
          provider: "local",
          directory:
            process.env.CHAT_MEDIA_LOCAL_DIRECTORY?.trim() ||
            `${process.cwd()}/.data/chat-media`,
        };
  const tlsCertificatePath = process.env.TALENT_SIGNAL_TLS_CERTIFICATE_PATH?.trim();
  const tlsPrivateKeyPath = process.env.TALENT_SIGNAL_TLS_PRIVATE_KEY_PATH?.trim();
  if (Boolean(tlsCertificatePath) !== Boolean(tlsPrivateKeyPath)) {
    throw new Error(
      "TALENT_SIGNAL_TLS_CERTIFICATE_PATH and TALENT_SIGNAL_TLS_PRIVATE_KEY_PATH must be configured together.",
    );
  }
  const tls = tlsCertificatePath && tlsPrivateKeyPath
    ? loadTlsIdentity(tlsCertificatePath, tlsPrivateKeyPath)
    : undefined;
  const host = process.env.HOST ?? "0.0.0.0";
  if (tls && !["127.0.0.1", "::1"].includes(host)) {
    throw new Error("TLS mode for the macOS Hybrid adapter requires HOST=127.0.0.1 or HOST=::1.");
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const resendFromEmail = process.env.RESEND_FROM_EMAIL?.trim();
  if (Boolean(resendApiKey) !== Boolean(resendFromEmail)) {
    throw new Error(
      "RESEND_API_KEY and RESEND_FROM_EMAIL must be configured together.",
    );
  }
  const mailTransport =
    resendApiKey && resendFromEmail
      ? { apiKey: resendApiKey, fromEmail: resendFromEmail }
      : undefined;
  const verificationBaseUrl = process.env.AUTH_VERIFICATION_BASE_URL?.trim();

  const capirTestsEnabled = parseBoolean(process.env.CAPIR_TESTS_ENABLED, false);
  const capirProvisioningKey = process.env.CAPIR_TEST_PROVISIONING_KEY?.trim();
  const capirWebOrigin = process.env.CAPIR_TEST_WEB_ORIGIN?.trim();
  const capirBackendOrigin = process.env.CAPIR_TEST_BACKEND_ORIGIN?.trim();
  const capirWebConsumerKey = process.env.CAPIR_TEST_WEB_CONSUMER_KEY?.trim();
  const capirProvisioningGeneration = Number.parseInt(
    process.env.CAPIR_TEST_PROVISIONING_GENERATION ?? "1",
    10,
  );
  const capirMaxActiveRuns = Number.parseInt(
    process.env.CAPIR_TEST_MAX_ACTIVE_RUNS ?? "3",
    10,
  );
  if (!Number.isInteger(capirProvisioningGeneration) || capirProvisioningGeneration < 1) {
    throw new Error("CAPIR_TEST_PROVISIONING_GENERATION must be a positive integer.");
  }
  if (!Number.isInteger(capirMaxActiveRuns) || capirMaxActiveRuns < 1 || capirMaxActiveRuns > 20) {
    throw new Error("CAPIR_TEST_MAX_ACTIVE_RUNS must be an integer between 1 and 20.");
  }
  if (
    capirTestsEnabled &&
    (!internalLabEnabled || !capirProvisioningKey || !capirWebOrigin || !capirBackendOrigin)
  ) {
    throw new Error(
      "CAPIR_TESTS_ENABLED requires TALENT_SIGNAL_INTERNAL_LAB_ENABLED, CAPIR_TEST_PROVISIONING_KEY, CAPIR_TEST_WEB_ORIGIN and CAPIR_TEST_BACKEND_ORIGIN.",
    );
  }

  const capirAuthEnabled = parseBoolean(process.env.CAPIR_AUTH_ENABLED, false);
  const capirAuthWebOrigin = process.env.CAPIR_AUTH_WEB_ORIGIN?.trim();
  const capirAuthBackendOrigin = process.env.CAPIR_AUTH_BACKEND_ORIGIN?.trim();
  const capirAuthCodeTtlSeconds = Number(
    process.env.CAPIR_AUTH_CODE_TTL_SECONDS ?? "60"
  );
  const capirAuthAccessTtlSeconds = Number(
    process.env.CAPIR_AUTH_ACCESS_TTL_SECONDS ?? "900"
  );
  const capirAuthRefreshIdleTtlSeconds = Number(
    process.env.CAPIR_AUTH_REFRESH_IDLE_TTL_SECONDS ?? "604800"
  );
  const capirAuthRefreshAbsoluteTtlSeconds = Number(
    process.env.CAPIR_AUTH_REFRESH_ABSOLUTE_TTL_SECONDS ?? "2592000"
  );
  if (
    !Number.isInteger(capirAuthCodeTtlSeconds) || capirAuthCodeTtlSeconds < 30 || capirAuthCodeTtlSeconds > 300
  ) {
    throw new Error("CAPIR_AUTH_CODE_TTL_SECONDS must be an integer between 30 and 300.");
  }
  if (
    !Number.isInteger(capirAuthAccessTtlSeconds) || capirAuthAccessTtlSeconds < 60 || capirAuthAccessTtlSeconds > 3600
  ) {
    throw new Error("CAPIR_AUTH_ACCESS_TTL_SECONDS must be an integer between 60 and 3600.");
  }
  if (
    !Number.isInteger(capirAuthRefreshIdleTtlSeconds) || capirAuthRefreshIdleTtlSeconds < 600
  ) {
    throw new Error("CAPIR_AUTH_REFRESH_IDLE_TTL_SECONDS must be an integer of at least 600.");
  }
  if (
    !Number.isInteger(capirAuthRefreshAbsoluteTtlSeconds) ||
    capirAuthRefreshAbsoluteTtlSeconds < capirAuthRefreshIdleTtlSeconds
  ) {
    throw new Error(
      "CAPIR_AUTH_REFRESH_ABSOLUTE_TTL_SECONDS must be an integer at least as large as the idle lifetime.",
    );
  }
  if (capirAuthEnabled && (!capirAuthWebOrigin || !capirAuthBackendOrigin)) {
    throw new Error(
      "CAPIR_AUTH_ENABLED requires CAPIR_AUTH_WEB_ORIGIN and CAPIR_AUTH_BACKEND_ORIGIN.",
    );
  }
  for (const [label, value] of [
    ["CAPIR_AUTH_WEB_ORIGIN", capirAuthWebOrigin],
    ["CAPIR_AUTH_BACKEND_ORIGIN", capirAuthBackendOrigin],
  ] as const) {
    if (value) {
      const url=new URL(value);
      if (url.origin!==value || url.username || url.password || (url.protocol!=='https:' && !(url.protocol==='http:' && url.hostname==='127.0.0.1')))
        throw new Error(`${label} must be an exact HTTPS origin (literal loopback may use HTTP).`);
    }
  }

  return {
    allowedOrigins: (
      process.env.ALLOWED_ORIGINS ??
      "http://localhost:3000,http://127.0.0.1:3000"
    )
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    appleSignInAudiences,
    appleSignInEnabled,
    googleSignInAudiences: (process.env.GOOGLE_SIGN_IN_AUDIENCES ?? "").split(",").map(value => value.trim()).filter(Boolean),
    databaseUrl: requireValue("DATABASE_URL"),
    host,
    passwordAuthEnabled,
    passwordRegistrationEnabled,
    port: Number.parseInt(process.env.PORT ?? "4317", 10),
    retentionSweepIntervalMs: Math.max(
      1_000,
      Number.parseInt(
        process.env.RETENTION_SWEEP_INTERVAL_MS ?? "60000",
        10,
      ),
    ),
    sessionTtlSeconds: Number.parseInt(
      process.env.SESSION_TTL_SECONDS ?? "28800",
      10,
    ),
    simulatedAuthEnabled,
    internalLabEnabled,
    capirTests: capirTestsEnabled
      ? {
          enabled: true,
          provisioningGeneration: capirProvisioningGeneration,
          maxActiveRuns: capirMaxActiveRuns,
          ...(capirProvisioningKey ? { provisioningKey: capirProvisioningKey } : {}),
          ...(capirWebOrigin ? { webOrigin: capirWebOrigin } : {}),
          ...(capirBackendOrigin ? { backendOrigin: capirBackendOrigin } : {}),
          ...(capirWebConsumerKey ? { webConsumerKey: capirWebConsumerKey } : {}),
        }
      : undefined,
    chatMediaStorage,
    ...(capirAuthEnabled
      ? {
          capirAuth: {
            enabled: true,
            webOrigin: capirAuthWebOrigin!,
            backendOrigin: capirAuthBackendOrigin!,
            codeTtlSeconds: capirAuthCodeTtlSeconds,
            accessTtlSeconds: capirAuthAccessTtlSeconds,
            refreshIdleTtlSeconds: capirAuthRefreshIdleTtlSeconds,
            refreshAbsoluteTtlSeconds: capirAuthRefreshAbsoluteTtlSeconds,
          },
        }
      : {}),
    ...(mailTransport ? { mailTransport } : {}),
    ...(verificationBaseUrl ? { verificationBaseUrl } : {}),
    ...(tls ? { tls } : {}),
  };
}
