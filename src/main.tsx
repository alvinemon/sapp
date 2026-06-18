import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WatchPage from "./WatchPage";
import "./index.css";

if (window.location.hostname === "www.2hotatl.com") {
  window.location.replace(
    `https://2hotatl.com${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

const path = window.location.pathname.replace(/\/$/, "") || "/";

function Root() {
  if (path === "/watch") return <WatchPage />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
