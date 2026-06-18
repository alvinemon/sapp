import type { UiNode, UiTree } from "../types/uiTree";
import { nodeCenter } from "../utils/coords";

export interface ScreenAction {
  num: number;
  label: string;
  instruction: string;
  x: number;
  y: number;
  kind: "tap" | "type" | "scroll" | "check";
  popup?: boolean;
}

export interface ScreenGuideModel {
  title: string;
  summary: string;
  popupTitle?: string;
  reading: string[];
  popupActions: ScreenAction[];
  actions: ScreenAction[];
}

function labelOf(n: UiNode) {
  return n.t || n.h || n.c || "";
}

function kindOf(n: UiNode): ScreenAction["kind"] {
  if (n.e) return "type";
  if (n.s) return "scroll";
  if (n.r === "check" || n.x != null) return "check";
  return "tap";
}

function instructionFor(n: UiNode, label: string): string {
  const kind = kindOf(n);
  if (kind === "type") return `Tap to focus this field${n.h ? ` (hint: ${n.h})` : ""}`;
  if (kind === "scroll") return `Scroll this area${label ? `: ${label}` : ""}`;
  if (kind === "check") return `Toggle ${label || "checkbox"}`;
  if (n.pop) return `Popup button — press "${label || "OK"}"`;
  return label ? `Press "${label}"` : "Tap this control";
}

function isActionable(n: UiNode) {
  return n.d !== 1 && (n.k || n.e || n.s);
}

export function buildScreenGuide(tree: UiTree): ScreenGuideModel {
  const nodes = tree.nodes.filter((n) => {
    const [l, t, r, b] = n.b;
    return r - l >= 2 && b - t >= 2;
  });

  const popupNodes = nodes.filter((n) => n.pop === 1);
  const hasPopup = tree.popup === 1 || popupNodes.length > 0;

  const actionable = nodes
    .filter(isActionable)
    .sort((a, b) => {
      if ((a.pop === 1) !== (b.pop === 1)) return (b.pop ?? 0) - (a.pop ?? 0);
      const ay = a.b[1];
      const by = b.b[1];
      if (Math.abs(ay - by) > 40) return ay - by;
      return a.b[0] - b.b[0];
    });

  const popupActions: ScreenAction[] = [];
  const mainActions: ScreenAction[] = [];
  let num = 0;

  for (const n of actionable) {
    const label = labelOf(n);
    if (!label && !n.e && !n.s) continue;
    num++;
    const { x, y } = nodeCenter(n.b);
    const action: ScreenAction = {
      num,
      label: label || (n.e ? "text field" : n.s ? "scroll" : "button"),
      instruction: instructionFor(n, label),
      x,
      y,
      kind: kindOf(n),
      popup: n.pop === 1,
    };
    if (n.pop === 1) popupActions.push(action);
    else mainActions.push(action);
  }

  const reading = nodes
    .filter((n) => !isActionable(n) && n.t && n.t.length >= 2 && n.pop !== 1)
    .map((n) => n.t!)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 12);

  const popupReading = popupNodes
    .filter((n) => n.t && !isActionable(n))
    .map((n) => n.t!)
    .filter((t, i, arr) => arr.indexOf(t) === i);

  let summary = "";
  if (hasPopup) {
    summary = `A popup is open${tree.popupTitle ? `: "${tree.popupTitle}"` : ""}. Handle popup actions first (orange), then main screen.`;
  } else if (mainActions.length === 0) {
    summary = "No buttons detected. Try swiping on the phone preview or use AI below.";
  } else {
    summary = `${mainActions.length} action${mainActions.length === 1 ? "" : "s"} available. Tap a row below or ask AI to do it.`;
  }

  return {
    title: hasPopup ? tree.popupTitle || "Popup open" : tree.title || tree.pkg?.split(".").pop() || "Phone screen",
    summary,
    popupTitle: tree.popupTitle,
    reading: hasPopup ? popupReading.concat(reading).slice(0, 10) : reading,
    popupActions,
    actions: mainActions,
  };
}

const MAX_AGENT_ACTIONS = 18;
const MAX_AGENT_CHARS = 1600;
const MAX_LABEL_LEN = 48;

export function compactTreeForAgent(tree: UiTree): string {
  const guide = buildScreenGuide(tree);
  const lines: string[] = [
    guide.title,
    guide.summary.slice(0, 120),
  ];
  const reading = guide.reading.slice(0, 6).map((t) => t.slice(0, 60));
  if (reading.length) lines.push("Text: " + reading.join(" | "));
  const actions = [...guide.popupActions, ...guide.actions].slice(0, MAX_AGENT_ACTIONS);
  for (const a of actions) {
    const label = a.label.slice(0, MAX_LABEL_LEN);
    lines.push(`#${a.num} ${label} (${Math.round(a.x)},${Math.round(a.y)})${a.popup ? " POPUP" : ""}`);
  }
  const out = lines.join("\n");
  return out.length > MAX_AGENT_CHARS ? out.slice(0, MAX_AGENT_CHARS) + "…" : out;
}
