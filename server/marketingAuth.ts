import { canAccessAdmin } from "./authKeys.js";
import { authenticateMarketing, marketingMemberCanDevice, normalizeIntelScopes, type MarketingMember } from "./marketingTeam.js";

export type AccessContext =
  | { role: "admin" }
  | { role: "marketing"; member: MarketingMember };

export function resolveAccess(keys: {
  editKey?: string;
  marketingKey?: string;
}): AccessContext | null {
  if (keys.editKey && canAccessAdmin(keys.editKey)) {
    return { role: "admin" };
  }
  const member = keys.marketingKey ? authenticateMarketing(keys.marketingKey) : null;
  if (member) return { role: "marketing", member };
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
