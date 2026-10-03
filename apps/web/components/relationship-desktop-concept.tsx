"use client";

import {
  AddressBook,
  ArrowCounterClockwise,
  ArrowRight,
  Briefcase,
  CalendarBlank,
  CaretRight,
  Check,
  CheckCircle,
  Clock,
  Command,
  MagnifyingGlass,
  Microphone,
  NotePencil,
  Plus,
  Quotes,
  ShieldCheck,
  UsersThree,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";

import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import styles from "./relationship-desktop-concept.module.css";

type Surface = "today" | "people" | "searches";
type ReviewDecision = "dismissed" | "kept" | "proposed";

type Person = {
  action: string;
  avatar?: string;
  commitment: string;
  commitmentDue: string;
  company: string;
  context: string;
  dependency: string;
  due: string;
  evidence: string;
  id: string;
  initials: string;
  name: string;
  nextValue: string;
  owner: string;
  previousValue: string;
  provenance: string;
  protectedOutcome: string;
  recency: string;
  role: string;
  state: "changed" | "identity" | "quiet" | "review" | "waiting";
  waitingOn: string;
};

type Search = {
  action: string;
  client: string;
  commitment: string;
  commitmentDue: string;
  evidence: string;
  headline: string;
  id: string;
  name: string;
  note: string;
  participants: Array<{
    initials: string;
    name: string;
    position: string;
    role: string;
    state: string;
  }>;
  protectedOutcome: string;
  sourceA: string;
  sourceB: string;
};

const PEOPLE: Person[] = [
  {
    action: "向客户确认一个明确的远程办公政策问题。",
    avatar: "/concepts/relationships/avatars/leila.webp",
    commitment: "带回客户的明确答复",
    commitmentDue: "周五前完成",
    company: "独立候选人",
    context: "首席产品官寻访",
    dependency: "她的决定正等待客户的一项答复。",
    due: "今天",
    evidence: "I can make a final decision Friday. Remote from Singapore is the part I still need to understand.",
    id: "leila",
    initials: "LH",
    name: "Leila Hartmann",
    nextValue: "是否需要长期搬迁仍未解决",
    owner: "你",
    previousValue: "此前假设远程政策灵活",
    provenance: "WhatsApp 截图 / 周四 22:18 / 招聘顾问已审阅",
    protectedOutcome: "保护 Leila 的决策窗口",
    recency: "2 小时",
    role: "产品副总裁",
    state: "changed",
    waitingOn: "等待政策确认",
  },
  {
    action: "向 Nia 确认当前适用的出差频率。",
    avatar: "/concepts/relationships/avatars/nia.webp",
    commitment: "澄清出差信息冲突",
    commitmentDue: "今天完成",
    company: "人才网络关系",
    context: "董事寻访",
    dependency: "两个来源对出差限制的说法不一致。",
    due: "5 小时内",
    evidence: "Monthly travel is workable, but I would not want a weekly international cadence.",
    id: "nia",
    initials: "NW",
    name: "Nia Williams",
    nextValue: "可接受每月出差，不接受每周国际出差",
    owner: "你",
    previousValue: "仅按季度出差",
    provenance: "通话记录 / 周五 08:40 / 与 7 月 19 日邮件冲突",
    protectedOutcome: "避免向 Nia 重复提问",
    recency: "5 小时",
    role: "独立董事",
    state: "review",
    waitingOn: "等待一项当前答复",
  },
  {
    action: "安排会议前确认时区。",
    avatar: "/concepts/relationships/avatars/maya.webp",
    commitment: "带回已确认的时区",
    commitmentDue: "明天完成",
    company: "Northlight Capital",
    context: "兼职首席财务官寻访",
    dependency: "创始人会议已经可以安排。",
    due: "明天",
    evidence: "I can meet the founder next Tuesday if we settle the timezone.",
    id: "maya",
    initials: "MO",
    name: "Maya Ortiz",
    nextValue: "已提供周二时间，时区未解决",
    owner: "创始人",
    previousValue: "会议尚未安排",
    provenance: "招聘顾问备注 / 周四 17:20 / 草稿背景",
    protectedOutcome: "避免 Maya 遇到日程交接失败",
    recency: "1 天",
    role: "运营合伙人",
    state: "waiting",
    waitingOn: "等待时区确认",
  },
  {
    action: "等待董事会回复。",
    avatar: "/concepts/relationships/avatars/amir.webp",
    commitment: "等待董事会回复",
    commitmentDue: "无需提醒",
    company: "Rubicon Health",
    context: "首席技术官继任",
    dependency: "没有与决策相关的变化，不建议行动。",
    due: "无截止日期",
    evidence: "Let's hold here until the board has aligned on the mandate.",
    id: "amir",
    initials: "AO",
    name: "Amir Okafor",
    nextValue: "董事会回复前不采取行动",
    owner: "董事会",
    previousValue: "曾考虑跟进",
    provenance: "邮件 / 周日 14:05 / 招聘顾问已审阅",
    protectedOutcome: "避免过早跟进 Amir",
    recency: "4 天",
    role: "工程副总裁",
    state: "quiet",
    waitingOn: "职责要求变化前保持安静",
  },
  {
    action: "附加来源前先解决身份问题。",
    commitment: "暂不确认此来源归属",
    commitmentDue: "无截止日期",
    company: "独立候选人",
    context: "领导人才网络",
    dependency: "身份依据不足。",
    due: "无截止日期",
    evidence: "The card contains a name and title, but no current verified contact clue.",
    id: "zhang",
    initials: "伟",
    name: "张伟 / Wei Zhang-Sørensen",
    nextValue: "身份审阅未解决",
    owner: "你",
    previousValue: "仅为可能匹配",
    provenance: "导入的联系人名片 / 7 月 24 日 / 身份未解决",
    protectedOutcome: "避免将来源附到错误的人",
    recency: "2 周",
    role: "首席人力官",
    state: "identity",
    waitingOn: "等待身份依据",
  },
];

const SEARCHES: Search[] = [
  {
    action: "确认 Meridian Labs 可接受的办公地点政策。",
    client: "Meridian Labs",
    commitment: "带回客户答复",
    commitmentDue: "周五前完成",
    evidence: "The role brief says hybrid. The latest client call does not confirm whether Singapore-based remote work is acceptable.",
    headline: "一个缺失的答案正在决定当前节奏。",
    id: "cpo",
    name: "首席产品官",
    note: "Leila 周五做决定前，需要明确一位远程政策负责人。",
    participants: [
      {
        initials: "LH",
        name: "Leila Hartmann",
        position: "周五决定；远程政策未解决",
        role: "候选人",
        state: "当前依赖",
      },
      {
        initials: "AO",
        name: "Ana Oliveira",
        position: "负责提供可接受地点的答案",
        role: "首席执行官",
        state: "需要答复",
      },
      {
        initials: "JL",
        name: "Jordan Lee",
        position: "已准备传递这个明确问题",
        role: "牵头合伙人",
        state: "招聘顾问负责",
      },
    ],
    protectedOutcome: "保护 Leila 的决策窗口",
    sourceA: "职位简报 / 7 月 22 日",
    sourceB: "客户通话 / 8 月 6 日",
  },
  {
    action: "解决 Northlight 当前出差频率的矛盾。",
    client: "Northlight Capital",
    commitment: "解决出差信息冲突",
    commitmentDue: "董事会简报前完成",
    evidence: "The July email says quarterly travel. Nia's latest call says monthly travel is workable, but weekly international travel is not.",
    headline: "出差依据需要人工做出一次判断。",
    id: "board",
    name: "董事",
    note: "Nia 当前的出差限制与此前邮件冲突。",
    participants: [
      {
        initials: "NW",
        name: "Nia Williams",
        position: "可接受每月出差，不接受每周出差",
        role: "候选人",
        state: "需要审阅",
      },
      {
        initials: "PR",
        name: "Priya Raman",
        position: "负责董事会会议安排",
        role: "董事长",
        state: "等待中",
      },
    ],
    protectedOutcome: "避免向 Nia 提出可避免的重复问题",
    sourceA: "候选人邮件 / 7 月 19 日",
    sourceB: "通话记录 / 8 月 7 日",
  },
  {
    action: "Apex 创始人会议前确认时区。",
    client: "Apex Systems",
    commitment: "带回一个已确认的时区",
    commitmentDue: "安排会议前完成",
    evidence: "The candidate offered next Tuesday. Neither the calendar note nor the recruiter note records a timezone.",
    headline: "时间一经确认，即可开始下一次对话。",
    id: "staff-pm",
    name: "资深产品经理",
    note: "Maya 提供了周二的时间，但来源未注明时区。",
    participants: [
      {
        initials: "MO",
        name: "Maya Ortiz",
        position: "已提供周二时间；时区未解决",
        role: "候选人",
        state: "等待中",
      },
    ],
    protectedOutcome: "避免 Maya 遇到日程交接失败",
    sourceA: "候选人消息 / 8 月 6 日",
    sourceB: "招聘顾问备注 / 8 月 7 日",
  },
];

const STATE_LABELS: Record<Person["state"], string> = {
  changed: "有变化",
  identity: "身份审阅",
  quiet: "无需行动",
  review: "需要审阅",
  waiting: "等待中",
};

function Avatar({ person, size = "medium" }: { person: Person; size?: "large" | "medium" | "small" }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.avatar} ${styles[`avatar${size[0].toUpperCase()}${size.slice(1)}`]}`}
    >
      {person.avatar ? (
        <Image
          alt=""
          fill
          sizes={size === "large" ? "76px" : size === "small" ? "36px" : "48px"}
          src={person.avatar}
        />
      ) : (
        person.initials
      )}
    </span>
  );
}

function DeskNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={styles.railButton}
      data-active={active}
      onClick={onClick}
      type="button"
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

export function RelationshipDesktopConcept() {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [evidenceReturnFocusTarget, setEvidenceReturnFocusTarget] = useState<HTMLElement | null>(null);
  const [evidenceSession, setEvidenceSession] = useState(0);
  const [surface, setSurface] = useState<Surface>("today");
  const [selectedPersonId, setSelectedPersonId] = useState("leila");
  const [selectedSearchId, setSelectedSearchId] = useState("cpo");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision>("proposed");
  const [proposedValue, setProposedValue] = useState(PEOPLE[0].nextValue);
  const [actionStaged, setActionStaged] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const [commandText, setCommandText] = useState("");
  const [commandReceipt, setCommandReceipt] = useState("");

  const selectedPerson =
    PEOPLE.find((person) => person.id === selectedPersonId) ?? PEOPLE[0];
  const selectedSearch =
    SEARCHES.find((search) => search.id === selectedSearchId) ?? SEARCHES[0];
  const filteredPeople = useMemo(() => {
    const query = peopleQuery.trim().toLocaleLowerCase();
    if (!query) return PEOPLE;
    return PEOPLE.filter((person) =>
      [person.name, person.role, person.company, person.context]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [peopleQuery]);

  function chooseSurface(nextSurface: Surface) {
    setSurface(nextSurface);
    setEvidenceOpen(false);
    setCommandReceipt("");
    if (nextSurface === "searches") {
      const matchingSearchId =
        selectedPersonId === "nia"
          ? "board"
          : selectedPersonId === "maya"
            ? "staff-pm"
            : "cpo";
      setSelectedSearchId(matchingSearchId);
      const matchingPersonId =
        matchingSearchId === "board" ? "nia" : matchingSearchId === "staff-pm" ? "maya" : "leila";
      const matchingPerson = PEOPLE.find((person) => person.id === matchingPersonId) ?? PEOPLE[0];
      setSelectedPersonId(matchingPerson.id);
      setProposedValue(matchingPerson.nextValue);
      setReviewDecision("proposed");
      setActionStaged(false);
    }
  }

  function choosePerson(personId: string, nextSurface: Surface = "today") {
    const nextPerson = PEOPLE.find((person) => person.id === personId) ?? PEOPLE[0];
    setSelectedPersonId(personId);
    setProposedValue(nextPerson.nextValue);
    setSurface(nextSurface);
    setEvidenceOpen(false);
    setReviewDecision("proposed");
    setActionStaged(false);
    setCommandReceipt("");
  }

  function openEvidence() {
    setEvidenceReturnFocusTarget(
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    setEvidenceSession((current) => current + 1);
    setEvidenceOpen(true);
    setCommandReceipt("");
  }

  function chooseSearch(searchId: string) {
    const matchingPersonId =
      searchId === "board" ? "nia" : searchId === "staff-pm" ? "maya" : "leila";
    setSelectedSearchId(searchId);
    setSelectedPersonId(matchingPersonId);
    const matchingPerson = PEOPLE.find((person) => person.id === matchingPersonId) ?? PEOPLE[0];
    setProposedValue(matchingPerson.nextValue);
    setReviewDecision("proposed");
    setActionStaged(false);
    setEvidenceOpen(false);
    setCommandReceipt("");
  }

  function decideEvidence(decision: Exclude<ReviewDecision, "proposed">) {
    setReviewDecision(decision);
    setActionStaged(false);
    setEvidenceOpen(false);
    setCommandReceipt(
      decision === "kept"
        ? "未解决状态仍作为基于依据的提议保留，未批准任何行动。"
        : "提议及其依赖行动已撤回，来源依据仍可查看。",
    );
  }

  function stageAction() {
    setActionStaged(true);
    setCommandReceipt(
      "明确问题已暂存，等待单独的人工决定；未发送消息，也未安排日程。",
    );
  }

  function reviseEvidence(nextValue: string) {
    setProposedValue(nextValue);
    setReviewDecision("kept");
    setActionStaged(false);
    setEvidenceOpen(false);
    setCommandReceipt(
      "拟议关系状态已修订并保留待审，未批准任何行动。",
    );
  }

  function submitCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const objective = commandText.trim().toLocaleLowerCase();
    if (!objective) return;

    if (objective.includes("nia")) {
      choosePerson("nia");
      setCommandReceipt("已打开 Nia 当前的关系页面，未更改任何状态。");
    } else if (objective.includes("search")) {
      chooseSurface("searches");
      setCommandReceipt("已打开寻访项目，未更改任何关系状态。");
    } else {
      setCommandReceipt(
        "这里会编译一份关联来源的简报。此概念原型不保存提示词，也不授予行动权限。",
      );
    }
    setCommandText("");
  }

  return (
    <div className={styles.frame} ref={setPortalContainer}>
      <aside className={styles.iconRail}>
        <div className={styles.mark}>
          <BrandMark compact />
        </div>
        <nav aria-label="关系工作台">
          <DeskNavButton
            active={surface === "today"}
            icon={<CalendarBlank aria-hidden="true" size={21} weight="duotone" />}
            label="今天"
            onClick={() => chooseSurface("today")}
          />
          <DeskNavButton
            active={surface === "people"}
            icon={<UsersThree aria-hidden="true" size={21} weight="duotone" />}
            label="人才"
            onClick={() => chooseSurface("people")}
          />
          <DeskNavButton
            active={surface === "searches"}
            icon={<Briefcase aria-hidden="true" size={21} weight="duotone" />}
            label="寻访"
            onClick={() => chooseSurface("searches")}
          />
        </nav>
        <div className={styles.railUtilities}>
          <button
            aria-label="记录关系时刻"
            onClick={() =>
              setCommandReceipt(
                "采集将打开由设备控制的来源审阅。此概念原型不会请求屏幕或消息访问权限。",
              )
            }
            title="记录关系时刻"
            type="button"
          >
            <Plus aria-hidden="true" size={21} />
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <aside className={styles.contextRail}>
        <div className={styles.contextHeader}>
          <span className={styles.productName}>capri</span>
          <strong>{surface === "today" ? "今天" : surface === "people" ? "人才" : "寻访"}</strong>
        </div>

        <nav aria-label="工作区主要视图" className={styles.contextNav}>
          <button data-active={surface === "today"} onClick={() => chooseSurface("today")} type="button">
            <CalendarBlank aria-hidden="true" size={17} />
            今天
            <span>3</span>
          </button>
          <button data-active={surface === "people"} onClick={() => chooseSurface("people")} type="button">
            <AddressBook aria-hidden="true" size={17} />
            人才
          </button>
          <button data-active={surface === "searches"} onClick={() => chooseSurface("searches")} type="button">
            <Briefcase aria-hidden="true" size={17} />
            寻访
          </button>
        </nav>

        <section className={styles.recent} aria-labelledby="recent-title">
          <div className={styles.sectionLabel} id="recent-title">
            {surface === "searches" ? "进行中的寻访" : "最近关系"}
          </div>
          {surface === "searches"
            ? SEARCHES.map((search) => (
                <button
                  data-active={selectedSearchId === search.id}
                  key={search.id}
                  onClick={() => chooseSearch(search.id)}
                  type="button"
                >
                  <span>
                    <strong>{search.client}</strong>
                    <small>{search.name}</small>
                  </span>
                  <CaretRight aria-hidden="true" size={14} />
                </button>
              ))
            : PEOPLE.slice(0, 4).map((person) => (
                <button
                  data-active={selectedPerson.id === person.id}
                  key={person.id}
                  onClick={() => choosePerson(person.id)}
                  type="button"
                >
                  <span>
                    <strong>{person.context.replace("Chief Product Officer", "CPO")}</strong>
                    <small>{person.name}</small>
                  </span>
                  <CaretRight aria-hidden="true" size={14} />
                </button>
              ))}
        </section>

        <div className={styles.privacyNote}>
          <ShieldCheck aria-hidden="true" size={16} weight="duotone" />
          <span>
            <strong>合成产品视图</strong>
            不会保存任何候选人数据。
          </span>
        </div>
      </aside>

      <main className={styles.main} id="relationship-desk-main">
        {surface === "today" ? (
          <TodaySurface
            actionStaged={actionStaged}
            onOpenEvidence={openEvidence}
            onSelectPerson={(personId) => choosePerson(personId)}
            person={selectedPerson}
            proposedValue={proposedValue}
            reviewDecision={reviewDecision}
          />
        ) : null}
        {surface === "people" ? (
          <PeopleSurface
            filteredPeople={filteredPeople}
            onOpenEvidence={openEvidence}
            onQueryChange={setPeopleQuery}
            onSelectPerson={(personId) => choosePerson(personId, "people")}
            person={selectedPerson}
            proposedValue={proposedValue}
            query={peopleQuery}
            reviewDecision={reviewDecision}
          />
        ) : null}
        {surface === "searches" ? (
          <SearchesSurface
            onSelectSearch={chooseSearch}
            search={selectedSearch}
            selectedSearchId={selectedSearchId}
          />
        ) : null}

        <form className={styles.composer} onSubmit={submitCommand}>
          <Command aria-hidden="true" size={18} />
          <label>
            <span className="sr-only">查找、提问或记录</span>
            <input
              onChange={(event) => setCommandText(event.target.value)}
              placeholder="查找、提问或记录……"
              value={commandText}
            />
          </label>
          <button aria-label="提交关系问题" disabled={!commandText.trim()} type="submit">
            <ArrowRight aria-hidden="true" size={17} />
          </button>
          <button
            aria-label="开始语音采集"
            className={styles.voiceButton}
            onClick={() =>
              setCommandReceipt(
                "语音采集需要明确的麦克风权限；此概念原型未开始录音。",
              )
            }
            type="button"
          >
            <Microphone aria-hidden="true" size={18} weight="duotone" />
          </button>
        </form>

        {commandReceipt ? (
          <div className={styles.commandReceipt} role="status">
            <CheckCircle aria-hidden="true" size={16} weight="fill" />
            {commandReceipt}
          </div>
        ) : null}
      </main>

      <ConsequenceRail
        actionStaged={actionStaged}
        onOpenEvidence={openEvidence}
        onReset={() => {
          setProposedValue(selectedPerson.nextValue);
          setReviewDecision("proposed");
          setActionStaged(false);
          setCommandReceipt("合成审阅状态已重置。");
        }}
        onStageAction={stageAction}
        person={selectedPerson}
        reviewDecision={reviewDecision}
        search={selectedSearch}
        surface={surface}
      />

      <DialogPrimitive.Root onOpenChange={setEvidenceOpen} open={evidenceOpen}>
        <EvidenceDrawer
          container={portalContainer}
          key={evidenceSession}
          onDecision={decideEvidence}
          onRevision={reviseEvidence}
          person={selectedPerson}
          proposedValue={proposedValue}
          returnFocusTarget={evidenceReturnFocusTarget}
          reviewDecision={reviewDecision}
        />
      </DialogPrimitive.Root>
    </div>
  );
}

function TodaySurface({
  actionStaged,
  onOpenEvidence,
  onSelectPerson,
  person,
  proposedValue,
  reviewDecision,
}: {
  actionStaged: boolean;
  onOpenEvidence: () => void;
  onSelectPerson: (personId: string) => void;
  person: Person;
  proposedValue: string;
  reviewDecision: ReviewDecision;
}) {
  const quiet = person.state === "quiet";
  const retracted = reviewDecision === "dismissed";
  return (
    <div className={styles.surface} data-surface="today">
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.dateLabel}>8 月 7 日，星期五</span>
          <h3>今天</h3>
          <p>有三段关系具备充分依据，值得现在查看。</p>
        </div>
        <span className={styles.reviewWindow}>
          <Clock aria-hidden="true" size={15} />
          12 分钟审阅窗口
        </span>
      </header>

      <section className={styles.focusBrief} aria-labelledby="today-focus-title">
        <div className={styles.focusCopy}>
          <span className={styles.sectionLabel}>
            {quiet ? "有意保持安静" : `${person.due} / ${person.context}`}
          </span>
          <h4 id="today-focus-title">
            {retracted ? "这项变化不再需要行动。" : person.dependency}
          </h4>
          <p>
            {quiet
              ? "这段关系正在等待董事会。再次提醒只会增加压力，并不能减少不确定性。"
              : retracted
                ? "提议已驳回，其依赖行动已移除，原始来源仍可审阅。"
                : `${proposedValue}。审阅前，当前关系页面不会改变。`}
          </p>
          <button onClick={onOpenEvidence} type="button">
            {retracted ? "查看已驳回的依据" : "审阅这段关系"}
            <ArrowRight aria-hidden="true" size={17} />
          </button>
        </div>

        <div className={styles.causalSeam} data-state={reviewDecision}>
          <span className={styles.sectionLabel}>原始依据</span>
          <blockquote>“{person.evidence}”</blockquote>
          <dl>
            <div>
              <dt>负责人</dt>
              <dd>{person.owner}</dd>
            </div>
            <div>
              <dt>截止时间</dt>
              <dd>{person.due}</dd>
            </div>
          </dl>
          {actionStaged ? (
            <span className={styles.inlineReceipt}>
              <CheckCircle aria-hidden="true" size={14} weight="fill" />
              仅已暂存草稿
            </span>
          ) : null}
        </div>
      </section>

      <section className={styles.motionQueue} aria-labelledby="motion-title">
        <div className={styles.sectionLabel} id="motion-title">其他进行中事项</div>
        {PEOPLE.filter((item) => item.id !== person.id && item.state !== "quiet").slice(0, 2).map((item) => (
          <button key={item.id} onClick={() => onSelectPerson(item.id)} type="button">
            <Avatar person={item} size="small" />
            <span>
              <strong>{item.name}</strong>
              <small>{item.dependency}</small>
            </span>
            <em data-state={item.state}>{STATE_LABELS[item.state]}</em>
            <span className={styles.recency}>{item.recency}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

function PeopleSurface({
  filteredPeople,
  onOpenEvidence,
  onQueryChange,
  onSelectPerson,
  person,
  proposedValue,
  query,
  reviewDecision,
}: {
  filteredPeople: Person[];
  onOpenEvidence: () => void;
  onQueryChange: (query: string) => void;
  onSelectPerson: (personId: string) => void;
  person: Person;
  proposedValue: string;
  query: string;
  reviewDecision: ReviewDecision;
}) {
  return (
    <div className={styles.surface} data-surface="people">
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.dateLabel}>关系资料库</span>
          <h3>人才</h3>
          <p>一个身份，每段关系背景都保持独立。</p>
        </div>
        <label className={styles.peopleSearch}>
          <MagnifyingGlass aria-hidden="true" size={17} />
          <span className="sr-only">查找人才或关系</span>
          <input
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="查找人才或关系"
            value={query}
          />
        </label>
      </header>

      <div className={styles.peopleGrid}>
        <section className={styles.peopleList} aria-label="合成关系资料库中的人才">
          {filteredPeople.length > 0 ? (
            filteredPeople.map((item) => (
              <button
                aria-current={item.id === person.id ? "page" : undefined}
                data-active={item.id === person.id}
                key={item.id}
                onClick={() => onSelectPerson(item.id)}
                type="button"
              >
                <Avatar person={item} />
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.role} / {item.context}</small>
                  <em>{item.dependency}</em>
                </span>
                <span className={styles.personState}>{STATE_LABELS[item.state]}</span>
              </button>
            ))
          ) : (
            <div className={styles.emptyState}>
              <MagnifyingGlass aria-hidden="true" size={22} />
              <strong>未找到有依据支持的关系。</strong>
              <p>可尝试输入姓名、职位、公司或项目。</p>
            </div>
          )}
        </section>

        <article className={styles.livingPage}>
          <header>
            <Avatar person={person} size="large" />
            <div>
              <span className={styles.sectionLabel}>持续更新的关系页面</span>
              <h4 data-long={person.name.length > 22}>{person.name}</h4>
              <p>{person.role} · {person.company}</p>
            </div>
          </header>
          <section>
            <span className={styles.sectionLabel}>当前依赖</span>
            <h5>{person.dependency}</h5>
            <p>{proposedValue}。</p>
          </section>
          <dl>
            <div>
              <dt>关系</dt>
              <dd>{person.context}</dd>
            </div>
            <div>
              <dt>依据状态</dt>
              <dd>{reviewDecision === "dismissed" ? "已驳回，来源保留" : "已提议，来源已附加"}</dd>
            </div>
          </dl>
          <button onClick={onOpenEvidence} type="button">
            <Quotes aria-hidden="true" size={16} />
            查看准确依据
          </button>
        </article>
      </div>
    </div>
  );
}

function SearchesSurface({
  onSelectSearch,
  search,
  selectedSearchId,
}: {
  onSelectSearch: (searchId: string) => void;
  search: Search;
  selectedSearchId: string;
}) {
  return (
    <div className={styles.surface} data-surface="searches">
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.dateLabel}>项目空间</span>
          <h3>{search.client}</h3>
          <p>{search.name} · 8 月 14 日决策审阅</p>
        </div>
        <div className={styles.searchTabs} role="tablist" aria-label="合成寻访项目">
          {SEARCHES.map((item) => (
            <button
              aria-selected={selectedSearchId === item.id}
              key={item.id}
              onClick={() => onSelectSearch(item.id)}
              role="tab"
              type="button"
            >
              {item.client}
            </button>
          ))}
        </div>
      </header>

      <section className={styles.searchNarrative}>
        <h4>{search.headline}</h4>
        <p>{search.note}</p>
      </section>

      <section className={styles.participantSection} aria-labelledby="participants-title">
        <div className={styles.sectionLabel} id="participants-title">影响下一步决定的人</div>
        <div className={styles.participantList}>
          {search.participants.map((participant) => (
            <article key={participant.name}>
              <span aria-hidden="true">{participant.initials}</span>
              <div>
                <strong>{participant.name}</strong>
                <small>{participant.role}</small>
              </div>
              <p>{participant.position}</p>
              <em>{participant.state}</em>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.disagreement}>
        <WarningCircle aria-hidden="true" size={19} weight="duotone" />
        <div>
          <span className={styles.sectionLabel}>待解决的依据</span>
          <p>{search.evidence}</p>
          <small>{search.sourceA} <span /> {search.sourceB}</small>
        </div>
      </section>
    </div>
  );
}

function ConsequenceRail({
  actionStaged,
  onOpenEvidence,
  onReset,
  onStageAction,
  person,
  reviewDecision,
  search,
  surface,
}: {
  actionStaged: boolean;
  onOpenEvidence: () => void;
  onReset: () => void;
  onStageAction: () => void;
  person: Person;
  reviewDecision: ReviewDecision;
  search: Search;
  surface: Surface;
}) {
  const quiet = person.state === "quiet";
  const identityBlocked = person.state === "identity";
  const noAction = quiet || identityBlocked;
  const dismissed = reviewDecision === "dismissed";
  const action = surface === "searches"
    ? search.action
    : person.action;

  return (
    <aside className={styles.consequenceRail} aria-label="当前影响与下一步">
      <div>
        <span className={styles.sectionLabel}>
          {noAction || dismissed ? "没有依据支持行动" : "有依据支持的最小步骤"}
        </span>
        <h3>
          {dismissed
            ? "依赖行动已撤回。"
            : identityBlocked
              ? "附加此来源前先解决身份问题。"
              : quiet
              ? "等待新的、与决策相关的依据。"
              : action}
        </h3>
        <p>
          {dismissed
            ? "来源仍可查看，但不再支持关系状态提议。"
            : identityBlocked
              ? "未预选任何人。当前依据无法支持匹配时，请保存为未解决。"
              : quiet
              ? "保持安静是一种有意的结果，不会创建提醒。"
              : "这是所选关系上的草稿，不会发送消息或安排日程。"}
        </p>
      </div>

      <dl className={styles.actionMeta}>
        <div>
          <dt>负责人</dt>
          <dd>{surface === "searches" ? "你" : person.owner}</dd>
        </div>
        <div>
          <dt>截止时间</dt>
          <dd>{surface === "searches" ? "周五前" : person.due}</dd>
        </div>
        <div>
          <dt>完成条件</dt>
          <dd>{noAction || dismissed ? "出现新依据" : "记录明确答复"}</dd>
        </div>
      </dl>

      <div className={styles.actionControls}>
        <button className={styles.secondaryButton} onClick={onOpenEvidence} type="button">
          <Quotes aria-hidden="true" size={16} />
          审阅依据
        </button>
        {!noAction && !dismissed ? (
          <button
            className={styles.primaryButton}
            disabled={reviewDecision !== "kept" || actionStaged}
            onClick={onStageAction}
            type="button"
          >
            {actionStaged ? (
              <Check aria-hidden="true" size={17} />
            ) : (
              <NotePencil aria-hidden="true" size={17} />
            )}
            {actionStaged ? "问题已暂存" : "暂存明确问题"}
          </button>
        ) : null}
        {reviewDecision !== "proposed" || actionStaged ? (
          <button className={styles.textButton} onClick={onReset} type="button">
            <ArrowCounterClockwise aria-hidden="true" size={15} />
            重置合成审阅
          </button>
        ) : null}
      </div>

      <section className={styles.promiseSection}>
        <span className={styles.sectionLabel}>承诺事项</span>
        <div>
          <CheckCircle aria-hidden="true" size={17} />
          <p>
            <strong>{surface === "searches" ? search.commitment : person.commitment}</strong>
            <small>{surface === "searches" ? search.commitmentDue : person.commitmentDue}</small>
          </p>
        </div>
        <div data-muted="true">
          <Clock aria-hidden="true" size={17} />
          <p>
            <strong>{surface === "searches" ? search.protectedOutcome : person.protectedOutcome}</strong>
            <small>{surface === "searches" ? "等待一项已确认的依赖" : person.waitingOn}</small>
          </p>
        </div>
      </section>

      <div className={styles.authorityNote}>
        <ShieldCheck aria-hidden="true" size={17} weight="duotone" />
        <p>
          <strong>仅限草稿权限</strong>
          事实审阅与行动批准始终是两次独立决定。
        </p>
      </div>
    </aside>
  );
}

function EvidenceDrawer({
  container,
  onDecision,
  onRevision,
  person,
  proposedValue,
  returnFocusTarget,
  reviewDecision,
}: {
  container: HTMLDivElement | null;
  onDecision: (decision: Exclude<ReviewDecision, "proposed">) => void;
  onRevision: (nextValue: string) => void;
  person: Person;
  proposedValue: string;
  returnFocusTarget: HTMLElement | null;
  reviewDecision: ReviewDecision;
}) {
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(proposedValue);

  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay className={styles.drawerBackdrop} />
      <DialogPrimitive.Content
        aria-describedby="desktop-evidence-boundary"
        className={styles.evidenceDrawer}
        id="desktop-evidence-review"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTarget?.focus();
        }}
      >
        <header>
          <div>
            <span className={styles.sectionLabel}>先看依据，再做解释</span>
            <DialogPrimitive.Title asChild>
              <h3>审阅一项拟议变化。</h3>
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Close asChild>
            <button aria-label={`关闭 ${person.name} 的依据审阅`} type="button">
              <X aria-hidden="true" size={19} />
            </button>
          </DialogPrimitive.Close>
        </header>

        <section className={styles.drawerIdentity}>
          <Avatar person={person} />
          <div>
            <strong>{person.name}</strong>
            <span>{person.context}</span>
          </div>
        </section>

        <section className={styles.drawerEvidence}>
          <span className={styles.sectionLabel}>观察到的来源</span>
          <Quotes aria-hidden="true" size={21} weight="duotone" />
          <blockquote>“{person.evidence}”</blockquote>
          <p>{person.provenance}</p>
        </section>

        <section className={styles.stateDiff}>
          <span className={styles.sectionLabel}>拟议关系状态</span>
          <dl>
            <div>
              <dt>之前</dt>
              <dd>{person.previousValue}</dd>
            </div>
            <ArrowRight aria-hidden="true" size={18} />
            <div>
              <dt>拟议</dt>
              <dd>
                {editing ? (
                  <label className={styles.revisionControl}>
                    <span>修订后的表述</span>
                    <textarea
                      autoFocus
                      onChange={(event) => setDraftValue(event.target.value)}
                      rows={3}
                      value={draftValue}
                    />
                  </label>
                ) : (
                  proposedValue
                )}
              </dd>
              <button
                className={styles.revisionButton}
                onClick={() => {
                  if (editing) setDraftValue(proposedValue);
                  setEditing((current) => !current);
                }}
                type="button"
              >
                <NotePencil aria-hidden="true" size={14} />
                {editing ? "取消修订" : "修订表述"}
              </button>
            </div>
          </dl>
        </section>

        <div className={styles.drawerBoundary}>
          <ShieldCheck aria-hidden="true" size={18} weight="duotone" />
          <DialogPrimitive.Description asChild>
            <p id="desktop-evidence-boundary">
              保留这项提议不会批准下一步行动；驳回它会撤回依赖该提议的草稿。
            </p>
          </DialogPrimitive.Description>
        </div>

        <footer>
          <button className={styles.secondaryButton} onClick={() => onDecision("dismissed")} type="button">
            <X aria-hidden="true" size={16} />
            驳回提议
          </button>
          <button
            className={styles.primaryButton}
            disabled={editing && !draftValue.trim()}
            onClick={() => editing ? onRevision(draftValue.trim()) : onDecision("kept")}
            type="button"
          >
            <Check aria-hidden="true" size={17} />
            {editing
              ? "保存修订"
              : reviewDecision === "kept"
                ? "保留为未解决"
                : "按未解决保留"}
          </button>
        </footer>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
