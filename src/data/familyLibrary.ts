export interface FamilyLibraryItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  url: string;
  addedAt?: number;
}

export interface FamilyLibraryResponse {
  title: string;
  items: FamilyLibraryItem[];
  requiresKey: boolean;
}

export async function fetchFamilyLibrary(): Promise<FamilyLibraryResponse> {
  const res = await fetch("/api/family-library");
  if (!res.ok) throw new Error("Could not load family library");
  return res.json() as Promise<FamilyLibraryResponse>;
}

export async function addFamilyLibraryItem(
  item: Omit<FamilyLibraryItem, "id" | "addedAt"> & { editKey?: string },
): Promise<FamilyLibraryItem> {
  const res = await fetch("/api/family-library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Could not add item");
  }
  return res.json() as Promise<FamilyLibraryItem>;
}

export async function removeFamilyLibraryItem(id: string, editKey?: string): Promise<void> {
  const res = await fetch(`/api/family-library/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ editKey }),
  });
  if (!res.ok) throw new Error("Could not remove item");
}
