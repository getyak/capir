/**
 * Stable CLI error surface for `capir.v1`.
 *
 * Exit codes follow the Global Constraints contract:
 *   0   success
 *   1   assertion/gate failure
 *   2   invalid arguments
 *   3   infrastructure / incomplete / unsupported / replay miss / cleanup failure
 *   4   auth denial
 *   5   budget or capacity exhausted
 *   130 cancellation
 */
export const EXIT = {
  SUCCESS: 0,
  ASSERTION: 1,
  INVALID_ARGUMENTS: 2,
  INFRASTRUCTURE: 3,
  AUTH_DENIED: 4,
  CAPACITY: 5,
  CANCELLED: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class CapirCliError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly message: string;
  readonly recoverableRequestId?: string;
  readonly run?: unknown;
  readonly browser?: unknown;
  readonly clientState?: unknown;
  /** Narrow disclosure channel for an otherwise successful generated credential. */
  readonly generatedCredential?: Record<string, unknown>;
  /** The one-use handoff operation id, separate from the create recovery id. */
  readonly handoffRequestId?: string;

  constructor(
    code: string,
    exitCode: ExitCode,
    message: string,
    extra: {
      recoverableRequestId?: string;
      run?: unknown;
      browser?: unknown;
      clientState?: unknown;
      generatedCredential?: Record<string, unknown>;
      handoffRequestId?: string;
    } = {},
  ) {
    super(message);
    this.name = "CapirCliError";
    this.code = code;
    this.exitCode = exitCode;
    this.message = message;
    if (extra.recoverableRequestId !== undefined)
      this.recoverableRequestId = extra.recoverableRequestId;
    if (extra.run !== undefined) this.run = extra.run;
    if (extra.browser !== undefined) this.browser = extra.browser;
    if (extra.clientState !== undefined) this.clientState = extra.clientState;
    if (extra.generatedCredential !== undefined)
      this.generatedCredential = extra.generatedCredential;
    if (extra.handoffRequestId !== undefined) this.handoffRequestId = extra.handoffRequestId;
  }
}

export function invalidArgument(code: string, message: string): CapirCliError {
  return new CapirCliError(code, EXIT.INVALID_ARGUMENTS, message);
}

export function unsupported(message: string): CapirCliError {
  return new CapirCliError("CAPIR_UNSUPPORTED", EXIT.INFRASTRUCTURE, message);
}

export function infrastructure(
  code: string,
  message: string,
  extra: ConstructorParameters<typeof CapirCliError>[3] = {},
): CapirCliError {
  return new CapirCliError(code, EXIT.INFRASTRUCTURE, message, extra);
}
