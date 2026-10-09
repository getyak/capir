import type {
  RelationshipScope,
  ResourceCaptureResponse,
} from "@talent-signal/contracts";
import { ArrowRight, Prohibit } from "@phosphor-icons/react";

import type { GovernedCaptureDeletionReceipt } from "./governed-capture-deletion";
import { StartRelationshipPanel } from "./start-relationship-panel";

export function RelationshipOnboarding({
  deletionSummary,
  onCommitted,
  onScreenshot,
}: {
  deletionSummary: GovernedCaptureDeletionReceipt | null;
  onCommitted: (
    scope: RelationshipScope,
    receipts: ResourceCaptureResponse[],
    outcome:
      | "created_person"
      | "created_relationship_context"
      | "reused_relationship",
  ) => void;
  onScreenshot: () => void;
}) {
  return (
    <section className="context-onboarding">
      <header className="context-onboarding__header">
        <p className="eyebrow">关系智能</p>
        <h1>从来源开始。</h1>
        <p>
          先关联一个人与一段关系，再审阅来源能够、以及不能支持什么。
        </p>
      </header>
      <div className="context-onboarding__workbench">
        <StartRelationshipPanel
          onCommitted={onCommitted}
          onScreenshot={onScreenshot}
        />
        <aside
          aria-label="从背景资料到关系记录"
          className="context-onboarding__artifact"
        >
          <div>
            <span>01</span>
            <p>
              <strong>导入一个来源</strong>
              笔记、对话稿、文件、链接或截图
            </p>
          </div>
          <ArrowRight aria-hidden="true" size={19} />
          <div>
            <span>02</span>
            <p>
              <strong>关联情境</strong>
              人与关系始终明确
            </p>
          </div>
          <ArrowRight aria-hidden="true" size={19} />
          <div>
            <span>03</span>
            <p>
              <strong>整理关系记录</strong>
              随时核对来源，再决定下一步
            </p>
          </div>
        </aside>
      </div>
      {deletionSummary ? (
        <div className="context-deletion-receipt">
          <Prohibit aria-hidden="true" size={19} />
          <p>
            <strong>先前来源已删除</strong>
            已移除 {deletionSummary.derivatives} 项衍生数据 · 保留 {deletionSummary.lineage} 条审计安全的链路记录。
          </p>
        </div>
      ) : null}
    </section>
  );
}
