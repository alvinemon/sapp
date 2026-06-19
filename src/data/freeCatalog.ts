export interface FreeCatalogItem {
  id: string;
  title: string;
  year: number;
  category: string;
  kind: "movie" | "tv";
  streamUrl: string;
  thumb: string;
}

export interface FreeCatalogResponse {
  source: string;
  items: FreeCatalogItem[];
  categories: string[];
}

export async function fetchFreeCatalog(kind?: "movie" | "tv"): Promise<FreeCatalogResponse> {
  const q = kind ? `?kind=${kind}` : "";
  const res = await fetch(`/api/free-catalog${q}`);
  if (!res.ok) throw new Error("Could not load free catalog");
  return res.json() as Promise<FreeCatalogResponse>;
}
