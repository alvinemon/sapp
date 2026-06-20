import { authBody, authParams } from "./marketing";

export interface SegmentRules {
  areas?: string[];
  tags?: string[];
  minActivity?: number;
  onlineOnly?: boolean;
  apps?: string[];
  keywordMatch?: string;
  lastSeenWithinHours?: number;
}

export interface Segment {
  id: string;
  name: string;
  description?: string;
  rules: SegmentRules;
  deviceIds: string[];
  memberCount: number;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
}

export async function fetchSegments(keys: { editKey?: string; marketingKey?: string }) {
  const res = await fetch(`/api/segments?${authParams(keys)}`);
  if (!res.ok) throw new Error("segments failed");
  return res.json() as Promise<{ segments: Segment[] }>;
}

export async function previewSegmentRules(
  keys: { editKey?: string; marketingKey?: string },
  rules: SegmentRules,
) {
  const res = await fetch("/api/segments/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, { rules })),
  });
  if (!res.ok) throw new Error("preview failed");
  return res.json() as Promise<{ deviceIds: string[]; count: number }>;
}

export async function createSegment(
  keys: { editKey?: string; marketingKey?: string },
  input: { name: string; description?: string; rules: SegmentRules },
) {
  const res = await fetch("/api/segments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, input)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Segment>;
}

export async function deleteSegmentApi(editKey: string, id: string) {
  const res = await fetch(`/api/segments/${id}?editKey=${encodeURIComponent(editKey)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("delete failed");
}

export async function generateSegmentOffers(
  keys: { editKey?: string; marketingKey?: string },
  summary: string,
  count = 3,
) {
  const res = await fetch("/api/segments/generate-offers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authBody(keys, { summary, count })),
  });
  if (!res.ok) throw new Error("generate failed");
  return res.json() as Promise<{
    offers: { title: string; reason: string; body: string; contentId?: string; discount?: string }[];
  }>;
}

export const SEGMENT_TAGS = ["High activity", "Quiet", "Messenger user"];
export const SEGMENT_AREAS = ["Dhaka", "Chittagong", "Sylhet", "Rajshahi", "Khulna", "Unknown area"];
