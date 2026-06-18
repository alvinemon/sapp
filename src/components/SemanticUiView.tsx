import type { UiNode, UiTree } from "../types/uiTree";
import { nodeCenter } from "../utils/coords";

interface Props {
  tree: UiTree;
  treeTick: number;
  onActivate: (x: number, y: number) => void;
}

function nodeArea(b: [number, number, number, number]) {
  return (b[2] - b[0]) * (b[3] - b[1]);
}

function boundsStyle(b: [number, number, number, number], w: number, h: number, z: number) {
  const [l, t, r, bt] = b;
  return {
    left: `${(l / w) * 100}%`,
    top: `${(t / h) * 100}%`,
    width: `${((r - l) / w) * 100}%`,
    height: `${((bt - t) / h) * 100}%`,
    zIndex: z,
  };
}

function appLabel(pkg?: string) {
  if (!pkg) return "phone";
  const parts = pkg.split(".");
  return parts[parts.length - 1] || pkg;
}

function displayLabel(node: UiNode) {
  if (node.t) return node.t;
  if (node.h) return node.h;
  if (node.c) return node.c;
  return "";
}

function renderNode(
  node: UiNode,
  tree: UiTree,
  z: number,
  screenArea: number,
  tapIndex: number | null,
  onActivate: (x: number, y: number) => void,
) {
  const { w, h } = tree;
  const [l, t, r, bt] = node.b;
  const width = r - l;
  const height = bt - t;
  if (width < 2 || height < 2) return null;

  const disabled = node.d === 1;
  const focused = node.f === 1;
  const interactive = !disabled && !!(node.k || node.e || node.s);
  const { x, y } = nodeCenter(node.b);
  const style = boundsStyle(node.b, w, h, z);
  const role = node.r ?? "view";
  const label = displayLabel(node);
  const area = nodeArea(node.b);

  const activate = (e: React.MouseEvent | React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onActivate(x, y);
  };

  const stateClass = [
    disabled ? "sem-disabled" : "",
    focused ? "sem-focused" : "",
  ].filter(Boolean).join(" ");

  if (role === "view" && area > screenArea * 0.025 && !interactive) {
    return <div key={node.id} className="sem-panel" style={style} />;
  }

  if (role === "btn" || (node.k && label.length > 0)) {
    return (
      <button
        key={node.id}
        type="button"
        className={`sem-btn sem-interactive ${stateClass}`}
        style={style}
        onClick={activate}
        title={node.h || label}
      >
        {tapIndex != null && <span className="sem-num">{tapIndex}</span>}
        <span className="sem-label-main">{label || "tap"}</span>
      </button>
    );
  }

  if (role === "input" || node.e) {
    const shown = node.t || node.h || "empty field";
    return (
      <button
        key={node.id}
        type="button"
        className={`sem-input sem-interactive ${stateClass}`}
        style={style}
        onClick={activate}
        title={node.h || shown}
      >
        {tapIndex != null && <span className="sem-num">{tapIndex}</span>}
        <span className="sem-label-main">{shown}</span>
        {node.h && node.t && <span className="sem-hint">hint: {node.h}</span>}
      </button>
    );
  }

  if (role === "check") {
    return (
      <button
        key={node.id}
        type="button"
        className={`sem-check sem-interactive ${stateClass}`}
        style={style}
        onClick={activate}
      >
        {tapIndex != null && <span className="sem-num">{tapIndex}</span>}
        <span>{node.x === 1 ? "☑" : "☐"}</span>
        {label && <span className="sem-label-main">{label}</span>}
      </button>
    );
  }

  if ((role === "scroll" || node.s) && interactive) {
    return (
      <button
        key={node.id}
        type="button"
        className={`sem-scroll sem-interactive ${stateClass}`}
        style={style}
        onClick={activate}
      >
        {tapIndex != null && <span className="sem-num">{tapIndex}</span>}
        <span className="sem-scroll-label">{label || "scroll area"}</span>
      </button>
    );
  }

  if (role === "img") {
    return (
      <div key={node.id} className={`sem-img ${stateClass}`} style={style} title={label}>
        {label ? `🖼 ${label}` : "🖼"}
      </div>
    );
  }

  if (role === "text" && label) {
    if (interactive) {
      return (
        <button
          key={node.id}
          type="button"
          className={`sem-text sem-interactive ${stateClass}`}
          style={style}
          onClick={activate}
        >
          {tapIndex != null && <span className="sem-num">{tapIndex}</span>}
          {label}
        </button>
      );
    }
    return (
      <div key={node.id} className="sem-label" style={style} title={node.c}>
        {label}
      </div>
    );
  }

  if (interactive && label) {
    return (
      <button
        key={node.id}
        type="button"
        className={`sem-view sem-interactive ${stateClass}`}
        style={style}
        onClick={activate}
      >
        {tapIndex != null && <span className="sem-num">{tapIndex}</span>}
        {label}
      </button>
    );
  }

  return null;
}

export function SemanticUiView({ tree, treeTick, onActivate }: Props) {
  const screenArea = tree.w * tree.h;
  const visible = tree.nodes
    .filter((n) => {
      const [l, t, r, b] = n.b;
      return r - l >= 2 && b - t >= 2;
    })
    .sort((a, b) => nodeArea(b.b) - nodeArea(a.b));

  const tapTargets = visible
    .filter((n) => n.d !== 1 && (n.k || n.e || n.s))
    .sort((a, b) => {
      const ay = a.b[1];
      const by = b.b[1];
      if (Math.abs(ay - by) > 40) return ay - by;
      return a.b[0] - b.b[0];
    });

  const tapIndexById = new Map<string, number>();
  tapTargets.forEach((n, i) => tapIndexById.set(n.id, i + 1));

  const tapCount = tapTargets.length;

  return (
    <div className="semantic-layer" data-tick={treeTick}>
      <div className="scene-chrome">
        <div className="scene-chrome-left">
          <span className="scene-app">{tree.title || appLabel(tree.pkg)}</span>
          {tree.pkg && tree.title && <span className="scene-pkg">{appLabel(tree.pkg)}</span>}
        </div>
        <span className="scene-meta">{tapCount} taps · {visible.length} nodes</span>
      </div>
      {tapCount > 0 && (
        <div className="scene-legend">
          <span className="legend-item legend-btn"># = tap target</span>
          <span className="legend-item legend-input">cyan = type here</span>
          <span className="legend-item legend-scroll">dashed = scroll</span>
        </div>
      )}
      {visible.length === 0 && <div className="semantic-empty">reading screen…</div>}
      {visible.map((node, i) =>
        renderNode(node, tree, i + 1, screenArea, tapIndexById.get(node.id) ?? null, onActivate),
      )}
    </div>
  );
}
