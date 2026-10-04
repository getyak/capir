export type ClaimKind =
  | "observation"
  | "interpretation"
  | "recommendation"
  | "decision"
  | "outcome";

export type FindingState =
  | "active"
  | "needs_evidence"
  | "resolved"
  | "superseded";
export type AttentionWindow = "now" | "next" | "watch";

export interface EvidenceReference {
  id: string;
  type:
    | "runtime"
    | "test"
    | "code"
    | "config"
    | "decision"
    | "canonical"
    | "evaluation"
    | "research";
  title: string;
  href: string;
  locator: string;
  snapshotOrDate: string;
  supports: string[];
  authority: "direct" | "derived";
  freshness: "current" | "dated" | "stale" | "unknown";
  summary: string;
  limitations: string[];
}

export interface BriefFinding {
  id: string;
  number: string;
  title: string;
  kind: ClaimKind;
  state: FindingState;
  attention: AttentionWindow;
  executiveSummary: string;
  impact: string;
  causalChain: [string, string, string, string, string];
  evidenceIds: string[];
  counterevidenceIds: string[];
  unknowns: string[];
  implication: string;
  recommendation: string;
  tradeoffs: string[];
  verification: string[];
}

export interface ProjectHealthBrief {
  id: string;
  status: "draft" | "reviewed" | "accepted" | "superseded" | "archived";
  freshness: "current" | "dated" | "stale" | "unknown";
  title: string;
  question: string;
  audience: string;
  snapshot: {
    date: string;
    commit: string;
    branch: string;
    scope: string;
  };
  exclusions: string[];
  conclusion: string;
  significance: string;
  decisionRequest: string;
  recommendation: string;
  headlineFindingIds: string[];
  strengths: Array<{
    title: string;
    detail: string;
    evidenceIds: string[];
  }>;
  findings: BriefFinding[];
  options: Array<{
    name: string;
    stance: "recommended" | "possible" | "reject";
    description: string;
    tradeoff: string;
  }>;
  actions: Array<{
    window: string;
    title: string;
    detail: string;
    proof: string;
  }>;
  outcomes: Array<{
    title: string;
    observation: string;
    evidenceIds: string[];
  }>;
  evidence: EvidenceReference[];
}

const revision = "149182a55d96f337d5e2d0ca80ffc90d4189bd15";
const repositoryAtRevision = `https://github.com/getyak/talent-signal/blob/${revision}`;

export const projectHealthBrief: ProjectHealthBrief = {
  id: "TS-2026-08-11-PROJECT-HEALTH-001",
  status: "draft",
  freshness: "current",
  title: "Talent Signal 工程决策简报",
  question: "下一阶段，团队应继续扩功能，还是先补足现场证据与变更隔离能力？",
  audience: "产品与工程负责人、评审者、执行团队",
  snapshot: {
    date: "2026-08-11",
    commit: revision,
    branch: "main",
    scope: "Web、产品验证、知识系统与 CI/CD；不包含未授权的生产数据判断",
  },
  exclusions: [
    "不接触或推断真实候选人数据",
    "不把一次代码结构审查写成已确认的运行时缺陷",
    "不在根因未知时修改发布工作流",
  ],
  conclusion:
    "Talent Signal 已经把“可信地处理证据”做得相当扎实，但当前最稀缺的不是更多功能，而是现场价值证据、主工作台的变更隔离，以及一次尚未闭环的 iOS 发布状态。",
  significance:
    "如果继续横向扩展，团队会在尚未证明真实招聘工作收益时，进一步放大评审成本和回归范围。",
  decisionRequest:
    "批准一个“证明与隔离”周期：立即核清发布状态；下一轮用 5 个真实对照案例证明价值；随后拆出最高变更密度的 Web 边界。",
  recommendation:
    "选择有边界的证明与隔离，而不是继续堆功能，也不是启动大重写。保留现有证据治理和 CI 优势，只处理当前约束。",
  headlineFindingIds: ["field-proof", "change-isolation", "release-state"],
  strengths: [
    {
      title: "可信边界已经成为产品能力",
      detail:
        "证据、解释、人工决定、确认状态和外部动作被明确分开；歧义、重复、取消、重试和 No action 都是合法结果。",
      evidenceIds: ["final-panel"],
    },
    {
      title: "主干质量门禁清楚且快速",
      detail:
        "当前主干 CI 与安全检查均通过；文档、Web、后端和按路径触发的 iOS 检查汇总到稳定的 required job。",
      evidenceIds: ["ci-workflow", "ci-run", "security-run"],
    },
    {
      title: "知识系统已经有正确骨架",
      detail:
        "项目区分规范、ADR、研究、评估、计划和可执行真相，适合继续构建可追溯的决策页面。",
      evidenceIds: ["documentation-policy"],
    },
  ],
  findings: [
    {
      id: "field-proof",
      number: "01",
      title: "内部可靠性已证明，真实工作收益尚未证明",
      kind: "observation",
      state: "needs_evidence",
      attention: "now",
      executiveSummary:
        "浏览器内的完整关系闭环通过了严格评审，但外部动作、跨日回访和真实招聘顾问对照仍在证据范围之外。",
      impact:
        "团队可能继续优化一套“能正确运行”的机制，却不知道它是否比招聘顾问现有做法更省时间、更少返工。",
      causalChain: [
        "评审结论为 pass_with_changes，发布门槛仍是 needs_evidence",
        "现有验证集中在合成证据和受控浏览器路径",
        "真实外部结果与跨日关系连续性尚未进入完整闭环",
        "产品学习能力落后于实现与内部验证能力",
        "路线图可能以功能完成度代替用户价值证据",
      ],
      evidenceIds: ["delivery-contract", "final-panel"],
      counterevidenceIds: ["final-panel"],
      unknowns: [
        "招聘顾问是否真的减少了上下文重建时间？",
        "第一种值得承担外部写入复杂度的动作是什么？",
        "真实语料是否会显著增加纠错、隐私顾虑或无动作比例？",
      ],
      implication:
        "下一阶段的发布门槛应从“功能是否完成”转为“是否观察到比现有做法更好的工作结果”。",
      recommendation:
        "冻结新的功能宽度，完成 5 个经同意的现有做法对照、1 个独立授权的外部动作，以及 1 次次日证据变化回访。",
      tradeoffs: [
        "短期可演示的新功能会减少",
        "真实对照需要同意、招募和更慢的证据收集",
        "首个外部动作会引入幂等、核验与恢复成本",
      ],
      verification: [
        "对照案例显示上下文重建时间或返工明确下降",
        "外部动作最多执行一次，可预览、可核验、失败可恢复",
        "次日回访不会复活过期建议，也不会丢失证据来源",
      ],
    },
    {
      id: "change-isolation",
      number: "02",
      title: "主工作台承担过多变化，评审边界正在变模糊",
      kind: "interpretation",
      state: "active",
      attention: "next",
      executiveSummary:
        "核心工作台组件和全局样式已经成为多领域汇合点；近期提交仍能交付完整纵向切片，但部分变更过大，增加了理解与回归成本。",
      impact:
        "小改动可能需要理解大范围状态与样式，代码评审难以判断影响边界，测试失败也更难定位到具体能力。",
      causalChain: [
        "一个组件同时协调采集、身份、资源、合并、历史和任务状态",
        "相关样式继续集中在大型全局样式表",
        "完整切片往往跨越较多文件和代码行",
        "领域边界存在于产品概念中，却没有充分反映在前端模块边界中",
        "变更隔离、所有权和回归定位能力下降",
      ],
      evidenceIds: ["workspace-component", "global-styles", "commit-shape"],
      counterevidenceIds: ["final-panel", "ci-run"],
      unknowns: [
        "哪些状态必须共享，哪些只是因为历史演进而共置？",
        "当前测试对领域接口的保护程度是否足以支持渐进拆分？",
        "哪些超大提交来自生成评估材料，哪些来自真正的产品耦合？",
      ],
      implication:
        "拆分顺序应由真实变更频率和回归风险决定，而不是由文件长度或架构美感决定。",
      recommendation:
        "不要重写。沿现有业务语言渐进拆分采集、证据评审、身份、资源、外部效果和历史边界；新样式默认路由局部化，并先补接口级回归测试。",
      tradeoffs: [
        "渐进拆分期间会暂时存在新旧边界并存",
        "先补契约测试会降低一小段时间的功能吞吐",
        "过早抽象可能把仍在学习的产品概念固化",
      ],
      verification: [
        "下一轮单领域改动无需触碰无关领域模块",
        "关键状态转换由聚焦测试保护，失败可定位到一个边界",
        "页面行为、可访问性和现有证据契约保持不变",
      ],
    },
    {
      id: "release-state",
      number: "03",
      title: "主干是绿色的，但 iOS 发布决策存在未终结状态",
      kind: "observation",
      state: "needs_evidence",
      attention: "now",
      executiveSummary:
        "同一提交的 CI 和安全运行成功结束，但由 CI completion 触发的 Release iOS 运行仍显示 pending 且没有 job。",
      impact:
        "这不等于发布失败，但它让“无需发布”“等待发布”和“自动化异常”三种状态无法被负责人快速区分。",
      causalChain: [
        "CI 成功后创建了 Release iOS 运行",
        "运行没有进入可观察的 prepare job，也没有形成终态",
        "工作流使用全局串行并在 prepare 阶段判断是否需要发布",
        "发布控制面缺少一个有时限、可解释的终态信号",
        "负责人无法仅凭主干绿色确认发布链路已闭环",
      ],
      evidenceIds: ["release-workflow", "ci-run", "release-run"],
      counterevidenceIds: ["ci-run", "security-run"],
      unknowns: [
        "pending 是 GitHub 调度、并发队列还是工作流条件造成？",
        "是否存在仍占用 release-ios 并发组的历史运行？",
        "非 iOS 变更的发布工作流应该显示 skipped 还是 success？",
      ],
      implication:
        "CI 质量结果与发布控制结果需要分别可见；主干绿色不能替代发布链路的明确终态。",
      recommendation:
        "先人工核清该运行及并发队列，不在未知根因下修改发布逻辑；随后增加一个有时限的 workflow_run 到终态监测。",
      tradeoffs: [
        "人工核查比直接改 YAML 慢，但避免用猜测制造新发布风险",
        "额外监测会增加一个需要维护的控制面信号",
        "终态语义必须兼容非 iOS 变更和审批中的真实发布",
      ],
      verification: [
        "当前 pending 运行被解释并进入明确终态",
        "未来非 iOS 主干提交能迅速显示“不需发布”的终态",
        "iOS 发布仍保持串行、环境审批和结果核验",
      ],
    },
    {
      id: "knowledge-retrieval",
      number: "04",
      title: "证据增长快于“当前真相”的整理速度",
      kind: "interpretation",
      state: "active",
      attention: "next",
      executiveSummary:
        "仓库积累了大量细粒度评估和进行中计划，这是可信研发的资产；但缺少足够的主题级入口来说明哪一份仍代表当前结论。",
      impact:
        "新成员和负责人需要跨越大量日期文件才能回答简单问题，旧评估也可能被误读为当前产品状态。",
      causalChain: [
        "评估、计划和运行证据持续按日期累积",
        "任务结束后的合并、归档和替代关系并不总是显式",
        "原始证据丰富，但主题级 current/superseded 导航较弱",
        "知识留存能力强于知识检索与压缩能力",
        "决策速度下降，并产生引用过期结论的风险",
      ],
      evidenceIds: ["documentation-policy", "knowledge-inventory"],
      counterevidenceIds: ["documentation-policy"],
      unknowns: [
        "哪些评估主题最常被重复检索？",
        "哪些计划仍然活跃，哪些只是保留的历史记录？",
        "主题清单应由人工维护还是从结构化元数据生成？",
      ],
      implication:
        "知识系统下一步应优化“找到当前结论”的时间，而不是减少原始证据或再建一个内容系统。",
      recommendation:
        "为高频主题增加小型 manifest，明确 current、supersedes 和 next evidence；把完成计划移出活跃入口，保留原始证据但不让它承担摘要职责。",
      tradeoffs: [
        "主题清单本身可能陈旧，需要明确维护责任",
        "自动生成可降低维护成本，但难以替代人工判断当前结论",
        "归档改善入口，但不能删除仍承担审计用途的原始材料",
      ],
      verification: [
        "负责人可从一个主题入口找到当前结论和下一项证据",
        "每个活跃计划都有状态，完成计划不再混入进行中列表",
        "原始评估仍可追溯，且不复制成第二份规范",
      ],
    },
  ],
  options: [
    {
      name: "继续扩展功能宽度",
      stance: "possible",
      description: "保持当前速度增加更多自动化、页面和外部能力。",
      tradeoff: "短期演示丰富，但会放大尚未验证的用户价值与变更隔离问题。",
    },
    {
      name: "证明与隔离周期",
      stance: "recommended",
      description: "先解决发布未知，再取得现场证据，并按最高变更密度拆出边界。",
      tradeoff: "短期新增功能较少，换来可证实的路线图和更低的后续变更成本。",
    },
    {
      name: "全面重写或平台化",
      stance: "reject",
      description: "以新架构替换现有工作台和知识体系。",
      tradeoff: "会丢失大量已经验证的行为，且没有证据表明重写能解决现场价值问题。",
    },
  ],
  actions: [
    {
      window: "现在 · 1 天",
      title: "终结发布未知",
      detail: "核查 pending Release iOS 运行、并发队列与条件求值，记录事实，不预设根因。",
      proof: "运行进入终态，负责人能区分“不需发布”和“自动化异常”。",
    },
    {
      window: "下一轮 · 1–2 周",
      title: "取得现场价值证据",
      detail: "完成 5 个同意参与的招聘顾问对照、1 个外部效果、1 次跨日回访。",
      proof: "观察到重建时间或返工下降，且没有增加不受支持的确认与清理工作。",
    },
    {
      window: "随后 · 一个完整切片",
      title: "拆出最高变化边界",
      detail: "以业务接口和测试为护栏，渐进拆分工作台组件与路由样式。",
      proof: "一次领域改动保持在一个边界内，行为与证据契约不回退。",
    },
    {
      window: "并行维护",
      title: "建立当前结论入口",
      detail: "为工作台、证据安全和发布状态增加 current/superseded/next evidence 清单。",
      proof: "从一个入口即可回答当前状态，并能下钻到原始文件。",
    },
  ],
  outcomes: [],
  evidence: [
    {
      id: "delivery-contract",
      type: "canonical",
      title: "交付原则与当前产品边界",
      href: `${repositoryAtRevision}/docs/delivery.md#L11-L33`,
      locator: "docs/delivery.md L11–33",
      snapshotOrDate: revision,
      supports: ["field-proof"],
      authority: "direct",
      freshness: "current",
      summary:
        "仓库明确将当前实现定义为学习基础而非生产关系系统，并要求一项安全动作包含独立审批、结果观察和恢复。",
      limitations: ["这是规范性边界，不是用户现场结果。"],
    },
    {
      id: "final-panel",
      type: "evaluation",
      title: "关系闭环最终评审面板",
      href: `https://github.com/getyak/capir-evals/blob/main/evidence/2026-08-10-workspace-relationship-loop-final-panel-retest-004.json#L53-L225`,
      locator: "最终评审 L53–225",
      snapshotOrDate: "2026-08-10",
      supports: ["field-proof", "change-isolation"],
      authority: "direct",
      freshness: "dated",
      summary:
        "内部路径 26/26 通过且无否决项；评审仍要求外部动作、跨日回访、现场对照、辅助技术和提供商生命周期证据。",
      limitations: [
        "基于受控生产构建和合成/授权测试材料，不能替代真实招聘顾问研究。",
      ],
    },
    {
      id: "workspace-component",
      type: "code",
      title: "主关系工作台组件",
      href: `${repositoryAtRevision}/apps/web/components/relationship-workspace-app.tsx#L7164-L7250`,
      locator: "9,620 行；主组件从 L7164 开始",
      snapshotOrDate: revision,
      supports: ["change-isolation"],
      authority: "direct",
      freshness: "current",
      summary:
        "一个客户端工作台同时持有采集、关系范围、身份合并、知识、资源、聊天、删除和公告等状态。",
      limitations: ["文件长度是结构风险信号，不自动证明运行时缺陷或错误抽象。"],
    },
    {
      id: "global-styles",
      type: "code",
      title: "全局样式中的关系工作台区段",
      href: `${repositoryAtRevision}/apps/web/app/globals.css#L11488-L11535`,
      locator: "13,925 行；工作台样式从 L11488 延续",
      snapshotOrDate: revision,
      supports: ["change-isolation"],
      authority: "direct",
      freshness: "current",
      summary: "关系工作台样式继续追加在全局样式表中，扩大了选择器影响面和评审范围。",
      limitations: ["仅凭样式表规模不能断言存在冲突，仍需以真实页面回归验证。"],
    },
    {
      id: "commit-shape",
      type: "research",
      title: "近期提交形态抽样",
      href: `https://github.com/getyak/talent-signal/commits/${revision}`,
      locator: "最近 60 个非合并提交；另对 47 个源代码提交复算",
      snapshotOrDate: "2026-08-11 local git history",
      supports: ["change-isolation"],
      authority: "derived",
      freshness: "current",
      summary:
        "60 个提交的变更行中位数为 699，25 个超过 1,000 行；排除文档与计划后，47 个源代码提交的中位数为 265 行，18 个超过 1,000 行。",
      limitations: [
        "早期纵向切片和生成评估材料会放大变更量；指标用于发现评审风险，不评价个人表现。",
      ],
    },
    {
      id: "ci-workflow",
      type: "config",
      title: "主干 CI 质量门禁",
      href: `${repositoryAtRevision}/.github/workflows/ci.yml#L43-L202`,
      locator: ".github/workflows/ci.yml L43–202",
      snapshotOrDate: revision,
      supports: ["change-isolation", "release-state"],
      authority: "direct",
      freshness: "current",
      summary:
        "文档、Web、后端和按变更触发的 iOS 检查汇总到 CI required，Actions 均固定到不可变 revision。",
      limitations: ["CI 通过证明自动化门禁通过，不证明现场价值或全部设备行为。"],
    },
    {
      id: "ci-run",
      type: "runtime",
      title: "当前提交 CI 运行",
      href: "https://github.com/getyak/talent-signal/actions/runs/31377644138",
      locator: "run 31377644138 · success · 约 92 秒",
      snapshotOrDate: "2026-08-10T10:06:12Z",
      supports: ["change-isolation", "release-state"],
      authority: "direct",
      freshness: "dated",
      summary: "当前提交的 repository、backend 和 web jobs 成功，iOS 因无相关变化而跳过。",
      limitations: ["这是一次运行快照，不代表后续提交状态。"],
    },
    {
      id: "security-run",
      type: "runtime",
      title: "当前提交安全运行",
      href: "https://github.com/getyak/talent-signal/actions/runs/31377644505",
      locator: "run 31377644505 · success",
      snapshotOrDate: "2026-08-10",
      supports: ["release-state"],
      authority: "direct",
      freshness: "dated",
      summary: "同一提交的安全工作流成功结束。",
      limitations: ["自动化安全扫描不能替代威胁建模、人工审查或生产配置验证。"],
    },
    {
      id: "release-workflow",
      type: "config",
      title: "iOS 发布决策工作流",
      href: `${repositoryAtRevision}/.github/workflows/release-ios.yml#L1-L82`,
      locator: ".github/workflows/release-ios.yml L1–82",
      snapshotOrDate: revision,
      supports: ["release-state"],
      authority: "direct",
      freshness: "current",
      summary:
        "Release iOS 在 CI completion 后触发，使用全局串行组，并在 prepare job 中判断是否存在 iOS 变化。",
      limitations: ["配置说明预期机制，不能单独解释某次 GitHub 调度状态。"],
    },
    {
      id: "release-run",
      type: "runtime",
      title: "未终结的 Release iOS 运行",
      href: "https://github.com/getyak/talent-signal/actions/runs/31377762230",
      locator: "run 31377762230 · pending · 0 jobs",
      snapshotOrDate: "observed 2026-08-11",
      supports: ["release-state"],
      authority: "direct",
      freshness: "current",
      summary: "当前提交对应的 Release iOS 运行仍为 pending，且 API 未返回 job。",
      limitations: ["状态快照不揭示根因；不能据此断言工作流配置错误或发布失败。"],
    },
    {
      id: "documentation-policy",
      type: "canonical",
      title: "项目知识归档规则",
      href: `${repositoryAtRevision}/docs/documentation.md#L64-L68`,
      locator: "docs/documentation.md L64–68",
      snapshotOrDate: revision,
      supports: ["knowledge-retrieval"],
      authority: "direct",
      freshness: "current",
      summary: "项目要求计划、实现记录和任务产物在任务结束时合并、归档或删除。",
      limitations: ["规则存在不等于所有历史材料已经完成整理。"],
    },
    {
      id: "knowledge-inventory",
      type: "research",
      title: "知识材料数量快照",
      href: `https://github.com/getyak/capir-evals/tree/main/evidence`,
      locator: "654 个 evaluation 文件；25 个 plans；10 个 research；5 个 ADR",
      snapshotOrDate: "2026-08-11 local file inventory",
      supports: ["knowledge-retrieval"],
      authority: "derived",
      freshness: "current",
      summary: "原始评估增长显著快于主题级研究和架构决策材料。",
      limitations: ["文件数量只衡量检索负担的可能性，不衡量单份材料质量。"],
    },
  ],
};

export function getFindingEvidence(
  finding: BriefFinding,
): EvidenceReference[] {
  const byId = new Map(
    projectHealthBrief.evidence.map((reference) => [reference.id, reference]),
  );

  return finding.evidenceIds.flatMap((id) => {
    const reference = byId.get(id);
    return reference ? [reference] : [];
  });
}

export function getHeadlineFindings(): BriefFinding[] {
  const byId = new Map(
    projectHealthBrief.findings.map((finding) => [finding.id, finding]),
  );

  return projectHealthBrief.headlineFindingIds.flatMap((id) => {
    const finding = byId.get(id);
    return finding ? [finding] : [];
  });
}
