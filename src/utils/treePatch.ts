import type { UiNode, UiTree, UiTreePatch } from "../types/uiTree";

function nodeIndex(nodes: UiNode[], id: string): number {
  return nodes.findIndex((n) => n.id === id);
}

export function applyPatch(tree: UiTree, patch: UiTreePatch): UiTree {
  const nodes = [...tree.nodes];

  for (const id of patch.remove) {
    const idx = nodeIndex(nodes, id);
    if (idx >= 0) nodes.splice(idx, 1);
  }

  for (const node of patch.update) {
    const idx = nodeIndex(nodes, node.id);
    if (idx >= 0) nodes[idx] = node;
  }

  for (const node of patch.add) {
    const idx = nodeIndex(nodes, node.id);
    if (idx >= 0) nodes[idx] = node;
    else nodes.push(node);
  }

  return { ...tree, nodes };
}

export function treeFromFull(msg: UiTree): UiTree {
  return {
    type: "tree",
    w: msg.w,
    h: msg.h,
    pkg: msg.pkg,
    title: msg.title,
    popup: msg.popup,
    popupTitle: msg.popupTitle,
    nodes: msg.nodes.map((n) => ({ ...n })),
  };
}
