import { assertAgentBudget } from "./runBudget.js";
import type {
  AgentPersonResearchAuthorization,
  AgentPersonResearchPlatform,
  AgentPersonResearchRunRequest,
} from "./types.js";

export class AgentPersonResearchPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentPersonResearchPolicyError";
  }
}

const PLATFORMS = new Set<AgentPersonResearchPlatform>([
  "douyin",
  "tiktok",
  "weibo",
  "threads",
]);

const CONTACT_OR_BACKGROUND_CHECK =
  /\b(?:email|e-mail|phone|mobile|home\s+address|personal\s+address|background\s+check|criminal\s+record)\b|个人邮箱|邮箱地址|手机号|电话号码|家庭住址|家庭地址|背调|犯罪记录/iu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/u;
const APPEARANCE_IDENTITY =
  /\b(?:face\s*(?:match|recognition|search)|facial\s+(?:match|recognition)|identify\s+(?:him|her|them)\s+by\s+(?:face|appearance)|reverse\s+face)\b|人脸识别|人脸搜索|以貌识人|通过长相|反向人脸/iu;
const PROHIBITED_ASSESSMENT =
  /\b(?:personality|culture\s+fit|candidate\s+(?:score|rank|quality)|acceptance\s+probability|protected\s+trait|race|ethnicity|religion|disability|sexual\s+orientation|political\s+(?:view|affiliation))\b|性格|文化契合|候选人(?:评分|排名|质量)|接受概率|受保护特征|种族|民族|宗教|残障|性取向|政治(?:观点|倾向)/iu;

export function assertPersonResearchAuthorization(
  authorization: AgentPersonResearchAuthorization,
): AgentPersonResearchAuthorization {
  const allowedPlatforms = [...new Set(authorization.allowedPlatforms)];
  if (
    authorization.purpose !== "person_public_profile_research" ||
    authorization.accessMode !== "visible_screenshot_identity_clues" ||
    allowedPlatforms.length < 1 ||
    allowedPlatforms.length > PLATFORMS.size ||
    allowedPlatforms.some((platform) => !PLATFORMS.has(platform))
  ) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_AUTHORIZATION_INVALID",
      "Person research requires an explicit screenshot-clue scope and 1-4 supported public platforms.",
    );
  }
  if (
    !Number.isInteger(authorization.maximumProviderCalls) ||
    authorization.maximumProviderCalls < 1 ||
    authorization.maximumProviderCalls > 4 ||
    !Number.isInteger(authorization.maximumResultsPerCall) ||
    authorization.maximumResultsPerCall < 1 ||
    authorization.maximumResultsPerCall > 10
  ) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_BUDGET_INVALID",
      "Person research permits 1-4 provider calls and 1-10 normalized results per call.",
    );
  }
  return Object.freeze({ ...authorization, allowedPlatforms });
}

export function assertPersonResearchQuery(query: string): string {
  const normalized = query.normalize("NFKC").trim();
  if (normalized.length < 2 || normalized.length > 100) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_QUERY_INVALID",
      "A public-profile query must contain 2-100 visible identity-clue characters.",
    );
  }
  if (
    CONTACT_OR_BACKGROUND_CHECK.test(normalized) ||
    EMAIL.test(normalized) ||
    PHONE.test(normalized)
  ) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_SENSITIVE_QUERY_PROHIBITED",
      "Person research cannot search for contact details, addresses, or background checks.",
    );
  }
  if (APPEARANCE_IDENTITY.test(normalized)) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_FACE_IDENTIFICATION_PROHIBITED",
      "Person research cannot identify someone from face or appearance.",
    );
  }
  if (PROHIBITED_ASSESSMENT.test(normalized)) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_ASSESSMENT_PROHIBITED",
      "Person research cannot score, rank, or infer protected or sensitive traits.",
    );
  }
  return normalized;
}

export function assertPersonResearchDraftText(text: string): void {
  const boundaryStatementRemoved = text
    .replace(
      /(?:未|没有|不会|不应|禁止|不得)(?:进行|使用)?(?:任何)?(?:人脸识别|人脸搜索|反向人脸)/gu,
      "",
    )
    .replace(
      /\b(?:no|without|never|do not|does not|did not)\s+(?:use\s+)?(?:face|facial|reverse-face)[\s-]+(?:match|matching|recognition|search|identification)\b/giu,
      "",
    );
  if (
    CONTACT_OR_BACKGROUND_CHECK.test(boundaryStatementRemoved) ||
    EMAIL.test(boundaryStatementRemoved) ||
    PHONE.test(boundaryStatementRemoved) ||
    APPEARANCE_IDENTITY.test(boundaryStatementRemoved)
  ) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_PRIVATE_OR_BIOMETRIC_OUTPUT_PROHIBITED",
      "A person-research draft cannot contain contact-detail, background-check, or biometric-identification output.",
    );
  }
  if (PROHIBITED_ASSESSMENT.test(text)) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_ASSESSMENT_PROHIBITED",
      "A person-research draft cannot score, rank, or infer protected or sensitive traits.",
    );
  }
}

function assertPersonResearchImageInput(
  request: AgentPersonResearchRunRequest,
): void {
  const manifest = request.scope.inputArtifactManifest;
  const parts = request.providerInputParts;
  if (manifest.length !== 1 || parts.length !== 1) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_IMAGE_REQUIRED",
      "Person research requires exactly one governed screenshot artifact.",
    );
  }
  const item = manifest[0];
  const part = parts[0];
  if (
    !item ||
    !part ||
    item.kind !== "image" ||
    part.kind !== "image" ||
    item.artifactID !== part.artifactID ||
    item.mimeType !== part.mimeType ||
    item.byteSize !== part.byteSize ||
    item.contentHash !== part.contentHash ||
    !new Set(["image/png", "image/jpeg", "image/webp"]).has(item.mimeType) ||
    item.byteSize < 1 ||
    item.byteSize > 10_000_000 ||
    !/^[0-9a-f]{64}$/u.test(item.contentHash) ||
    !part.dataBase64
  ) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_IMAGE_INVALID",
      "The screenshot must be one matching PNG, JPEG, or WebP artifact of at most 10 MB.",
    );
  }
  if (!request.provider.inputCapabilities.imageUnderstanding) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_VISION_PROVIDER_REQUIRED",
      "The configured pinned Agent model does not support image understanding.",
    );
  }
}

/**
 * Person-research run preflight, owned by this policy boundary and called by
 * the actual runner before journal start or provider work. The budget, the
 * governed screenshot/provider input, and scope identity are asserted in the
 * exact order the runner has always enforced; authorization normalization
 * keeps its own separate owner.
 */
export function assertPersonResearchRunInputs(
  request: AgentPersonResearchRunRequest,
): void {
  assertAgentBudget(request.budget, ({ field }) => {
    throw new AgentPersonResearchPolicyError(
      "AGENT_BUDGET_INVALID",
      `${field} must be positive and no greater than the Agent ceiling.`,
    );
  });
  assertPersonResearchImageInput(request);
  if (
    !request.scope.runID.trim() ||
    !request.scope.objective.trim() ||
    !request.scope.providerID.trim()
  ) {
    throw new AgentPersonResearchPolicyError(
      "PERSON_RESEARCH_SCOPE_INVALID",
      "A local person-research Run requires a run ID, objective, and pinned provider.",
    );
  }
}
