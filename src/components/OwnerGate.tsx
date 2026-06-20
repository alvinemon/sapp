import { useEffect, useState } from "react";

const STORAGE_KEY = "2htl_portal_key";

interface Props {
  children: React.ReactNode;
}

export function OwnerGate({ children }: Props) {
  const [key, setKey] = useState(() => sessionStorage.getItem(STORAGE_KEY) ?? "");
  const [input, setInput] = useState("");
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("k") ?? params.get("ownerKey");
    const tryKey = fromUrl ?? key;
    if (!tryKey) {
      window.location.replace("/watch");
      return;
    }
    void fetch(`/api/auth/portal?key=${encodeURIComponent(tryKey)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("denied");
        const data = (await r.json()) as { ok: boolean };
        if (!data.ok) throw new Error("denied");
        sessionStorage.setItem(STORAGE_KEY, tryKey);
        setKey(tryKey);
        setAllowed(true);
      })
      .catch(() => {
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.replace("/watch");
      })
      .finally(() => setChecking(false));
  }, [key]);

  const submit = async () => {
    setError(null);
    const trimmed = input.trim();
    if (!trimmed) return;
    const res = await fetch(`/api/auth/portal?key=${encodeURIComponent(trimmed)}`);
    if (!res.ok) {
      setError("Invalid owner key");
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, trimmed);
    setKey(trimmed);
    setAllowed(true);
  };

  if (checking) {
    return (
      <div className="owner-gate">
        <p>Verifying access…</p>
      </div>
    );
  }

  if (allowed) return <>{children}</>;

  return (
    <div className="owner-gate">
      <h1>Owner portal</h1>
      <p>Remote control is owner-only. Viewers use <a href="/watch">Watch Together</a>.</p>
      <input
        type="password"
        placeholder="Owner key"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      <button type="button" onClick={() => void submit()}>Enter</button>
      {error && <p className="owner-gate-error">{error}</p>}
    </div>
  );
}
