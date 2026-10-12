import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function luminance(hex) {
  const channels = hex
    .match(/[0-9a-f]{2}/gi)
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4,
    );
  return (
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  );
}

function contrast(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function absoluteBounds(element) {
  if (element.type !== "arrow") {
    return {
      minX: element.x,
      minY: element.y,
      maxX: element.x + element.width,
      maxY: element.y + element.height,
    };
  }

  const points = element.points.map(([x, y]) => [
    element.x + x,
    element.y + y,
  ]);
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y)),
  };
}

async function pngDimensions(path) {
  const png = await readFile(path);
  const signature = png.subarray(0, 8).toString("hex");
  assert(
    signature === "89504e470d0a1a0a",
    `${path}: invalid PNG signature`,
  );
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

async function checkScene(config) {
  const excalidrawPath = resolve(root, config.excalidraw);
  const svgPath = resolve(root, config.svg);
  const pngPath = resolve(root, config.png);
  const document = JSON.parse(await readFile(excalidrawPath, "utf8"));

  assert(document.type === "excalidraw", `${config.name}: invalid document type`);
  assert(document.version === 2, `${config.name}: unexpected document version`);
  assert(document.elements.length >= config.minimumElements, `${config.name}: scene is incomplete`);

  const ids = new Set();
  const byId = new Map();
  for (const element of document.elements) {
    assert(!ids.has(element.id), `${config.name}: duplicate id ${element.id}`);
    ids.add(element.id);
    byId.set(element.id, element);
    assert(!element.isDeleted, `${config.name}: deleted element ${element.id}`);
  }

  const canvas = byId.get(config.canvasElement ?? `${config.prefix}-canvas-bg`);
  assert(canvas, `${config.name}: canvas background is missing`);
  const canvasBounds = absoluteBounds(canvas);

  for (const element of document.elements) {
    const bounds = absoluteBounds(element);
    assert(
      bounds.minX >= canvasBounds.minX &&
        bounds.minY >= canvasBounds.minY &&
        bounds.maxX <= canvasBounds.maxX &&
        bounds.maxY <= canvasBounds.maxY,
      `${config.name}: ${element.id} falls outside the canvas`,
    );
    if (element.type === "text") {
      assert(element.text.trim().length > 0, `${config.name}: blank text element`);
      assert(
        element.fontSize >= config.minimumFontSize,
        `${config.name}: ${element.id} is below the minimum font size`,
      );
    }
  }

  const combinedText = document.elements
    .filter((element) => element.type === "text")
    .map((element) => element.text)
    .join("\n");
  for (const phrase of config.requiredPhrases) {
    assert(
      combinedText.includes(phrase),
      `${config.name}: missing required phrase "${phrase}"`,
    );
  }

  for (const suffix of config.requiredElementSuffixes) {
    assert(
      [...ids].some((id) => id.endsWith(suffix)),
      `${config.name}: missing element *${suffix}`,
    );
  }

  for (const suffix of config.dashedElementSuffixes) {
    const element = [...byId.values()].find((candidate) =>
      candidate.id.endsWith(suffix),
    );
    assert(element, `${config.name}: missing future element *${suffix}`);
    assert(
      element.strokeStyle === "dashed",
      `${config.name}: future element *${suffix} must be dashed`,
    );
  }

  for (const forbiddenSuffix of config.forbiddenElementSuffixes ?? []) {
    assert(
      ![...ids].some((id) => id.endsWith(forbiddenSuffix)),
      `${config.name}: forbidden route *${forbiddenSuffix} is present`,
    );
  }

  for (const element of document.elements.filter(
    (candidate) => candidate.type === "text",
  )) {
    const baseId = element.id.endsWith("-title")
      ? element.id.slice(0, -"-title".length)
      : element.id.endsWith("-body")
        ? element.id.slice(0, -"-body".length)
        : element.id.endsWith("-text")
          ? element.id.slice(0, -"-text".length)
          : null;
    if (!baseId) continue;
    const background =
      byId.get(`${baseId}-box`) ??
      byId.get(baseId);
    if (
      !background ||
      background.backgroundColor === "transparent" ||
      !/^#[0-9a-f]{6}$/i.test(background.backgroundColor) ||
      !/^#[0-9a-f]{6}$/i.test(element.strokeColor)
    ) {
      continue;
    }
    assert(
      contrast(element.strokeColor, background.backgroundColor) >= 4.5,
      `${config.name}: ${element.id} has insufficient text contrast`,
    );
  }

  const svg = await readFile(svgPath, "utf8");
  for (const phrase of config.renderPhrases) {
    assert(svg.includes(phrase), `${config.name}: SVG lost "${phrase}"`);
  }

  const pngStat = await stat(pngPath);
  assert(pngStat.size > 100_000, `${config.name}: PNG is unexpectedly small`);
  const png = await pngDimensions(pngPath);
  const sceneRatio = canvas.width / canvas.height;
  const pngRatio = png.width / png.height;
  assert(
    Math.abs(sceneRatio - pngRatio) / sceneRatio < 0.035,
    `${config.name}: PNG aspect ratio suggests clipping or excess padding`,
  );

  return {
    name: config.name,
    elements: document.elements.length,
    texts: document.elements.filter((element) => element.type === "text")
      .length,
    solid: document.elements.filter(
      (element) => element.strokeStyle === "solid",
    ).length,
    dashed: document.elements.filter(
      (element) => element.strokeStyle === "dashed",
    ).length,
    png: `${png.width}x${png.height}`,
  };
}

const results = [];
results.push(
  await checkScene({
    name: "product architecture",
    prefix: "product",
    excalidraw: "docs/talent-signal-product-architecture.excalidraw",
    svg: "docs/talent-signal-product-architecture.svg",
    png: "docs/talent-signal-product-architecture.png",
    minimumElements: 75,
    minimumFontSize: 12,
    requiredPhrases: [
      "iOS",
      "Web",
      "Android",
      "Browser extension",
      "Agent draft",
      "Recruiter decision",
      "MEMORY / WHAT IS KNOWN",
      "WIKI / HOW IT READS",
      "never authorizes execution",
      "no candidate scoring",
    ],
    requiredElementSuffixes: [
      "flow-capture-agent",
      "flow-agent-review",
      "flow-review-memory",
      "flywheel-1",
      "flywheel-2",
      "flywheel-loop",
    ],
    dashedElementSuffixes: ["android-box", "extension-box"],
    renderPhrases: ["Talent Signal Product Architecture", "Recruiter decision"],
  }),
);
results.push(
  await checkScene({
    name: "system architecture",
    prefix: "system",
    excalidraw: "docs/talent-signal-system-architecture.excalidraw",
    svg: "docs/talent-signal-system-architecture.svg",
    png: "docs/talent-signal-system-architecture.png",
    minimumElements: 100,
    minimumFontSize: 12,
    requiredPhrases: [
      "iOS · SwiftUI",
      "Web · Next.js",
      "Android",
      "Browser Extension",
      "Evidence Compiler",
      "Context Resolver",
      "Action Planner",
      "Human Approval Checkpoint",
      "Execution Guard",
      "Connector Executor",
      "Canonical Memory",
      "Insight Synthesizer",
      "Wiki Compiler",
      "async projection",
      "no tool args",
      "ATS Adapter",
    ],
    requiredElementSuffixes: [
      "compiler-resolver",
      "resolver-planner",
      "planner-approval",
      "approval-guard",
      "guard-executor",
      "approval-to-memory",
      "executor-to-memory",
      "memory-to-canonical",
      "canonical-to-resolver",
      "canonical-to-insight",
      "canonical-to-wiki",
      "compiler-to-evidence",
      "wiki-to-store",
      "executor-to-writes",
    ],
    dashedElementSuffixes: [
      "android-box",
      "extension-box",
      "ats-adapter-box",
    ],
    forbiddenElementSuffixes: ["insight-to-wiki"],
    renderPhrases: ["Talent Signal System Architecture", "Human Approval Checkpoint"],
  }),
);
results.push(
  await checkScene({
    name: "Agent module blueprint",
    prefix: "agent-module",
    excalidraw: "docs/talent-signal-agent-module-blueprint.excalidraw",
    svg: "docs/talent-signal-agent-module-blueprint.svg",
    png: "docs/talent-signal-agent-module-blueprint.png",
    minimumElements: 110,
    minimumFontSize: 14,
    requiredPhrases: [
      "two runtimes, one authority boundary",
      "Governed continuity workflow",
      "Open-ended task runner",
      "Agent freedom ends here",
      "FACT CONFIRMATION",
      "ACTION APPROVAL",
      "DESTINATION VERIFICATION",
      "Canonical relationship state",
    ],
    requiredElementSuffixes: [
      "surface-intent",
      "workflow-proposal",
      "agent-proposal",
      "proposal-domain",
      "proposal-effects",
      "effects-outcomes",
      "outcomes-evaluation",
    ],
    dashedElementSuffixes: [
      "external-surfaces-box",
      "parallel-workers",
    ],
    renderPhrases: [
      "Talent Signal Agent module",
      "Agent freedom ends here",
    ],
  }),
);
results.push(
  await checkScene({
    name: "Agent control plane",
    prefix: "agent-control",
    canvasElement: "agent-control-background",
    excalidraw: "docs/talent-signal-agent-control-plane.excalidraw",
    svg: "docs/talent-signal-agent-control-plane.svg",
    png: "docs/talent-signal-agent-control-plane.png",
    minimumElements: 100,
    minimumFontSize: 14,
    requiredPhrases: [
      "Models propose. The control plane authorizes. Destinations prove effects.",
      "Capability Broker · the only effect boundary",
      "FACT CONFIRMATION",
      "ACTION APPROVAL",
      "DESTINATION VERIFICATION",
      "No surface owns canonical candidate state.",
      "identity · policy · context · lifecycle",
      "read/capture/propose only",
      "no direct domain writes",
    ],
    requiredElementSuffixes: [
      "surface-lane-box",
      "control-lane-box",
      "runtime-lane-box",
      "truth-lane-box",
      "gateway-box",
      "task-box",
      "context-box",
      "policy-box",
      "inbox-box",
      "boundary-box",
      "boundary-gate-a",
      "boundary-gate-b",
      "boundary-gate-c",
      "surfaces-gateway",
      "broker-connectors",
      "connector-observation",
      "postgres-projection",
    ],
    dashedElementSuffixes: [
      "browser-box",
      "wechat-box",
      "byoa-box",
      "byoa-gateway",
      "durable-agent-box",
      "external-agent-box",
      "durable-external",
    ],
    renderPhrases: [
      "Talent Signal agent control plane",
      "Capability Broker · the only effect boundary",
    ],
  }),
);
results.push(
  await checkScene({
    name: "Agent runtime flow",
    prefix: "agent-runtime",
    canvasElement: "agent-runtime-background",
    excalidraw: "docs/talent-signal-agent-runtime-flow.excalidraw",
    svg: "docs/talent-signal-agent-runtime-flow.svg",
    png: "docs/talent-signal-agent-runtime-flow.png",
    minimumElements: 80,
    minimumFontSize: 14,
    requiredPhrases: [
      "One episode: evidence → governed action → verified learning",
      "Nothing becomes candidate state before recruiter confirmation.",
      "A proposal is not permission. An API response is not proof.",
      "The Wiki is a projection; learning is proposed and reviewable.",
      "GATE 1 · CONFIRM",
      "GATE 2 · APPROVE",
      "GATE 3 · VERIFY",
      "Temporal relationship memory",
      "unknown effect → reconcile, never claim success.",
    ],
    requiredElementSuffixes: [
      "evidence-lane-box",
      "action-lane-box",
      "memory-lane-box",
      "fact-gate",
      "approval-gate",
      "verify-gate",
      "evidence-0",
      "evidence-4",
      "action-0",
      "action-4",
      "state-to-signal",
      "outcome-memory",
      "memory-wiki",
      "outcome-eval",
      "failure-box",
    ],
    dashedElementSuffixes: ["learning-box", "wiki-learning", "learning-eval"],
    renderPhrases: [
      "One episode: evidence → governed action → verified learning",
      "GATE 1 · CONFIRM",
    ],
  }),
);

for (const result of results) {
  console.log(
    `${result.name}: PASS · ${result.elements} elements · ${result.texts} texts · ${result.solid} solid · ${result.dashed} dashed · ${result.png}`,
  );
}
