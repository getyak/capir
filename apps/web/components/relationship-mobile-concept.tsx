"use client";

import {
  ArrowLeft,
  ArrowRight,
  BatteryMedium,
  BookOpen,
  Briefcase,
  CaretDown,
  CaretRight,
  Check,
  Copy,
  Compass,
  DotsThree,
  Export,
  Gear,
  Images,
  Lifebuoy,
  ListDashes,
  MagnifyingGlass,
  Megaphone,
  Microphone,
  NotePencil,
  PencilSimple,
  Plus,
  Question,
  Quotes,
  ShareNetwork,
  ShieldCheck,
  StackSimple,
  Star,
  TextT,
  Trash,
  UsersThree,
  WarningCircle,
  Waveform,
  WifiHigh,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./relationship-mobile-concept.module.css";

type Direction = "archive" | "concierge";
type MaterialDirection = "museum" | "pebbles";
type CollectionView = "now" | "all" | "quiet";
type AgentMode = "home" | "find" | "answer" | "remember";
type ArchivePage = "today" | "people" | "library";
type ReviewKind = "change" | "resume";
type CapturePhase = "collect" | "review" | "receipt";
type CaptureVoiceState = "empty" | "recording" | "ready";
type SpeakerPerspective = "candidate" | "recruiter" | "unknown";

type CaptureAsset = {
  id: string;
  kind: "local" | "synthetic";
  label: string;
  channel: string;
  preview: string;
};

type CaptureDraft = {
  assets: CaptureAsset[];
  note: string;
  phase: CapturePhase;
  selectedAssetId: string | null;
  speakerPerspective: SpeakerPerspective | null;
  voiceState: CaptureVoiceState;
};

type Person = {
  id: string;
  name: string;
  role: string;
  company: string;
  relationship: string;
  dependency: string;
  recency: string;
  state: "changed" | "waiting" | "review" | "quiet" | "identity";
  avatar?: string;
  initials: string;
};

type DetailContent = {
  conditionHeading: string;
  conditionBody: string;
  changeTitle: string;
  quote: string;
  provenance: string;
  before: string;
  now: string;
  nextStep: string;
};

const syntheticCaptureAssets: CaptureAsset[] = [
  {
    id: "sample-whatsapp",
    kind: "synthetic",
    label: "对话 01",
    channel: "WhatsApp",
    preview: "/marketing/signal-journey/whatsapp-synthetic.webp",
  },
  {
    id: "sample-wechat",
    kind: "synthetic",
    label: "对话 02",
    channel: "WeChat",
    preview: "/marketing/signal-journey/wechat-synthetic.webp",
  },
  {
    id: "sample-boss",
    kind: "synthetic",
    label: "对话 03",
    channel: "BOSS",
    preview: "/marketing/signal-journey/boss-synthetic.webp",
  },
];

function createEmptyCaptureDraft(): CaptureDraft {
  return {
    assets: [],
    note: "",
    phase: "collect",
    selectedAssetId: null,
    speakerPerspective: null,
    voiceState: "empty",
  };
}

const people: Person[] = [
  {
    id: "leila",
    name: "Leila Hartmann",
    role: "产品副总裁",
    company: "Meridian Labs",
    relationship: "首席产品官寻访",
    dependency: "远程办公政策等待客户确认。",
    recency: "2 小时",
    state: "changed",
    avatar: "/concepts/relationships/avatars/leila.webp",
    initials: "LH",
  },
  {
    id: "nia",
    name: "Nia Williams",
    role: "独立董事",
    company: "人才网络关系",
    relationship: "董事长人才图谱",
    dependency: "两个来源对出差限制的说法不一致。",
    recency: "5 小时",
    state: "review",
    avatar: "/concepts/relationships/avatars/nia.webp",
    initials: "NW",
  },
  {
    id: "maya",
    name: "Maya Ortiz",
    role: "运营合伙人",
    company: "Northlight Capital",
    relationship: "兼职首席财务官寻访",
    dependency: "创始人会议已经可以安排。",
    recency: "1 天",
    state: "waiting",
    avatar: "/concepts/relationships/avatars/maya.webp",
    initials: "MO",
  },
  {
    id: "amir",
    name: "Amir Okafor",
    role: "工程副总裁",
    company: "Rubicon Health",
    relationship: "首席技术官继任",
    dependency: "董事会回复前保持安静。",
    recency: "4 天",
    state: "quiet",
    avatar: "/concepts/relationships/avatars/amir.webp",
    initials: "AO",
  },
  {
    id: "zhang",
    name: "张伟 / Wei Zhang-Sørensen",
    role: "首席人力官",
    company: "独立候选人",
    relationship: "领导人才网络",
    dependency: "身份依据不足。",
    recency: "2 周",
    state: "identity",
    initials: "伟",
  },
];

const collectionLabels: Record<CollectionView, string> = {
  now: "现在",
  all: "全部",
  quiet: "安静",
};

const stateLabels: Record<Person["state"], string> = {
  changed: "有变化",
  waiting: "等待中",
  review: "需要审阅",
  quiet: "无需行动",
  identity: "身份审阅",
};

const detailContent: Record<Person["id"], DetailContent> = {
  leila: {
    conditionHeading: "一个答案掌握在客户手中。",
    conditionBody:
      "在 Leila 周五做决定前，确认是否支持在新加坡远程办公。",
    changeTitle: "决策窗口",
    quote: "I could do Singapore, but not full-time relocation.",
    provenance: "WhatsApp 截图 / 周四 22:18 / 招聘顾问已审阅",
    before: "此前假设远程政策灵活",
    now: "是否需要长期搬迁未解决",
    nextStep: "向客户确认一个明确问题。",
  },
  nia: {
    conditionHeading: "出差限制需要一次人工审阅。",
    conditionBody:
      "两个已审阅来源描述了不同的出差限制，任何一方都不应静默覆盖另一方。",
    changeTitle: "出差可行性",
    quote:
      "Monthly travel is workable, but I would not want a weekly international cadence.",
    provenance: "通话记录 / 8 月 7 日 08:40 / 与此前邮件冲突",
    before: "按季度出差",
    now: "来源冲突",
    nextStep: "向 Nia 确认当前适用的频率。",
  },
  maya: {
    conditionHeading: "日程这一步由创始人负责。",
    conditionBody:
      "Maya 已提供会议时间，时区仍是唯一缺失的细节。",
    changeTitle: "创始人可用时间",
    quote: "I can meet the founder next Tuesday if we settle the timezone.",
    provenance: "招聘顾问备注 / 8 月 6 日 17:20 / 草稿背景",
    before: "会议尚未安排",
    now: "已提供周二时间",
    nextStep: "安排会议前确认时区。",
  },
  amir: {
    conditionHeading: "董事会回复前不采取行动。",
    conditionBody:
      "这段关系有意保持安静。提醒只会增加压力，并不会改变依赖。",
    changeTitle: "董事会依赖",
    quote: "Let's hold here until the board has aligned on the mandate.",
    provenance: "邮件 / 8 月 3 日 14:05 / 招聘顾问已审阅",
    before: "曾考虑跟进",
    now: "无需行动",
    nextStep: "等待董事会回复。",
  },
  zhang: {
    conditionHeading: "必须先解决身份问题。",
    conditionBody:
      "导入的线索不足以将此来源附到现有关系。",
    changeTitle: "身份依据",
    quote: "The card contains a name and title, but no current verified contact clue.",
    provenance: "导入的联系人名片 / 7 月 24 日 / 身份未解决",
    before: "可能匹配",
    now: "需要审阅",
    nextStep: "分享或附加依据前先解决身份问题。",
  },
};

function Avatar({
  person,
  size = "medium",
}: {
  person: Person;
  size?: "small" | "medium" | "large";
}) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${styles[`avatar${size[0].toUpperCase()}${size.slice(1)}`]}`}
    >
      {person.avatar ? (
        <Image
          alt=""
          fill
          sizes={size === "large" ? "76px" : size === "small" ? "38px" : "50px"}
          src={person.avatar}
        />
      ) : (
        <span>{person.initials}</span>
      )}
    </span>
  );
}

function StatusBar() {
  return (
    <div aria-hidden="true" className={styles.statusBar}>
      <span>9:41</span>
      <span className={styles.dynamicIsland} />
      <span className={styles.systemStatus}>
        <WifiHigh size={15} weight="bold" />
        <BatteryMedium size={20} weight="fill" />
      </span>
    </div>
  );
}

function MenuItem({
  autoFocus = false,
  detail,
  disabled = false,
  icon,
  label,
  onClick,
  trailing,
}: {
  autoFocus?: boolean;
  detail?: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      autoFocus={autoFocus}
      className={styles.menuItem}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      <span className={styles.menuItemIcon}>{icon}</span>
      <span className={styles.menuItemCopy}>
        <strong>{label}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {trailing ? <span className={styles.menuItemTrailing}>{trailing}</span> : null}
    </button>
  );
}

function BrandOrb({
  expanded,
  onClick,
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      aria-haspopup="menu"
      aria-label="打开 capri 菜单"
      className={styles.brandOrb}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className={styles.brandOrbMark}>
        <span />
        <span />
        <span />
      </span>
    </button>
  );
}

function BrandMenu({ onClose }: { onClose: () => void }) {
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [receipt, setReceipt] = useState(
    "工作区设置与关系依据保持分离。",
  );

  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  return (
    <>
      <button
        aria-label="关闭 capri 菜单"
        className={styles.menuScrim}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label="capri 菜单"
        className={`${styles.contextMenu} ${styles.brandMenu}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        role="menu"
      >
        <div className={styles.menuIdentity}>
          <span className={styles.menuIdentityMark}>
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>capri</strong>
            <small>私密关系工作区</small>
          </span>
        </div>
        <div className={styles.menuGroup}>
          <button
            className={styles.menuItem}
            onClick={() =>
              setReceipt("设置仅作用于账号，未更改任何关系状态。")
            }
            ref={firstItemRef}
            role="menuitem"
            type="button"
          >
            <span className={styles.menuItemIcon}>
              <Gear size={18} />
            </span>
            <span className={styles.menuItemCopy}>
              <strong>设置</strong>
              <small>工作区、外观与通知</small>
            </span>
          </button>
          <MenuItem
            detail="来源、保留与删除"
            icon={<ShieldCheck size={18} />}
            label="隐私与依据"
            onClick={() =>
              setReceipt("依据控制已打开，不会暴露对话内容。")
            }
          />
        </div>
        <div className={styles.menuGroup}>
          <MenuItem
            detail="指南与联系支持"
            icon={<Lifebuoy size={18} />}
            label="支持"
            onClick={() => setReceipt("支持将在关系记录之外打开。")}
          />
          <MenuItem
            detail="持续更新档案的玻璃质感探索"
            icon={<Megaphone size={18} />}
            label="新功能"
            onClick={() => setReceipt("版本说明已可查看。")}
            trailing="0.3"
          />
        </div>
        <p aria-live="polite" className={styles.menuReceipt}>
          {receipt}
        </p>
      </section>
    </>
  );
}

function AgentRail({
  captureCount = 0,
  label = "询问什么值得关注……",
  onCapture,
  onOpen,
}: {
  captureCount?: number;
  label?: string;
  onCapture: () => void;
  onOpen: () => void;
}) {
  return (
    <div className={styles.agentRail}>
      <button aria-label="搜索关系" onClick={onOpen} type="button">
        <MagnifyingGlass size={21} />
      </button>
      <button className={styles.agentRailPrompt} onClick={onOpen} type="button">
        <span>{label}</span>
        <small>仅限草稿权限</small>
      </button>
      <button
        aria-label={
          captureCount > 0
            ? `继续关系采集，共 ${captureCount} 个来源`
            : "记录关系时刻"
        }
        className={styles.captureLauncher}
        data-capture-launcher="true"
        onClick={onCapture}
        type="button"
      >
        <NotePencil size={21} />
        {captureCount > 0 ? (
          <span aria-hidden="true">{captureCount}</span>
        ) : null}
      </button>
    </div>
  );
}

function ArchiveHeader({
  active,
  onChange,
}: {
  active: ArchivePage;
  onChange: (value: ArchivePage) => void;
}) {
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);

  return (
    <>
      <header className={styles.archiveHeader}>
        <BrandOrb
          expanded={brandMenuOpen}
          onClick={() => setBrandMenuOpen((value) => !value)}
        />
        <nav aria-label="主导航">
          <button
            aria-current={active === "today" ? "page" : undefined}
            className={active === "today" ? styles.headerNavActive : ""}
            onClick={() => onChange("today")}
            type="button"
          >
            今天
          </button>
          <button
            aria-current={active === "people" ? "page" : undefined}
            className={active === "people" ? styles.headerNavActive : ""}
            onClick={() => onChange("people")}
            type="button"
          >
            人才
          </button>
          <button
            aria-current={active === "library" ? "page" : undefined}
            className={active === "library" ? styles.headerNavActive : ""}
            onClick={() => onChange("library")}
            type="button"
          >
            资料库
          </button>
        </nav>
        <span aria-hidden="true" className={styles.headerBalance} />
      </header>
      {brandMenuOpen ? (
        <BrandMenu onClose={() => setBrandMenuOpen(false)} />
      ) : null}
    </>
  );
}

function PersonRow({
  person,
  onSelect,
}: {
  person: Person;
  onSelect: (person: Person) => void;
}) {
  return (
    <button
      className={styles.personRow}
      onClick={() => onSelect(person)}
      type="button"
    >
      <Avatar person={person} />
      <span className={styles.personRowBody}>
        <span className={styles.personRowOverline}>
          <span
            className={person.state === "changed" ? styles.changedMarker : ""}
          >
            {stateLabels[person.state]}
          </span>
          <span>{person.recency}</span>
        </span>
        <strong>{person.name}</strong>
        <span className={styles.personRole}>
          {person.role}
          <span aria-hidden="true"> / </span>
          {person.company}
        </span>
        <span className={styles.personDependency}>{person.dependency}</span>
      </span>
      <CaretRight aria-hidden="true" size={16} />
    </button>
  );
}

function PeopleArchive({
  captureCount,
  onCapture,
  onGuide,
  onLibrary,
  onSelect,
  onToday,
}: {
  captureCount: number;
  onCapture: () => void;
  onGuide: (mode?: AgentMode, person?: Person) => void;
  onLibrary: () => void;
  onSelect: (person: Person) => void;
  onToday: () => void;
}) {
  const [collection, setCollection] = useState<CollectionView>("now");

  const filtered = useMemo(() => {
    if (collection === "quiet") {
      return people.filter((person) => person.state === "quiet");
    }
    if (collection === "now") {
      return people.filter((person) =>
        ["changed", "review", "waiting"].includes(person.state),
      );
    }
    return people;
  }, [collection]);

  const counts: Record<CollectionView, number> = {
    now: 3,
    all: people.length,
    quiet: 1,
  };

  return (
    <div className={styles.phoneScreen}>
      <ArchiveHeader
        active="people"
        onChange={(value) => {
          if (value === "today") {
            onToday();
          } else if (value === "library") {
            onLibrary();
          }
        }}
      />

      <div className={styles.archiveMain}>
        <section className={styles.archiveIntro}>
          <span>持续更新的关系档案 / 05</span>
          <h1>人才</h1>
          <p>
            一个人可以承担多个角色，每段关系都保留自己的背景。
          </p>
        </section>

        <button
          className={styles.assignmentLine}
          onClick={() => onGuide("find")}
          type="button"
        >
          <span>
            <Briefcase size={16} />
            首席产品官寻访
          </span>
          <span>
            3 项进行中
            <CaretDown size={13} weight="bold" />
          </span>
        </button>

        <nav aria-label="集合视图" className={styles.collectionNav}>
          {(Object.keys(collectionLabels) as CollectionView[]).map((item) => (
            <button
              aria-pressed={collection === item}
              className={collection === item ? styles.collectionActive : ""}
              key={item}
              onClick={() => setCollection(item)}
              type="button"
            >
              {collectionLabels[item]}
              <span>{counts[item]}</span>
            </button>
          ))}
        </nav>

        <section aria-label={`${collectionLabels[collection]}关系`}>
          <div className={styles.collectionLabel}>
            <span>
              {collection === "now"
                ? "值得查看的原因"
                : collection === "quiet"
                  ? "不施加压力地保留"
                  : "关系索引"}
            </span>
            <span>仅显示已审阅依据</span>
          </div>
          <div className={styles.peopleCollection}>
            {filtered.map((person) => (
              <PersonRow key={person.id} onSelect={onSelect} person={person} />
            ))}
          </div>
        </section>
      </div>

      <AgentRail
        captureCount={captureCount}
        onCapture={onCapture}
        onOpen={() => onGuide("home")}
      />
    </div>
  );
}

function TodayArchive({
  captureCount,
  onCapture,
  onGuide,
  onLibrary,
  onPeople,
  onResume,
  onReview,
}: {
  captureCount: number;
  onCapture: () => void;
  onGuide: (mode?: AgentMode, person?: Person) => void;
  onLibrary: () => void;
  onPeople: () => void;
  onResume: (person: Person) => void;
  onReview: (person: Person) => void;
}) {
  const leila = people[0];
  const nia = people[1];

  return (
    <div className={styles.phoneScreen}>
      <ArchiveHeader
        active="today"
        onChange={(value) => {
          if (value === "people") {
            onPeople();
          } else if (value === "library") {
            onLibrary();
          }
        }}
      />

      <div className={`${styles.archiveMain} ${styles.todayMain}`}>
        <section className={`${styles.archiveIntro} ${styles.todayIntro}`}>
          <span>8 月 7 日，星期五</span>
          <h1>今天</h1>
          <p>有两段关系值得你做出判断。</p>
        </section>

        <section className={styles.todayFocus} aria-labelledby="today-focus-title">
          <div>
            <span>回到</span>
            <p className={styles.todayContext}>
              Leila Hartmann
              <span aria-hidden="true"> / </span>
              首席产品官寻访
            </p>
            <h2 id="today-focus-title">
              客户的一项答复正在影响她的决定。
            </h2>
            <p>
              在新加坡远程办公仍未解决。
            </p>
            <small>周四对话后发生了变化。</small>
          </div>
          <button onClick={() => onReview(leila)} type="button">
            审阅变化
            <ArrowRight size={16} />
          </button>
        </section>

        <section className={styles.todaySecondary} aria-labelledby="today-next-title">
          <h2 id="today-next-title">继续处理</h2>
          <button
            className={styles.todayResumeRow}
            onClick={() => onResume(nia)}
            type="button"
          >
            <Avatar person={nia} size="small" />
            <span>
              <strong>Nia Williams</strong>
              <small>董事寻访</small>
              <em>需要审阅 / 5 小时</em>
            </span>
            <CaretRight aria-hidden="true" size={17} />
          </button>
          <button
            className={styles.todayResumeRow}
            onClick={() => onGuide("remember")}
            type="button"
          >
            <span aria-hidden="true" className={styles.libraryGlyph}>
              AL
            </span>
            <span>
              <strong>Atlas Labs</strong>
              <small>客户简报</small>
              <em>周五前需要答复</em>
            </span>
            <CaretRight aria-hidden="true" size={17} />
          </button>
        </section>

        <section className={styles.quietNote}>
          <Check size={17} weight="bold" />
          <p>14 段关系无需行动。</p>
        </section>
      </div>

      <AgentRail
        captureCount={captureCount}
        label="询问什么值得关注……"
        onCapture={onCapture}
        onOpen={() => onGuide("answer", leila)}
      />
    </div>
  );
}

function LibraryArchive({
  captureCount,
  onCapture,
  onGuide,
  onPeople,
  onSelect,
  onToday,
}: {
  captureCount: number;
  onCapture: () => void;
  onGuide: (mode?: AgentMode, person?: Person) => void;
  onPeople: () => void;
  onSelect: (person: Person) => void;
  onToday: () => void;
}) {
  return (
    <div className={styles.phoneScreen}>
      <ArchiveHeader
        active="library"
        onChange={(value) => {
          if (value === "today") {
            onToday();
          } else if (value === "people") {
            onPeople();
          }
        }}
      />

      <div className={`${styles.archiveMain} ${styles.libraryMain}`}>
        <section className={styles.archiveIntro}>
          <span>已审阅背景</span>
          <h1>资料库</h1>
          <p>可信的项目空间、来源依据与简报。</p>
        </section>

        <section aria-labelledby="library-rooms">
          <div className={styles.collectionLabel}>
            <span id="library-rooms">项目空间</span>
            <span>02</span>
          </div>
          <button
            className={styles.libraryRow}
            onClick={() => onSelect(people[0])}
            type="button"
          >
            <span className={styles.libraryIcon}>
              <Briefcase size={18} />
            </span>
            <span>
              <strong>首席产品官寻访</strong>
              <small>3 段关系 / 1 项决定待处理</small>
            </span>
            <CaretRight size={16} />
          </button>
          <button
            className={styles.libraryRow}
            onClick={() => onSelect(people[1])}
            type="button"
          >
            <span className={styles.libraryIcon}>
              <BookOpen size={18} />
            </span>
            <span>
              <strong>董事长人才图谱</strong>
              <small>已保留第 2/3 项依据审阅</small>
            </span>
            <CaretRight size={16} />
          </button>
        </section>

        <section className={styles.libraryEvidence} aria-labelledby="library-evidence">
          <div className={styles.collectionLabel}>
            <span id="library-evidence">最近依据</span>
            <span>已审阅</span>
          </div>
          <button
            className={styles.libraryQuote}
            onClick={() => onSelect(people[0])}
            type="button"
          >
            <Quotes size={18} weight="fill" />
            <span>
              <strong>&ldquo;I could do Singapore...&rdquo;</strong>
              <small>Leila / WhatsApp 截图 / 周四 22:18</small>
            </span>
            <CaretRight size={16} />
          </button>
        </section>
      </div>

      <AgentRail
        captureCount={captureCount}
        label="查找来源或关系……"
        onCapture={onCapture}
        onOpen={() => onGuide("find")}
      />
    </div>
  );
}

function ChangeReview({
  kind,
  onBack,
  onOpenPerson,
  person,
}: {
  kind: ReviewKind;
  onBack: () => void;
  onOpenPerson: (person: Person) => void;
  person: Person;
}) {
  const [phase, setPhase] = useState<"resume" | "evidence">(
    kind === "resume" ? "resume" : "evidence",
  );
  const [decision, setDecision] = useState<"confirmed" | "unresolved" | null>(
    null,
  );
  const detail = detailContent[person.id];
  const isLeila = person.id === "leila";

  return (
    <div className={styles.phoneScreen}>
      <header className={styles.reviewNav}>
        <button aria-label="返回今天" onClick={onBack} type="button">
          <ArrowLeft size={20} />
        </button>
        <span>{phase === "resume" ? "继续审阅" : "审阅变化"}</span>
        <button
          aria-label={`打开 ${person.name} 的关系页面`}
          onClick={() => onOpenPerson(person)}
          type="button"
        >
          <Avatar person={person} size="small" />
        </button>
      </header>

      <div className={styles.reviewMain}>
        {phase === "resume" ? (
          <section className={styles.resumeSheet} aria-labelledby="resume-title">
            <span>带着背景继续</span>
            <h1 id="resume-title">你上次停在审阅 {person.name.split(" ")[0]} 的位置。</h1>
            <p>编辑已保存，未发送任何消息。</p>
            <div className={styles.resumeProgress}>
              <span className={styles.libraryIcon}>
                <NotePencil size={18} />
              </span>
              <span>
                <strong>{person.relationship}</strong>
                <small>第 2/3 项依据</small>
              </span>
            </div>
            <button onClick={() => setPhase("evidence")} type="button">
              继续审阅
              <ArrowRight size={17} />
            </button>
            <div className={styles.resumeQuiet}>
              <Check size={17} />
              <span>当前安静 / 14 段关系无需行动</span>
            </div>
          </section>
        ) : (
          <section className={styles.evidenceDecision} aria-labelledby="proposal-title">
            <span>为何出现在这里</span>
            <div className={styles.reviewQuote}>
              <Quotes aria-hidden="true" size={19} weight="fill" />
              <blockquote>&ldquo;{detail.quote}&rdquo;</blockquote>
              <small>
                {person.name.split(" ")[0]} / {detail.provenance}
              </small>
            </div>

            <span aria-hidden="true" className={styles.causalSeam}>
              <i />
            </span>

            <div className={styles.proposalBlock}>
              <span>拟议变化</span>
              <h1 id="proposal-title">
                {isLeila
                  ? "这项寻访中的远程办公问题仍未解决。"
                  : "这项寻访中的出差频率仍未解决。"}
              </h1>
              <p>
                这只会更改关系状态，不会发送消息或写入外部系统。
              </p>
              <div className={styles.reviewActions}>
                <button
                  aria-pressed={decision === "unresolved"}
                  onClick={() => setDecision("unresolved")}
                  type="button"
                >
                  保持未解决
                </button>
                <button
                  aria-pressed={decision === "confirmed"}
                  onClick={() => setDecision("confirmed")}
                  type="button"
                >
                  确认变化
                </button>
              </div>
            </div>

            {decision ? (
              <div aria-live="polite" className={styles.reviewReceipt}>
                <Check size={18} weight="bold" />
                <div>
                  <strong>
                    {decision === "confirmed"
                      ? "关系状态已确认。"
                      : "问题仍未解决。"}
                  </strong>
                  <p>未发送任何消息，你可以撤销这次审阅。</p>
                  <button onClick={() => setDecision(null)} type="button">
                    撤销
                  </button>
                </div>
              </div>
            ) : null}

            <dl className={styles.reviewDiff}>
              <div>
                <dt>之前</dt>
                <dd>{detail.before}</dd>
              </div>
              <div>
                <dt>拟议</dt>
                <dd>{detail.now}</dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function PersonShareMenu({
  onClose,
  person,
}: {
  onClose: () => void;
  person: Person;
}) {
  const [receipt, setReceipt] = useState(
    person.state === "identity"
      ? "身份依据解决前无法分享。"
      : "访问权限和所含依据完成审阅前，不会分享任何内容。",
  );

  return (
    <>
      <button
        aria-label="关闭分享菜单"
        className={styles.menuScrim}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label={`分享 ${person.name} 的关系`}
        className={`${styles.contextMenu} ${styles.personMenu}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        role="menu"
      >
        <div className={styles.personMenuHeading}>
          <span>默认私密</span>
          <h2>分享关系</h2>
          <p>只有招聘顾问审阅过的背景才能进入共享视图。</p>
        </div>
        <div className={styles.menuGroup}>
          <MenuItem
            autoFocus
            detail="先暂存访问权限与依据"
            disabled={person.state === "identity"}
            icon={<Copy size={18} />}
            label="创建私密链接"
            onClick={() =>
              setReceipt("私密链接草稿已就绪，访问权限未改变。")
            }
          />
          <MenuItem
            detail="已审阅事实与来源注释"
            disabled={person.state === "identity"}
            icon={<Export size={18} />}
            label="导出简报"
            onClick={() =>
              setReceipt("导出预览已暂存，尚未创建文件。")
            }
          />
          <MenuItem
            detail="人员、到期与撤销"
            disabled={person.state === "identity"}
            icon={<ShieldCheck size={18} />}
            label="管理访问权限"
            onClick={() =>
              setReceipt("访问审阅已打开，现有权限未改变。")
            }
          />
        </div>
        <p aria-live="polite" className={styles.menuReceipt}>
          {receipt}
        </p>
      </section>
    </>
  );
}

function PersonActionMenu({
  favorite,
  onCapture,
  onClose,
  onFavoriteChange,
  person,
}: {
  favorite: boolean;
  onCapture: () => void;
  onClose: () => void;
  onFavoriteChange: (value: boolean) => void;
  person: Person;
}) {
  const [receipt, setReceipt] = useState(
    "操作只作用于这段关系背景，而不是这个人的全局状态。",
  );

  return (
    <>
      <button
        aria-label="关闭关系操作"
        className={styles.menuScrim}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label={`${person.name} 的关系操作`}
        className={`${styles.contextMenu} ${styles.personMenu}`}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
          }
        }}
        role="menu"
      >
        <div className={styles.personMenuHeading}>
          <span>{person.relationship}</span>
          <h2>关系操作</h2>
          <p>在依据与影响完成审阅前，编辑会保持暂存。</p>
        </div>
        <div className={styles.menuGroup}>
          <MenuItem
            autoFocus
            detail="已确认状态与项目背景"
            icon={<PencilSimple size={18} />}
            label="编辑关系"
            onClick={() =>
              setReceipt("编辑器已暂存，未更改已确认的关系状态。")
            }
          />
          <MenuItem
            detail="解释前先保留原话"
            icon={<Plus size={18} />}
            label="添加备注或依据"
            onClick={onCapture}
          />
          <MenuItem
            detail="个人快捷方式，绝不作为人物排名"
            icon={<Star size={18} weight={favorite ? "fill" : "regular"} />}
            label={favorite ? "从收藏中移除" : "添加到收藏"}
            onClick={() => {
              onFavoriteChange(!favorite);
              setReceipt(
                favorite
                  ? "已从个人快捷方式中移除，关系状态未改变。"
                  : "已添加到个人快捷方式，关系状态未改变。",
              );
            }}
            trailing={favorite ? <Check size={16} weight="bold" /> : null}
          />
          <MenuItem
            detail="来源、变化与恢复"
            icon={<ShieldCheck size={18} />}
            label="查看关系历史"
            onClick={() =>
              setReceipt("历史记录以只读可信视图打开。")
            }
          />
        </div>
        <p aria-live="polite" className={styles.menuReceipt}>
          {receipt}
        </p>
      </section>
    </>
  );
}

function PersonDetail({
  captureCount,
  onBack,
  onCapture,
  onGuide,
  person,
}: {
  captureCount: number;
  onBack: () => void;
  onCapture: (person: Person) => void;
  onGuide: (mode?: AgentMode, person?: Person) => void;
  person: Person;
}) {
  const [favorite, setFavorite] = useState(false);
  const [openMenu, setOpenMenu] = useState<"share" | "actions" | null>(null);
  const detail = detailContent[person.id];

  return (
    <div className={styles.phoneScreen}>
      <header className={styles.personNav}>
        <button aria-label="返回人才列表" onClick={onBack} type="button">
          <ArrowLeft size={20} />
        </button>
        <span>关系 01</span>
        <div className={styles.personNavActions}>
          <button
            aria-expanded={openMenu === "share"}
            aria-haspopup="menu"
            aria-label={`分享 ${person.name} 的关系`}
            onClick={() =>
              setOpenMenu((value) => (value === "share" ? null : "share"))
            }
            type="button"
          >
            <ShareNetwork size={20} />
          </button>
          <button
            aria-expanded={openMenu === "actions"}
            aria-haspopup="menu"
            aria-label={`${person.name} 的关系操作`}
            onClick={() =>
              setOpenMenu((value) => (value === "actions" ? null : "actions"))
            }
            type="button"
          >
            <DotsThree size={22} weight="bold" />
          </button>
        </div>
      </header>

      <div className={`${styles.archiveMain} ${styles.personMain}`}>
        <section className={styles.personIdentity}>
          <Avatar person={person} size="large" />
          <div>
            <span>{person.relationship}</span>
            <h1>{person.name}</h1>
            <p>
              {person.role} / {person.company}
              {favorite ? (
                <span className={styles.favoriteIndicator}>
                  <Star size={11} weight="fill" />
                  个人快捷方式
                </span>
              ) : null}
            </p>
          </div>
        </section>

        <section className={styles.conditionSection} aria-labelledby="condition-title">
          <div className={styles.sectionIndex}>
            <span>当前情况</span>
            <span>01</span>
          </div>
          <h2 id="condition-title">{detail.conditionHeading}</h2>
          <p>{detail.conditionBody}</p>
        </section>

        <section className={styles.changeSection} aria-labelledby="change-title">
          <div className={styles.sectionIndex}>
            <span>发生了什么变化</span>
            <span>已确认</span>
          </div>
          <h2 id="change-title">{detail.changeTitle}</h2>
          <div className={styles.evidenceQuote}>
            <Quotes size={19} weight="fill" />
            <blockquote>“{detail.quote}”</blockquote>
            <small>{detail.provenance}</small>
          </div>
          <dl className={styles.stateChange}>
            <div>
              <dt>之前</dt>
              <dd>{detail.before}</dd>
            </div>
            <ArrowRight aria-hidden="true" size={18} />
            <div>
              <dt>现在</dt>
              <dd>{detail.now}</dd>
            </div>
          </dl>
          <button className={styles.historyLink} type="button">
            查看来源与历史
            <ArrowRight size={15} />
          </button>
        </section>

        <section className={styles.nextStepSection} aria-labelledby="next-step-title">
          <div className={styles.sectionIndex}>
            <span>最小且稳妥的下一步</span>
            <span>仅限草稿</span>
          </div>
          <h2 id="next-step-title">{detail.nextStep}</h2>
          <button onClick={() => onGuide("answer", person)} type="button">
            通过智能助理暂存
            <ArrowRight size={16} />
          </button>
          <p>此页面不会发送任何消息。</p>
        </section>
      </div>

      <AgentRail
        captureCount={captureCount}
        label={`询问关于 ${person.name.split(" ")[0]} 的情况……`}
        onCapture={() => onCapture(person)}
        onOpen={() => onGuide("answer", person)}
      />
      {openMenu === "share" ? (
        <PersonShareMenu onClose={() => setOpenMenu(null)} person={person} />
      ) : null}
      {openMenu === "actions" ? (
        <PersonActionMenu
          favorite={favorite}
          onCapture={() => {
            setOpenMenu(null);
            onCapture(person);
          }}
          onClose={() => setOpenMenu(null)}
          onFavoriteChange={setFavorite}
          person={person}
        />
      ) : null}
    </div>
  );
}

function CaptureSheet({
  contextSuggestion,
  draft,
  onClearContext,
  onClose,
  onDelete,
  setDraft,
}: {
  contextSuggestion: Person | null;
  draft: CaptureDraft;
  onClearContext: () => void;
  onClose: () => void;
  onDelete: () => void;
  setDraft: Dispatch<SetStateAction<CaptureDraft>>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [noteOpen, setNoteOpen] = useState(draft.note.trim().length > 0);
  const selectedAsset =
    draft.assets.find((asset) => asset.id === draft.selectedAssetId) ??
    draft.assets[0] ??
    null;
  const canPrepare =
    draft.assets.length > 0 ||
    draft.note.trim().length > 0 ||
    draft.voiceState === "ready";
  const contextItemCount =
    (draft.note.trim().length > 0 ? 1 : 0) +
    (draft.voiceState === "ready" ? 1 : 0);
  const itemCount = draft.assets.length + contextItemCount;
  const hasLocalSources = draft.assets.some((asset) => asset.kind === "local");
  const resultKind = hasLocalSources
    ? "local"
    : draft.assets.length > 1
      ? "organize"
      : draft.assets.length === 1
        ? "identity"
        : "note";

  useEffect(() => {
    closeRef.current?.focus();
  }, [draft.phase]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) {
      return;
    }

    const existingAssets = draft.assets.some((asset) => asset.kind === "local")
      ? draft.assets
      : [];
    const selectedFiles = Array.from(files).slice(
      0,
      Math.max(0, 8 - existingAssets.length),
    );
    const localAssets = await Promise.all(
      selectedFiles.map(
        (file) =>
          new Promise<CaptureAsset>((resolve) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              resolve({
                id: `local-${file.name}-${file.size}-${file.lastModified}`,
                kind: "local",
                label: file.name,
                channel: "所选截图",
                preview: typeof reader.result === "string" ? reader.result : "",
              });
            });
            reader.readAsDataURL(file);
          }),
      ),
    );

    setDraft((current) => {
      const base = current.assets.some((asset) => asset.kind === "local")
        ? current.assets
        : [];
      const mergedAssets = [...base, ...localAssets];
      const assets = mergedAssets
        .filter(
          (asset, index) =>
            mergedAssets.findIndex((candidate) => candidate.id === asset.id) ===
            index,
        )
        .slice(0, 8);
      return {
        ...current,
        assets,
        phase: "collect",
        selectedAssetId: assets.at(-1)?.id ?? null,
        speakerPerspective: null,
      };
    });
  };

  const moveSelectedAsset = (offset: -1 | 1) => {
    if (!selectedAsset) {
      return;
    }

    setDraft((current) => {
      const currentIndex = current.assets.findIndex(
        (asset) => asset.id === selectedAsset.id,
      );
      const nextIndex = currentIndex + offset;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= current.assets.length) {
        return current;
      }
      const assets = [...current.assets];
      [assets[currentIndex], assets[nextIndex]] = [
        assets[nextIndex],
        assets[currentIndex],
      ];
      return { ...current, assets };
    });
  };

  const removeSelectedAsset = () => {
    if (!selectedAsset) {
      return;
    }

    setDraft((current) => {
      const assets = current.assets.filter((asset) => asset.id !== selectedAsset.id);
      return {
        ...current,
        assets,
        selectedAssetId: assets[0]?.id ?? null,
        speakerPerspective: null,
      };
    });
  };

  const loadSyntheticExample = () => {
    setDraft((current) => ({
      ...current,
      assets: syntheticCaptureAssets,
      phase: "collect",
      selectedAssetId: syntheticCaptureAssets[0].id,
      speakerPerspective: null,
    }));
  };

  const cycleVoiceState = () => {
    setDraft((current) => ({
      ...current,
      voiceState:
        current.voiceState === "empty"
          ? "recording"
          : current.voiceState === "recording"
            ? "ready"
            : "empty",
    }));
  };

  return (
    <>
      <button
        aria-label="关闭快速添加"
        className={styles.captureScrim}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby="capture-title"
        aria-modal="true"
        className={styles.captureSheet}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClose();
            return;
          }

          if (event.key === "Tab") {
            const focusable = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
              ),
            ).filter((element) => element.offsetParent !== null);
            const first = focusable[0];
            const last = focusable.at(-1);

            if (!first || !last) {
              return;
            }

            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
        role="dialog"
      >
        <header>
          <div>
            <span>仅限草稿</span>
            <h2 id="capture-title">
              {draft.phase === "collect"
                ? "快速添加"
                : draft.phase === "review"
                  ? "审阅"
                  : "已保存待审"}
            </h2>
          </div>
          <button
            aria-label="关闭快速添加"
            onClick={onClose}
            ref={closeRef}
            type="button"
          >
            <X size={18} />
          </button>
        </header>

        <div className={styles.captureBody}>
          {draft.phase === "collect" ? (
            <>
              <div className={styles.captureContextScope}>
                <span>{contextSuggestion ? "建议关系" : "关系"}</span>
                <strong>{contextSuggestion?.name ?? "未分配"}</strong>
                {contextSuggestion ? (
                  <button onClick={onClearContext} type="button">
                    清除
                  </button>
                ) : (
                  <small>来源审阅后再选择。</small>
                )}
              </div>

              <div aria-label="添加背景" className={styles.captureInsertTray}>
                <button
                  aria-label={`添加截图，已选择 ${draft.assets.length}/8`}
                  aria-pressed={draft.assets.length > 0}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <span><Images size={20} weight="duotone" /></span>
                  <strong>图片</strong>
                  <small>{draft.assets.length > 0 ? `${draft.assets.length} / 8` : "最多添加 8 张"}</small>
                </button>
                <button
                  aria-label={
                    draft.voiceState === "empty"
                      ? "添加语音备注"
                      : draft.voiceState === "recording"
                        ? "停止语音备注预览"
                        : "移除已暂存语音备注"
                  }
                  aria-pressed={draft.voiceState !== "empty"}
                  onClick={cycleVoiceState}
                  type="button"
                >
                  <span>
                    {draft.voiceState === "recording" ? (
                      <Waveform size={20} weight="fill" />
                    ) : (
                      <Microphone size={20} />
                    )}
                  </span>
                  <strong>
                    {draft.voiceState === "empty"
                      ? "语音"
                      : draft.voiceState === "recording"
                        ? "停止"
                        : "语音已就绪"}
                  </strong>
                  <small>
                    {draft.voiceState === "recording" ? "预览状态" : "你的背景"}
                  </small>
                </button>
                <button
                  aria-label={noteOpen ? "隐藏文字备注" : "添加文字备注"}
                  aria-pressed={noteOpen || draft.note.trim().length > 0}
                  onClick={() => setNoteOpen((current) => !current)}
                  type="button"
                >
                  <span><TextT size={20} /></span>
                  <strong>文字</strong>
                  <small>{draft.note.trim() ? "已添加备注" : "添加备注"}</small>
                </button>
              </div>

              <input
                accept="image/jpeg,image/png,image/webp"
                aria-label="选择对话截图"
                className={styles.captureFileInput}
                multiple
                onChange={(event) => {
                  void addFiles(event.currentTarget.files);
                  event.currentTarget.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />

              {draft.assets.length > 0 ? (
                <section className={styles.captureSources} aria-label="已选截图">
                  <div className={styles.captureFilmstrip}>
                    {draft.assets.map((asset, index) => (
                      <button
                        aria-label={`来源 ${index + 1}，${asset.channel}`}
                        aria-pressed={selectedAsset?.id === asset.id}
                        className={
                          selectedAsset?.id === asset.id
                            ? styles.captureAssetSelected
                            : undefined
                        }
                        key={asset.id}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            selectedAssetId: asset.id,
                          }))
                        }
                        type="button"
                      >
                        <Image
                          alt=""
                          fill
                          sizes="64px"
                          src={asset.preview}
                          unoptimized={asset.kind === "local"}
                        />
                        <span>{index + 1}</span>
                      </button>
                    ))}
                    {draft.assets.length < 8 ? (
                      <button
                        aria-label="添加更多截图"
                        className={styles.captureAddTile}
                        onClick={() => fileInputRef.current?.click()}
                        type="button"
                      >
                        <Plus size={19} />
                        <span>添加</span>
                      </button>
                    ) : null}
                  </div>
                  {selectedAsset ? (
                    <div className={styles.captureAssetControl}>
                      <span>{selectedAsset.channel}</span>
                      <div>
                        <button
                          aria-label="将所选来源前移"
                          disabled={draft.assets[0]?.id === selectedAsset.id}
                          onClick={() => moveSelectedAsset(-1)}
                          type="button"
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <button
                          aria-label="将所选来源后移"
                          disabled={draft.assets.at(-1)?.id === selectedAsset.id}
                          onClick={() => moveSelectedAsset(1)}
                          type="button"
                        >
                          <ArrowRight size={16} />
                        </button>
                        <button
                          aria-label="移除所选来源"
                          onClick={removeSelectedAsset}
                          type="button"
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {noteOpen ? (
                <label className={styles.captureTextNote}>
                  <span>招聘顾问备注</span>
                  <textarea
                    autoFocus
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                    placeholder="哪些内容不应被遗漏？"
                    rows={2}
                    value={draft.note}
                  />
                </label>
              ) : null}

              {!canPrepare ? (
                <button
                  className={styles.captureSampleLink}
                  onClick={loadSyntheticExample}
                  type="button"
                >
                  使用示例集
                  <ArrowRight size={14} />
                </button>
              ) : null}

              <div className={styles.capturePrivacyNote}>
                <ShieldCheck size={15} weight="fill" />
                <p>背景与依据保持分离，此预览不会发送任何内容。</p>
              </div>
            </>
          ) : null}

          {draft.phase === "review" ? (
            <section className={styles.captureReview} aria-labelledby="capture-review-title">
              <span>
                {draft.assets.length > 0
                  ? `${draft.assets.length} 个来源`
                  : "仅招聘顾问背景"}
                {contextItemCount > 0 && draft.assets.length > 0
                  ? " / 背景分离"
                  : ""}
              </span>

              {resultKind === "organize" ? (
                <>
                  <StackSimple size={24} weight="duotone" />
                  <h3 id="capture-review-title">保持这些对话相互独立。</h3>
                  <p>任何内容变化前，每个来源都要单独进行身份审阅。</p>
                  <div className={styles.captureGroups}>
                    {draft.assets.map((asset, index) => (
                      <div key={asset.id}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{asset.channel}</strong>
                          <small>未分配</small>
                        </div>
                        <WarningCircle size={16} />
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              {resultKind === "identity" ? (
                <>
                  <WarningCircle size={24} weight="duotone" />
                  <h3 id="capture-review-title">这部手机属于谁？</h3>
                  <p>气泡左右可能颠倒说话人；只有确定时才选择。</p>
                  <blockquote>
                    “I have another offer. I need to decide by Wednesday.”
                  </blockquote>
                  <div className={styles.capturePerspective}>
                    {(
                      [
                        ["candidate", "候选人"],
                        ["recruiter", "招聘顾问"],
                        ["unknown", "保持未解决"],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        aria-pressed={draft.speakerPerspective === value}
                        key={value}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            speakerPerspective: value,
                          }))
                        }
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}

              {resultKind === "local" ? (
                <>
                  <ShieldCheck size={24} weight="duotone" />
                  <h3 id="capture-review-title">本地文件已暂存。</h3>
                  <p>
                    此公开预览不会上传或分析文件。正式审阅会核验顺序、说话人、身份与依据。
                  </p>
                </>
              ) : null}

              {resultKind === "note" ? (
                <>
                  <TextT size={24} weight="duotone" />
                  <h3 id="capture-review-title">你的备注始终是你的备注。</h3>
                  <p>它可以辅助审阅，但不能变成候选人的陈述。</p>
                  <blockquote>
                    {draft.note.trim() || "语音备注已可进行转写审阅。"}
                  </blockquote>
                </>
              ) : null}

              <div className={styles.captureReviewBoundary}>
                <ShieldCheck size={15} weight="fill" />
                <p>AI 可以整理，但身份、事实与行动仍需审阅。</p>
              </div>
            </section>
          ) : null}

          {draft.phase === "receipt" ? (
            <section className={styles.captureReceipt} aria-labelledby="capture-receipt-title">
              <ShieldCheck size={28} weight="fill" />
              <span>可审阅草稿</span>
              <h3 id="capture-receipt-title">已保存，未执行行动。</h3>
              <p>来源包会保留，供后续依据审阅。</p>
              <dl>
                <div>
                  <dt>项目</dt>
                  <dd>{itemCount}</dd>
                </div>
                <div>
                  <dt>已确认</dt>
                  <dd>0</dd>
                </div>
                <div>
                  <dt>外部操作</dt>
                  <dd>0</dd>
                </div>
              </dl>
              <div className={styles.captureReceiptNote}>
                <Check size={16} weight="bold" />
                <p>未更改消息、会议、联系人或 CRM 记录。</p>
              </div>
            </section>
          ) : null}
        </div>

        <footer className={styles.captureFooter}>
          {draft.phase === "collect" ? (
            <>
              <button
                className={styles.captureDeleteAction}
                onClick={canPrepare ? onDelete : onClose}
                type="button"
              >
                {canPrepare ? "放弃" : "关闭"}
              </button>
              <button
                className={styles.capturePrimaryAction}
                disabled={!canPrepare}
                onClick={() =>
                  setDraft((current) => ({ ...current, phase: "review" }))
                }
                type="button"
              >
                审阅{itemCount > 0 ? ` ${itemCount}` : ""}
                <ArrowRight size={16} />
              </button>
            </>
          ) : draft.phase === "review" ? (
            <>
              <button
                className={styles.captureDeleteAction}
                onClick={() =>
                  setDraft((current) => ({ ...current, phase: "collect" }))
                }
                type="button"
              >
                返回
              </button>
              <button
                className={styles.capturePrimaryAction}
                onClick={() =>
                  setDraft((current) => ({ ...current, phase: "receipt" }))
                }
                type="button"
              >
                保留草稿
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              <button className={styles.captureDeleteAction} onClick={onDelete} type="button">
                删除
              </button>
              <button className={styles.capturePrimaryAction} onClick={onClose} type="button">
                完成
                <Check size={16} weight="bold" />
              </button>
            </>
          )}
        </footer>
      </section>
    </>
  );
}

function GuideSheet({
  focusPerson,
  initialMode,
  onClose,
  onOpenPerson,
}: {
  focusPerson: Person | null;
  initialMode: AgentMode;
  onClose: () => void;
  onOpenPerson: (person: Person) => void;
}) {
  const answerPerson = focusPerson ?? people[0];
  const answerDetail = detailContent[answerPerson.id];
  const [mode, setMode] = useState<AgentMode>(initialMode);
  const [query, setQuery] = useState(
    initialMode === "answer" ? `${answerPerson.name} 发生了什么变化？` : "",
  );
  const [noteReviewed, setNoteReviewed] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const choose = (nextMode: AgentMode) => {
    setMode(nextMode);
    setNoteReviewed(false);
    if (nextMode === "find") {
      setQuery("谁拥有经过审阅的亚太产品领导力依据？");
    } else if (nextMode === "answer") {
      setQuery(`${answerPerson.name} 发生了什么变化？`);
    } else if (nextMode === "remember") {
      setQuery("Maya 下周二可以与创始人见面。");
    }
  };

  const continueFromInput = () => {
    const normalized = query.toLowerCase();
    if (normalized.includes("maya") || normalized.includes("remember")) {
      setMode("remember");
      return;
    }
    if (normalized.includes("leila") || normalized.includes("changed")) {
      setMode("answer");
      return;
    }
    setMode("find");
  };

  return (
    <section
      aria-labelledby="guide-title"
      aria-modal="true"
      className={styles.guideSheet}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
        }
      }}
      role="dialog"
    >
      <header>
        <div>
          <span>情境智能助理 / 仅限草稿权限</span>
          <h2 id="guide-title">智能助理</h2>
        </div>
        <button aria-label="关闭智能助理" onClick={onClose} ref={closeRef} type="button">
          <X size={20} />
        </button>
      </header>

      <div className={styles.guideBody}>
        <div className={styles.guidePrompt}>
          <Compass size={23} weight="duotone" />
          <textarea
            aria-label="查找、提问或记录"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="查找一段关系、询问变化，或记录一个时刻。"
            rows={3}
            value={query}
          />
          <button aria-label="改用语音记录" type="button">
            <Microphone size={19} />
          </button>
        </div>

        {mode === "home" ? (
          <>
            <p className={styles.guideLead}>
              一句话就够了。智能助理可以查找、解释或暂存备注，不会要求你先分类。
            </p>
            <div className={styles.guideJobs}>
              <button onClick={() => choose("find")} type="button">
                <MagnifyingGlass size={19} />
                <span>
                  <strong>查找一段关系</strong>
                  <small>匹配已审阅依据，而不是人物评分。</small>
                </span>
                <ArrowRight size={16} />
              </button>
              <button onClick={() => choose("answer")} type="button">
                <Question size={19} />
                <span>
                  <strong>询问发生了什么变化</strong>
                  <small>从一段受治理的关系中作答。</small>
                </span>
                <ArrowRight size={16} />
              </button>
              <button onClick={() => choose("remember")} type="button">
                <NotePencil size={19} />
                <span>
                  <strong>记录一个时刻</strong>
                  <small>解释前先保留你的原话。</small>
                </span>
                <ArrowRight size={16} />
              </button>
            </div>
            <button
              className={styles.guidePrimary}
              disabled={!query.trim()}
              onClick={continueFromInput}
              type="button"
            >
              继续
              <ArrowRight size={17} />
            </button>
          </>
        ) : null}

        {mode === "find" ? (
          <section className={styles.guideResult} aria-labelledby="find-title">
            <span>来自已确认依据的匹配 / 02</span>
            <h3 id="find-title">相关关系，而不是人物排名。</h3>
            <button onClick={() => onOpenPerson(people[0])} type="button">
              <Avatar person={people[0]} size="small" />
              <span>
                <strong>Leila Hartmann</strong>
                <small>一项已审阅来源确认了亚太范围。</small>
              </span>
              <CaretRight size={16} />
            </button>
            <button type="button">
              <Avatar person={people[2]} size="small" />
              <span>
                <strong>Maya Ortiz</strong>
                <small>具备区域运营经验，但项目背景不同。</small>
              </span>
              <CaretRight size={16} />
            </button>
            <p>
              结果按有依据支持的证据分组。智能助理不会预测质量或接受意愿。
            </p>
          </section>
        ) : null}

        {mode === "answer" ? (
          <section className={styles.guideResult} aria-labelledby="answer-title">
            <span>
              回答 / {answerPerson.name} / {answerPerson.relationship}
            </span>
            <h3 id="answer-title">
              {answerDetail.changeTitle}: {answerDetail.now}.
            </h3>
            <p>{answerDetail.conditionBody}</p>
            <blockquote>“{answerDetail.quote}”</blockquote>
            <small>{answerDetail.provenance}</small>
            <button
              className={styles.resultAction}
              onClick={() => onOpenPerson(answerPerson)}
              type="button"
            >
              打开 {answerPerson.name} 的关系页面
              <ArrowRight size={16} />
            </button>
          </section>
        ) : null}

        {mode === "remember" ? (
          <section className={styles.noteReview} aria-labelledby="remember-title">
            <span>用户撰写的时刻</span>
            <h3 id="remember-title">保留原话，暂存结构。</h3>
            <blockquote>{query}</blockquote>
            {!noteReviewed ? (
              <>
                <dl>
                  <div>
                    <dt>可能的人</dt>
                    <dd>Maya Ortiz</dd>
                  </div>
                  <div>
                    <dt>可能的背景</dt>
                    <dd>兼职首席财务官寻访</dd>
                  </div>
                  <div>
                    <dt>一个缺失的答案</dt>
                    <dd>哪个时区？</dd>
                  </div>
                </dl>
                <button
                  className={styles.guidePrimary}
                  onClick={() => setNoteReviewed(true)}
                  type="button"
                >
                  按草稿审阅
                  <ArrowRight size={17} />
                </button>
              </>
            ) : (
              <div className={styles.draftReceipt}>
                <ShieldCheck size={21} weight="fill" />
                <div>
                  <strong>草稿已保留。</strong>
                  <p>
                    关系状态未改变。确认时区后补充，再审阅依据附件。
                  </p>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>

      <footer>
        <ShieldCheck size={16} weight="fill" />
        读取所选关系；每项变化始终可供审阅。
      </footer>
    </section>
  );
}

function ConciergeScreen({
  onOpenGuide,
}: {
  onOpenGuide: (mode?: AgentMode) => void;
}) {
  return (
    <div className={`${styles.phoneScreen} ${styles.conciergeScreen}`}>
      <header className={styles.conciergeHeader}>
        <span>capri</span>
        <span>安静助理 / 05 段关系</span>
      </header>

      <div className={styles.conciergeBody}>
        <section className={styles.conciergeIntro}>
          <Compass size={27} weight="duotone" />
          <span>智能助理入口</span>
          <h1>你想推动什么？</h1>
          <p>
            从意图开始。只有在有助于回答问题时，档案才会出现。
          </p>
        </section>

        <button
          className={styles.conciergePrompt}
          onClick={() => onOpenGuide("home")}
          type="button"
        >
          <span>用一句话提问、查找或记录</span>
          <ArrowRight size={19} />
        </button>

        <section className={styles.conciergeJobs} aria-labelledby="concierge-jobs">
          <div className={styles.sectionIndex}>
            <span id="concierge-jobs">三项工作</span>
            <span>无需设置</span>
          </div>
          <button onClick={() => onOpenGuide("find")} type="button">
            <span>01</span>
            <strong>找到相关关系。</strong>
            <ArrowRight size={16} />
          </button>
          <button onClick={() => onOpenGuide("answer")} type="button">
            <span>02</span>
            <strong>理解发生了什么变化。</strong>
            <ArrowRight size={16} />
          </button>
          <button onClick={() => onOpenGuide("remember")} type="button">
            <span>03</span>
            <strong>记录一个时刻。</strong>
            <ArrowRight size={16} />
          </button>
        </section>

        <section className={styles.openRooms} aria-labelledby="open-rooms-title">
          <div className={styles.sectionIndex}>
            <span id="open-rooms-title">开放空间</span>
            <span>无需智能助理即可浏览</span>
          </div>
          <button type="button">
            <Briefcase size={17} />
            <span>
              <strong>首席产品官寻访</strong>
              <small>3 段关系进行中</small>
            </span>
            <CaretRight size={16} />
          </button>
          <button type="button">
            <UsersThree size={17} />
            <span>
              <strong>领导人才网络</strong>
              <small>身份审阅待处理</small>
            </span>
            <CaretRight size={16} />
          </button>
        </section>
      </div>

      <div className={styles.conciergeBoundary}>
        <ShieldCheck size={17} weight="fill" />
        每项变化都清晰显示人工责任归属。
      </div>
    </div>
  );
}

export function RelationshipMobileConcept({
  presentation = "study",
}: {
  presentation?: "product" | "study";
}) {
  const isProduct = presentation === "product";
  const [direction, setDirection] = useState<Direction>("archive");
  const [material, setMaterial] = useState<MaterialDirection>("museum");
  const [previewDark, setPreviewDark] = useState(false);
  const [archivePage, setArchivePage] = useState<ArchivePage>("today");
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [review, setReview] = useState<{
    kind: ReviewKind;
    person: Person;
  } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideMode, setGuideMode] = useState<AgentMode>("home");
  const [guidePerson, setGuidePerson] = useState<Person | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureContext, setCaptureContext] = useState<Person | null>(null);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft>(() =>
    createEmptyCaptureDraft(),
  );
  const captureTriggerRef = useRef<HTMLElement | null>(null);

  const openGuide = (mode: AgentMode = "home", person?: Person) => {
    setGuideMode(mode);
    setGuidePerson(person ?? null);
    setGuideOpen(true);
    setCaptureOpen(false);
  };

  const openCapture = (person?: Person) => {
    captureTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const hasDraft =
      captureDraft.assets.length > 0 ||
      captureDraft.note.trim().length > 0 ||
      captureDraft.voiceState !== "empty";
    if (!hasDraft) {
      setCaptureContext(person ?? null);
    }
    setCaptureOpen(true);
    setGuideOpen(false);
  };

  const closeCapture = () => {
    setCaptureOpen(false);
    window.requestAnimationFrame(() => {
      const previousTrigger = captureTriggerRef.current;
      if (previousTrigger?.isConnected) {
        previousTrigger.focus();
        return;
      }

      document
        .querySelector<HTMLElement>('[data-capture-launcher="true"]')
        ?.focus();
    });
  };

  const showPerson = (person: Person) => {
    setDirection("archive");
    setSelectedPerson(person);
    setReview(null);
    setGuideOpen(false);
    setCaptureOpen(false);
  };

  const openReview = (person: Person, kind: ReviewKind = "change") => {
    setDirection("archive");
    setSelectedPerson(null);
    setReview({ kind, person });
    setGuideOpen(false);
    setCaptureOpen(false);
  };

  return (
    <section
      className={`${styles.studyPage} ${isProduct ? styles.productPage : ""}`}
    >
      {!isProduct ? (
        <section className={styles.studyHeader} aria-labelledby="study-title">
        <div>
          <span>capri 移动端探索 / 第 04 版</span>
          <h1 id="study-title">先看依据，再做判断。</h1>
          <p>
            应用让招聘顾问回到一个明确的关系决定。人物始终是关系，而不是库存。
          </p>
        </div>
        <div aria-label="设计方向" className={styles.directionSwitch}>
          <button
            aria-pressed={direction === "archive"}
            className={direction === "archive" ? styles.directionActive : ""}
            onClick={() => {
              setDirection("archive");
              setSelectedPerson(null);
              setReview(null);
              setArchivePage("today");
            }}
            type="button"
          >
            <ListDashes size={18} />
            <span>
              编辑式今天
              <small>已选择</small>
            </span>
          </button>
          <button
            aria-pressed={direction === "concierge"}
            className={direction === "concierge" ? styles.directionActive : ""}
            onClick={() => {
              setDirection("concierge");
              setSelectedPerson(null);
              setReview(null);
            }}
            type="button"
          >
            <Compass size={18} />
            <span>
              智能助理入口
              <small>备选方向</small>
            </span>
          </button>
        </div>
        </section>
      ) : null}

      <section className={styles.studyStage}>
        <div className={styles.deviceColumn}>
          <div
            className={`${styles.device} ${
              material === "pebbles" ? styles.devicePebbles : ""
            } ${previewDark ? styles.deviceDark : ""}`}
          >
            <StatusBar />
            {direction === "concierge" ? (
              <ConciergeScreen onOpenGuide={openGuide} />
            ) : review ? (
              <ChangeReview
                kind={review.kind}
                onBack={() => setReview(null)}
                onOpenPerson={showPerson}
                person={review.person}
              />
            ) : selectedPerson ? (
              <PersonDetail
                captureCount={captureDraft.assets.length}
                onBack={() => setSelectedPerson(null)}
                onCapture={openCapture}
                onGuide={openGuide}
                person={selectedPerson}
              />
            ) : archivePage === "today" ? (
              <TodayArchive
                captureCount={captureDraft.assets.length}
                onCapture={() => openCapture()}
                onGuide={openGuide}
                onLibrary={() => setArchivePage("library")}
                onPeople={() => setArchivePage("people")}
                onResume={(person) => openReview(person, "resume")}
                onReview={(person) => openReview(person)}
              />
            ) : archivePage === "library" ? (
              <LibraryArchive
                captureCount={captureDraft.assets.length}
                onCapture={() => openCapture()}
                onGuide={openGuide}
                onPeople={() => setArchivePage("people")}
                onSelect={setSelectedPerson}
                onToday={() => setArchivePage("today")}
              />
            ) : (
              <PeopleArchive
                captureCount={captureDraft.assets.length}
                onCapture={() => openCapture()}
                onGuide={openGuide}
                onLibrary={() => setArchivePage("library")}
                onSelect={setSelectedPerson}
                onToday={() => setArchivePage("today")}
              />
            )}

            {guideOpen ? (
              <GuideSheet
                focusPerson={guidePerson}
                initialMode={guideMode}
                onClose={() => setGuideOpen(false)}
                onOpenPerson={showPerson}
              />
            ) : null}
            {captureOpen ? (
              <CaptureSheet
                contextSuggestion={captureContext}
                draft={captureDraft}
                onClearContext={() => setCaptureContext(null)}
                onClose={closeCapture}
                onDelete={() => {
                  setCaptureDraft(createEmptyCaptureDraft());
                  setCaptureContext(null);
                  closeCapture();
                }}
                setDraft={setCaptureDraft}
              />
            ) : null}
          </div>
        </div>

        <aside
          className={styles.decisionPanel}
          aria-label={
            isProduct
              ? "依据如何成为可审阅的关系变化"
              : "设计决定"
          }
        >
          {captureOpen ? (
            <>
              <span>一个有意组织的来源包</span>
              <h2>自由采集，只解决一件事。</h2>
              <p>
                截图保留来源，语音与文字保留招聘顾问的背景。AI 只选择最小且真实的审阅状态。
              </p>
              <section
                aria-label="可能的采集结果"
                className={styles.captureOutcomeMap}
              >
                <div>
                  <StackSimple size={19} />
                  <span>
                    <strong>需要整理</strong>
                    <small>多段对话保持分离。</small>
                  </span>
                </div>
                <div>
                  <WarningCircle size={19} />
                  <span>
                    <strong>需要一项澄清</strong>
                    <small>身份、说话人或时间仍未解决。</small>
                  </span>
                </div>
                <div>
                  <Check size={19} />
                  <span>
                    <strong>没有依据支持变化</strong>
                    <small>保留来源，但不制造额外工作。</small>
                  </span>
                </div>
              </section>
              <p className={styles.productInstruction}>
                可在手机中试用合成示例。采集可以关闭后继续，但此公开预览绝不会分析私密文件或写入其他系统。
              </p>
            </>
          ) : direction === "archive" ? (
            <>
              {isProduct ? (
                <>
                  <span>先看依据，再做解释</span>
                  <h2>一个来源，一项拟议变化，由你决定。</h2>
                  <p>
                    界面让你回到发生变化的准确关系，解释它为何值得关注，并让智能助理停留在决策边界之外。
                  </p>
                </>
              ) : (
                <>
                  <span>已选择原则</span>
                  <h2>编辑式红线</h2>
                  <p>
                    一个准确来源与一项拟议关系变化共享因果结构；智能助理停在入口处。
                  </p>
                  <div
                    aria-label="首屏构图"
                    className={styles.materialSwitch}
                  >
                    <button
                      aria-pressed={material === "museum"}
                      onClick={() => setMaterial("museum")}
                      type="button"
                    >
                      <span>开放页面</span>
                      <small>已选择 / 通过留白建立层级</small>
                    </button>
                    <button
                      aria-pressed={material === "pebbles"}
                      onClick={() => setMaterial("pebbles")}
                      type="button"
                    >
                      <span>浮动简报</span>
                      <small>备选 / 分组更清晰、界面装饰更多</small>
                    </button>
                  </div>
                </>
              )}

              <section className={styles.desktopReviewCard}>
                <span>为何出现在这里</span>
                <div className={styles.desktopQuote}>
                  <Quotes size={22} weight="fill" />
                  <blockquote>
                    &ldquo;I could do Singapore,
                    <br />
                    but not full-time relocation.&rdquo;
                  </blockquote>
                  <small>Leila / 周四 22:18 / 招聘顾问已审阅</small>
                </div>
                <span aria-hidden="true" className={styles.desktopCausalSeam}>
                  <i />
                </span>
                <div className={styles.desktopProposal}>
                  <span>拟议变化</span>
                  <h3>这项寻访中的远程办公问题仍未解决。</h3>
                  <div>
                    <button onClick={() => openReview(people[0])} type="button">
                      保持未解决
                    </button>
                    <button onClick={() => openReview(people[0])} type="button">
                      审阅变化
                    </button>
                  </div>
                </div>
              </section>

              <section className={styles.desktopResumeCard}>
                <span>带着背景继续</span>
                <h3>你上次停在审阅 Nia 的位置。</h3>
                <p>编辑已保存，未发送任何消息。</p>
                <div>
                  <span className={styles.libraryIcon}>
                    <NotePencil size={18} />
                  </span>
                  <span>
                    <strong>董事寻访</strong>
                    <small>第 2/3 项依据</small>
                  </span>
                </div>
                <button onClick={() => openReview(people[1], "resume")} type="button">
                  继续审阅
                  <ArrowRight size={17} />
                </button>
              </section>

              {!isProduct ? (
                <div aria-label="颜色预览" className={styles.colorModeSwitch}>
                  <span>预览</span>
                  <button
                    aria-pressed={!previewDark}
                    onClick={() => setPreviewDark(false)}
                    type="button"
                  >
                    浅色
                  </button>
                  <button
                    aria-pressed={previewDark}
                    onClick={() => setPreviewDark(true)}
                    type="button"
                  >
                    深色
                  </button>
                </div>
              ) : (
                <p className={styles.productInstruction}>
                  可在手机中试用“今天”“人才”和“资料库”。打开底部智能助理来查找、解释或暂存记忆。所有结果均使用合成依据，每项变化始终可审阅。
                </p>
              )}
            </>
          ) : (
            <>
              <span>保留的备选方向</span>
              <h2>智能助理入口</h2>
              <p>
                意图优先，档案按需出现。适合专注工作，但当招聘顾问想直接浏览人才而尚未形成问题时，效果较弱。
              </p>
              <dl>
                <div>
                  <dt>优势</dt>
                  <dd>可见输入最少，智能助理存在感最强。</dd>
                </div>
                <div>
                  <dt>代价</dt>
                  <dd>可浏览性与稳定空间记忆降低。</dd>
                </div>
                <div>
                  <dt>决定</dt>
                  <dd>将此构图用于智能助理展开状态。</dd>
                </div>
              </dl>
              <p className={styles.tryNote}>
                返回“编辑式今天”作为稳定首页。
              </p>
            </>
          )}
        </aside>
      </section>
    </section>
  );
}
