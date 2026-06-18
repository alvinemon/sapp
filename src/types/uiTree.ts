export interface UiNode {
  id: string;
  p: number;
  b: [number, number, number, number];
  r?: string;
  t?: string;
  h?: string;
  c?: string;
  k?: number;
  e?: number;
  s?: number;
  x?: number;
  f?: number;
  d?: number;
  win?: number;
  pop?: number;
}

export interface UiTree {
  type: "tree";
  w: number;
  h: number;
  pkg?: string;
  title?: string;
  popup?: number;
  popupTitle?: string;
  nodes: UiNode[];
}

export interface UiTreePatch {
  type: "patch";
  seq: number;
  add: UiNode[];
  update: UiNode[];
  remove: string[];
}

export interface DeviceInfo {
  deviceId: string;
  name: string;
  model: string;
  online: boolean;
  width: number;
  height: number;
  lastSeen: number;
  ownerName?: string;
  ownerEmail?: string;
  ownerPhone?: string;
}
