export type AuthFailureMode = "register" | "sign-in";

export type AuthFailureCode =
  | "invalid_credentials"
  | "service_unavailable"
  | "test_workspace_session_limit"
  | "rate_limited"
  | "account_exists"
  | "invalid_input"
  | "registration_result_unknown";

const authFailureMessages: Record<
  AuthFailureCode,
  Record<AuthFailureMode, string>
> = {
  registration_result_unknown: {
    register: "暂未确认账号是否创建成功，请先尝试登录。",
    "sign-in": "账号服务暂时不可用，请稍后重试。",
  },
  invalid_credentials: {
    register: "无法创建账号，请检查填写内容后重试。",
    "sign-in": "无法识别该用户名、邮箱或密码。",
  },
  service_unavailable: {
    register: "账号服务暂时不可用，请稍后重试。",
    "sign-in": "账号服务暂时不可用，请稍后重试。",
  },
  test_workspace_session_limit: {
    register: "暂未确认账号是否创建成功，请先尝试登录。",
    "sign-in": "这个测试空间已达到会话上限。请在已有会话中退出登录后重试。",
  },
  rate_limited: {
    register: "尝试次数过多，请稍候再试。",
    "sign-in": "尝试次数过多，请稍候再试。",
  },
  account_exists: {
    register: "该用户名或邮箱已被其他账号使用。",
    "sign-in": "无法识别该用户名、邮箱或密码。",
  },
  invalid_input: {
    register: "请检查填写内容后重试。",
    "sign-in": "请输入邮箱和密码。",
  },
};

export function authFailureMessage(
  code: AuthFailureCode,
  mode: AuthFailureMode,
): string {
  return authFailureMessages[code][mode];
}

export function authFailureIsRetryable(code: AuthFailureCode): boolean {
  return code === "service_unavailable";
}

/**
 * Maps the credential error code surfaced by Auth.js to the small set of
 * states the login surface can explain. Unknown codes must never leak an
 * operator-oriented backend message or claim the credentials were wrong.
 */
export function authFailureCodeFromCredentialsCode(
  rawCode: string | null | undefined,
  mode: AuthFailureMode,
): AuthFailureCode {
  switch (rawCode) {
    case "rate_limited":
      return "rate_limited";
    case "service_unavailable":
      return mode === "register" ? "registration_result_unknown" : "service_unavailable";
    case "test_workspace_session_limit":
      return mode === "register" ? "registration_result_unknown" : "test_workspace_session_limit";
    case "account_exists":
      return mode === "register" ? "account_exists" : "invalid_credentials";
    case "credentials":
      return "invalid_credentials";
    default:
      return mode === "register" ? "registration_result_unknown" : "service_unavailable";
  }
}
