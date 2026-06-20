import { useEffect } from "react";

/** Redirect legacy /admin URLs to unified control portal. */
export default function AdminPage() {
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get("tab") ?? "catalog";
    window.location.replace(`/?tab=${tab}`);
  }, []);
  return <p className="intel-muted">Redirecting to control portal…</p>;
}
