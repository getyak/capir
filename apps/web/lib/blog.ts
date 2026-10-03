export type BlogSource = {
  title: string;
  publisher: string;
  url: string;
};

export type BlogPoint = {
  title: string;
  body: string;
};

export type BlogSection = {
  id: string;
  title: string;
  paragraphs: readonly string[];
  points?: readonly BlogPoint[];
  references?: readonly number[];
};

export type BlogPost = {
  slug: string;
  title: string;
  seoTitle: string;
  description: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  updatedAt: string;
  heroImage: string;
  heroAlt: string;
  directAnswer: string;
  keyTakeaways: readonly string[];
  sections: readonly BlogSection[];
  sources: readonly BlogSource[];
  relatedSlugs: readonly string[];
};

export const editorialAuthor = {
  name: "capri 编辑团队",
  url: "/blog/about",
  description:
    "面向证据优先、关系驱动型寻访的产品研究与实践方法。",
} as const;

export const blogPosts: readonly BlogPost[] = [
  {
    slug: "candidate-momentum-vs-pipeline-stage",
    title: "候选人进展不是流程阶段",
    seoTitle: "候选人进展与流程阶段：一个实用模型",
    description:
      "理解候选人进展与流程阶段的差异，并用证据、变化、依赖、行动和结果引导招聘顾问的注意力。",
    excerpt:
      "流程阶段说明进程走到哪里；候选人进展则解释发生了什么变化、当前卡在哪里，以及此刻需要发生什么。",
    category: "候选人进展",
    publishedAt: "2026-08-05T09:00:00+08:00",
    updatedAt: "2026-08-05T09:00:00+08:00",
    heroImage: "/images/blog/candidate-momentum.webp",
    heroAlt:
      "多张纸质证据片段由一条朱红色细线连接到决策点。",
    directAnswer:
      "候选人进展是一段招聘关系中与时间有关的当前状态：什么变了、现在是什么阻碍进展、谁拥有这个依赖项，以及它何时必须解决。流程阶段只记录进程位置，并不能说明关系是否正在向前。",
    keyTakeaways: [
      "把阶段视为流程位置，把进展视为关系状态。",
      "提出跟进前，先记录当前依赖项。",
      "衡量行动是否消除了不确定性，而不是活动数量是否增加。",
    ],
    sections: [
      {
        id: "stage-and-momentum",
        title: "阶段是标签，进展是持续变化的状态",
        paragraphs: [
          "候选人可能停留在同一面试阶段，而关系已经发生实质变化：出现另一份录用意向，搬迁偏好变成硬性限制，或客户仍欠一个关于远程办公的答案。这些变化都不要求 ATS 阶段移动，却会改变招聘顾问下一步应该做什么。",
          "反过来也一样。候选人可以从初面进入终面，但由于一个未解决的依赖项不断变旧，关系进展反而减弱。阶段推进是有用的运营数据，却不是关系的完整说明。",
          "这种差异在独立猎头和精品寻访中尤其重要，因为信任与时机往往存在于消息、电话和承诺里，无法整齐地放进一个流程字段。",
        ],
      },
      {
        id: "five-part-record",
        title: "由五部分组成的进展记录",
        paragraphs: [
          "有用的进展记录应该足够简洁，能一眼审阅；又足够完整，日后能够解释决定。它把五类对象彼此分开。",
        ],
        points: [
          {
            title: "证据",
            body: "准确的消息、笔记或会议观察，并带有说话人、来源与时间。",
          },
          {
            title: "已核验的变化",
            body: "哪些内容变成新的事实、改变了含义，或取代了先前理解。",
          },
          {
            title: "当前依赖项",
            body: "进展此刻依赖的那一个尚未解决的事实、答案、承诺或决定。",
          },
          {
            title: "已批准行动",
            body: "招聘顾问审阅证据与具体效果后选择的最小、明确步骤。",
          },
          {
            title: "已观察结果",
            body: "行动是否发生，以及它解决、改变或未能解决该依赖项。",
          },
        ],
      },
      {
        id: "practical-example",
        title: "一个示例",
        paragraphs: [
          "一位候选人说，另一家公司要求周三前答复，而且远程办公的灵活性很重要。摘要可以保留这两句话，流程仍可能显示为终面。进展记录会提出一组更有用的问题。",
          "第一，哪些原话是明确证据？第二，远程办公是偏好还是条件？第三，招聘顾问是否知道客户政策，还是这正是当前依赖项？第四，在候选人的决策窗口关闭前，能解决它的最小行动是什么？最后，这项行动是否及时带回了经过核验的答案？",
          "价值不在于给候选人贴上紧急标签，而在于让有时间边界的依赖项对能够采取行动的招聘顾问清晰可见。",
        ],
      },
      {
        id: "not-a-score",
        title: "进展绝不能变成人物评分",
        paragraphs: [
          "一个进展分数很诱人，因为它便于排序，但也很危险。它把证据质量、时间压力、招聘顾问责任、客户延迟与模型解释压缩成一个无法解释的数值。这个数字很快会像是在评价一个人，而不是提醒需要完成的工作。",
          "应该排序的是工作注意力。明确的期限、未兑现的承诺或陈旧的客户依赖项可以成为关注理由；候选人的价值、性格、受保护特征、文化匹配或预测接受概率不能。",
          "证据不完整时，正确状态可能是证据不足或无需行动。平静地不行动，胜过建立在缺失来源上的自信建议。",
        ],
        references: [1, 2],
      },
      {
        id: "start-small",
        title: "无需替换 ATS，也可以从小处开始",
        paragraphs: [
          "让 ATS 继续充当流程记录，再增加一个狭窄的关系层：它只查看招聘顾问选择的证据，提出原子化变化，并在任何重要事项发生前请求确认。",
          "从一个候选人与一个寻访项目开始。保留来源、确认身份、分开事实与解释、指出当前依赖项，再提出一项可逆行动。行动完成后记录结果，让结果更新当前视图。",
          "这足以检验真正的承诺：减少背景重建，并在更恰当的时机跟进。如果这个闭环不可信，再多功能也无法弥补。",
        ],
        references: [3, 4],
      },
    ],
    sources: [
      {
        title: "人机交互与风险管理",
        publisher: "NIST AI 资源中心",
        url: "https://airc.nist.gov/airmf-resources/airmf/appendices/app-c-ai-risk-management-and-human-ai-interaction/",
      },
      {
        title: "第 14 条规定的人工监督",
        publisher: "欧盟",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A32024R1689",
      },
      {
        title: "AI 记录助手",
        publisher: "Ashby",
        url: "https://docs.ashbyhq.com/ai-notetaker",
      },
      {
        title: "人才获取功能概览",
        publisher: "Metaview",
        url: "https://support.metaview.ai/guides/overview-for-ta",
      },
    ],
    relatedSlugs: [
      "what-ats-notes-lose",
      "recruiting-ai-without-decision-authority",
    ],
  },
  {
    slug: "recruiting-ai-without-decision-authority",
    title: "使用招聘 AI，但不交出决策权",
    seoTitle: "招聘 AI 的人工监督：一种实用设计",
    description:
      "一种在招聘中使用 AI 的实用模型，同时让证据、解释、批准、执行与结果保持在人类控制下。",
    excerpt:
      "AI 可以减少背景重建，却不应该决定什么是真的、谁值得关注，或工作台之外发生什么变化。",
    category: "负责任的招聘 AI",
    publishedAt: "2026-08-05T09:15:00+08:00",
    updatedAt: "2026-08-05T09:15:00+08:00",
    heroImage: "/images/blog/human-judgment.webp",
    heroAlt:
      "一只手用朱红色铅笔，在层叠的纸张与玻璃上确认一处拟议标记。",
    directAnswer:
      "把招聘 AI 当作提案系统，而不是决策权威。它可以提取候选人事实、识别可能变化并起草可逆的下一步；招聘顾问应核验来源、修正解释、批准明确的外部效果，并观察结果。",
    keyTakeaways: [
      "让模型提案与招聘顾问确认的状态保持分离。",
      "批准界面必须展示准确目标、变更与恢复路径。",
      "把修正、驳回、失败和无需行动的决定都视为有用结果。",
    ],
    sections: [
      {
        id: "right-job-for-ai",
        title: "把背景重建交给 AI，而不是关系权限",
        paragraphs: [
          "招聘顾问常在消息、笔记、日历和 ATS 记录之间重建背景，因而耗费时间。AI 很适合完成第一遍工作：定位明确陈述、归拢相关证据、识别可能变化，并起草简洁的下一步。",
          "这种能力并不让模型成为事实所有者。候选人身份可能含糊，偏好可能被误读为限制，相对日期可能落在错误时区，一个看似合理的跟进也可能忽略先前承诺。",
          "安全边界很简单：模型提出建议，领域规则进行验证，招聘顾问作出决定。再精致的摘要或再自信的语气都不能跨过这条边界。",
        ],
        references: [1, 2],
      },
      {
        id: "four-boundaries",
        title: "保护四条边界",
        paragraphs: [
          "当系统把权限交接的时刻彼此分开，人工监督才真正可执行。",
        ],
        points: [
          {
            title: "证据边界",
            body: "来源必须逐字支持拟议事实，并在相关时显示说话人与时间。",
          },
          {
            title: "状态边界",
            body: "招聘顾问接受或编辑前，提案不会成为已确认的候选人状态。",
          },
          {
            title: "行动边界",
            body: "在明确效果获批前，消息草稿、日历事件或记录补丁都没有执行权限。",
          },
          {
            title: "结果边界",
            body: "API 成功响应不等于关系依赖项已经解决；结果必须被真实观察。",
          },
        ],
      },
      {
        id: "approval-can-fail",
        title: "只有一个确认按钮还不够",
        paragraphs: [
          "审阅界面在形式上可以让人参与，却仍可能鼓励自动化偏见。如果每项提案看起来都已完成、证据被隐藏、默认项被预选，而最容易的操作是全部接受，界面只是在转移责任，并未帮助判断。",
          "NIST 建议在 AI 全生命周期中明确人的角色与责任，并监测人们如何使用或覆盖系统输出。欧盟《AI 法案》关于人工监督的要求也强调：理解局限、避免过度依赖，并能在相关高风险场景中忽略、撤销或停止输出。",
          "Talent Signal 在此不作法律分类判断。更广泛的设计启示是：监督必须可实际执行，而不能只是仪式。",
        ],
        references: [1, 2],
      },
      {
        id: "review-interface",
        title: "设计真正支持判断的审阅",
        paragraphs: [
          "一次只显示一项原子化变化，把准确证据放在旁边。值发生变化时，同时展示前后状态。拟议、已编辑、已确认、已驳回、失败与已取代都应以文字标明，而不能只靠颜色。",
          "后果越大，确认越应明确。修正一条低风险笔记可以轻量进行；匹配不确定身份、改变期限、发送消息或写入日历，则值得更明确的审阅。",
          "始终保留编辑、驳回、重试与恢复路径。好的系统会把证据不足当作有效结果，也允许一项建议正确地变成无需行动。",
        ],
        references: [3],
      },
      {
        id: "measure-oversight",
        title: "衡量监督是否有效",
        paragraphs: [
          "只看接受率奖励的是一致，而不是质量。应审查编辑、驳回、身份修正、提案过期、执行失败及未能解决依赖项的行动，并理解各自原因。",
          "既要寻找模型错误，也要寻找机械盖章的模式。快速连续确认可能意味着提案很好，也可能说明证据太难查验。改变决策门槛前，应把行为数据与定性审阅结合。",
          "节省时间与决策质量要分开衡量。只有招聘顾问仍能识别来源、理解不确定性并从错误提案中恢复时，更快的审阅才有价值。如果速度提高的同时修正或未解决结果也增加，工作流只是把工作移出视野，而非真正消除。",
          "最持久的学习来自提案、决定与观察结果之间的差距。它能让产品理解招聘顾问的判断在哪里创造价值，而不把招聘顾问变成自主系统的标注员。",
        ],
        references: [1],
      },
    ],
    sources: [
      {
        title: "AI RMF 关于人机交互的附录",
        publisher: "NIST AI 资源中心",
        url: "https://airc.nist.gov/airmf-resources/airmf/appendices/app-c-ai-risk-management-and-human-ai-interaction/",
      },
      {
        title: "欧盟条例 2024/1689 第 14 条",
        publisher: "欧盟",
        url: "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A32024R1689",
      },
      {
        title: "面试后 AI 笔记与人工写入",
        publisher: "Ashby",
        url: "https://docs.ashbyhq.com/ai-notetaker-post-interview",
      },
    ],
    relatedSlugs: [
      "candidate-momentum-vs-pipeline-stage",
      "what-ats-notes-lose",
    ],
  },
  {
    slug: "what-ats-notes-lose",
    title: "ATS 备注在候选人对话之间丢失了什么",
    seoTitle: "候选人对话之间，ATS 备注会丢失什么",
    description:
      "了解静态 ATS 备注为何会遗漏证据、变化、时间、当前依赖与结果，以及持续更新的候选人简报如何保留它们。",
    excerpt:
      "一条备注可以保留说过什么，却会丢失什么发生了变化、什么仍未解决，以及下一步为何此刻重要。",
    category: "招聘顾问工作流",
    publishedAt: "2026-08-05T09:30:00+08:00",
    updatedAt: "2026-08-05T09:30:00+08:00",
    heroImage: "/images/blog/current-dependency.webp",
    heroAlt:
      "四块玻璃片保留不同状态，一处朱红色标记指出当前依赖项。",
    directAnswer:
      "静态 ATS 备注通常只保留最新叙述；可用于决策的招聘背景还需要准确来源、发生了什么变化、何时成为事实、当前未解决依赖项、下一步由谁负责，以及行动是否有效。",
    keyTakeaways: [
      "保留证据路径，而不只是最新的文字摘要。",
      "把变化中的事实呈现为历史，而不是覆盖旧值。",
      "让当前依赖项组织简报及其下一步。",
    ],
    sections: [
      {
        id: "note-is-not-state",
        title: "备注不是关系状态",
        paragraphs: [
          "招聘顾问可能在对话后写下准确备注，却仍在下一次对话前感到困难。备注只说明某一时刻发生了什么，很少解释哪个旧事实改变、新陈述是否确认、当前是什么阻碍进展，或承诺的行动是否发生。",
          "增加更多文字无法解决问题。更长的摘要会让当前依赖项更难看见，也更容易遗漏矛盾。真正有用的是一个按寻访项目限定、由可查验证据与版本化决定构成的持续更新视图。",
          "这个视图应保持精简。它不是永久的 AI 人物画像，也不替代 ATS；它解释这次寻访中什么是当前事实，以及理解如何变化。",
        ],
      },
      {
        id: "five-losses",
        title: "扁平备注中消失的五类信息",
        paragraphs: [
          "同一句话会因来源、时间以及与早期证据的关系不同而有不同含义。以下五类损失尤其昂贵。",
        ],
        points: [
          {
            title: "来源",
            body: "读者无法抵达结论背后的准确消息、说话人、截图区域或会议观察。",
          },
          {
            title: "变化",
            body: "只看到最新值，却看不到先前值，也不知道理解为何改变。",
          },
          {
            title: "时间",
            body: "期限、偏好或可沟通时间即使已经过期或被取代，仍会继续显示。",
          },
          {
            title: "依赖项",
            body: "备注列出多个事实，却没有指出进展此刻依赖的那一个未解决答案。",
          },
          {
            title: "结果",
            body: "记录显示拟议跟进，却不说明它是否发生或解决了问题。",
          },
        ],
      },
      {
        id: "history-without-clutter",
        title: "保留历史，但不让页面变得沉重",
        paragraphs: [
          "当前视图应依次突出身份、寻访背景、有意义的变化、当前依赖项、支持证据与一个下一步。早期值和被驳回的提案可以放在渐进展开中。",
          "事实改变时，追加新版本，并把旧版本标为已取代；不要静默覆盖。既要保留事实在关系中何时成立，也要保留系统何时得知或改变它，这两个时间并不总是相同。",
          "这样的历史让修正更安全，也让招聘顾问理解旧建议当时为何合理，而不假装它今天仍然有效。",
        ],
        references: [1],
      },
      {
        id: "current-dependency",
        title: "让当前依赖项组织简报",
        paragraphs: [
          "候选人简报不应与自身争夺注意力。如果下一次面试是否有意义，取决于一个远程政策答案，那么这个依赖项就比宽泛的候选人背景摘要更值得关注。",
          "下一项行动应是能够减少不确定性的最小步骤。它可以是招聘顾问提问、客户确认、提醒，也可以是在有更多证据前无需行动；不应只是因为时间流逝而生成的通用问候。",
          "依赖项改变后，简报也应随之改变。旧行动及观察结果进入历史，当前视图重新恢复平静。",
        ],
      },
      {
        id: "minimum-living-brief",
        title: "最小但有用的持续更新简报",
        paragraphs: [
          "从一份小契约开始：已确认的身份与寻访项目、一个当前依赖项、少量带来源的事实、近期重要变化、一项可审阅行动，以及上一项行动的结果。",
          "公开支持不确定性。无法匹配的截图可以保持未关联，日期可以保持未解决，拟议事实可以被驳回。来源删除后，应依据用户的留存选择移除或使其衍生数据失效。",
          "检验标准很实际：招聘顾问能否无需重读整段对话，就理解什么变了，以及下一步为何重要？如果不能，再多一个摘要也不太可能有帮助。",
        ],
        references: [2, 3, 4],
      },
    ],
    sources: [
      {
        title: "Graphiti 时态知识图谱",
        publisher: "Zep",
        url: "https://github.com/getzep/graphiti",
      },
      {
        title: "在 iOS 中选择照片与视频",
        publisher: "Apple 开发者文档",
        url: "https://developer.apple.com/documentation/PhotoKit/selecting-photos-and-videos-in-ios",
      },
      {
        title: "识别图片中的文字",
        publisher: "Apple 开发者文档",
        url: "https://developer.apple.com/documentation/vision/recognizing-text-in-images",
      },
      {
        title: "Talent Signal 隐私原则",
        publisher: "Talent Signal",
        url: "/privacy",
      },
    ],
    relatedSlugs: [
      "candidate-momentum-vs-pipeline-stage",
      "recruiting-ai-without-decision-authority",
    ],
  },
];

export function getBlogPost(slug: string) {
  return blogPosts.find((post) => post.slug === slug);
}

export function formatBlogDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Singapore",
    year: "numeric",
  }).format(new Date(value));
}

export function getBlogPostText(post: BlogPost) {
  return [
    post.title,
    post.description,
    post.directAnswer,
    ...post.keyTakeaways,
    ...post.sections.flatMap((section) => [
      section.title,
      ...section.paragraphs,
      ...(section.points?.flatMap((point) => [point.title, point.body]) ?? []),
    ]),
  ].join(" ");
}

export function getBlogPostWordCount(post: BlogPost) {
  const text = getBlogPostText(post).trim();
  const chineseCharacters = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return chineseCharacters + latinWords;
}

export function getBlogPostReadingMinutes(post: BlogPost) {
  return Math.max(1, Math.ceil(getBlogPostWordCount(post) / 400));
}

export function getLatestBlogUpdate() {
  return blogPosts.reduce(
    (latest, post) =>
      new Date(post.updatedAt).getTime() > new Date(latest).getTime()
        ? post.updatedAt
        : latest,
    blogPosts[0].updatedAt,
  );
}

export function getBlogPostsByNewest() {
  return [...blogPosts].sort(
    (left, right) =>
      new Date(right.publishedAt).getTime() -
      new Date(left.publishedAt).getTime(),
  );
}
