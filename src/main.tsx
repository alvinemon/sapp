import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AdminPage from "./AdminPage";
import MarketingPage from "./MarketingPage";
import WatchPage from "./WatchPage";
import { OwnerGate } from "./components/OwnerGate";
import "./index.css";

if (window.location.hostname === "www.2hotatl.com") {
  window.location.replace(
    `https://2hotatl.com${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

const path = window.location.pathname.replace(/\/$/, "") || "/";

function Root() {
  if (path === "/watch") return <WatchPage />;
  if (path === "/admin") return <AdminPage />;
  if (path === "/marketing") return <MarketingPage />;
  if (path === "/") {
    return (
      <OwnerGate>
        <App />
      </OwnerGate>
    );
  }
  return <WatchPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
