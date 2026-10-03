import { createRoot } from "react-dom/client";

import "./styles.css";

function QuickPanel() {
  return (
    <main className="quick-panel">
      <p className="eyebrow">Local quick panel</p>
      <h1>回到 capri 继续</h1>
      <p>此面板不显示人物、消息或证据内容，也不执行任何外部动作。</p>
      <small>此面板不声明 Session 仍有效；请回到主窗口查看最新核验状态。</small>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing quick-panel root");
createRoot(root).render(<QuickPanel />);
