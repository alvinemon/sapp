export type VideoKind = "youtube" | "drive" | "direct";

export interface ResolvedVideo {
  kind: VideoKind;
  /** For YouTube: video id. For drive/direct: playable URL */
  playUrl: string;
  embedUrl?: string;
}

const YT_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/;

const DRIVE_RE = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;

export function resolveVideoUrl(input: string): ResolvedVideo | null {
  const raw = input.trim();
  if (!raw) return null;

  const yt = raw.match(YT_RE);
  if (yt) {
    const id = yt[1];
    return {
      kind: "youtube",
      playUrl: id,
      embedUrl: `https://www.youtube.com/embed/${id}?enablejsapi=1&playsinline=1`,
    };
  }

  const drive = raw.match(DRIVE_RE);
  if (drive) {
    const id = drive[1];
    const playUrl = `https://drive.google.com/uc?export=download&id=${id}`;
    return { kind: "drive", playUrl };
  }

  if (/^https?:\/\//i.test(raw)) {
    return { kind: "direct", playUrl: raw };
  }

  return null;
}

export function randomRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
