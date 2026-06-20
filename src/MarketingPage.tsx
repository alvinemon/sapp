import { useEffect } from "react";

/** Redirect legacy /marketing URLs to unified control portal. */
export default function MarketingPage() {
  useEffect(() => {
    window.location.replace("/?tab=intel");
  }, []);
  return <p className="intel-muted">Redirecting to control portal…</p>;
}
