/** Owner portal and admin CMS key helpers. */

/** Set OPEN_ACCESS=false on the server to re-enable login keys. */
export function isOpenAccess(): boolean {
  return process.env.OPEN_ACCESS !== "false";
}

export function adminEditKey(): string | null {
  return (
    process.env.ADMIN_EDIT_KEY?.trim() ||
    process.env.LIBRARY_EDIT_KEY?.trim() ||
    null
  );
}

export function ownerPortalKey(): string | null {
  return process.env.OWNER_PORTAL_KEY?.trim() || null;
}

export function canAccessAdmin(key: string | undefined): boolean {
  if (isOpenAccess()) return true;
  const expected = adminEditKey();
  if (!expected) return true;
  return key === expected;
}

export function canAccessPortal(key: string | undefined): boolean {
  if (isOpenAccess()) return true;
  const portal = ownerPortalKey();
  if (!portal) return true;
  return key === portal;
}

export function assertAdmin(key: string | undefined) {
  if (!canAccessAdmin(key)) throw new Error("Invalid edit key");
}

export function assertPortal(key: string | undefined) {
  if (!canAccessPortal(key)) throw new Error("Invalid portal key");
}
