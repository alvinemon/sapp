import { canAccessAdmin, isOpenAccess, adminEditKey } from "./authKeys.js";
import { authenticateMarketing, marketingMemberCanDevice, normalizeIntelScopes, type MarketingMember } from "./marketingTeam.js";

export type AccessContext =
  | { role: "admin" }
  | { role: "marketing"; member: MarketingMember };

export function resolveAccess(keys: {
  editKey?: string;
  marketingKey?: string;
}): AccessContext | null {
  if (keys.editKey) {
    if (canAccessAdmin(keys.editKey)) return { role: "admin" };
    if (adminEditKey()) return null;
  }
  if (keys.marketingKey) {
    const member = authenticateMarketing(keys.marketingKey);
    if (member) return { role: "marketing", member };
    if (!isOpenAccess()) return null;
  }
  if (isOpenAccess()) return { role: "admin" };
  if (!adminEditKey()) return { role: "admin" };
  return null;
}

export function assertDeviceIntelAccess(
  deviceId: string,
  keys: { editKey?: string; marketingKey?: string },
  needOffers = false,
): AccessContext {
  const ctx = resolveAccess(keys);
  if (!ctx) throw new Error("Access denied");
  if (ctx.role === "admin") return ctx;
  if (!ctx.member.canViewIntel) throw new Error("Intel access disabled for this marketer");
  const scopes = normalizeIntelScopes(ctx.member);
  if (!Object.values(scopes).some(Boolean)) {
    throw new Error("No intel types enabled for this marketer");
  }
  if (needOffers && !ctx.member.canSendOffers) throw new Error("Offer access disabled for this marketer");
  if (!marketingMemberCanDevice(ctx.member, deviceId)) throw new Error("Device not assigned to you");
  return ctx;
}
