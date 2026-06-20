/** Starter HTML templates for popup / notification campaigns. */

export const HTML_CAMPAIGN_TEMPLATES = {
  popupHero: {
    name: "Popup — hero sale",
    title: "Special offer",
    html: `<div style="text-align:center;padding:8px 0">
  <p style="font-size:14px;color:#aaa;margin-bottom:12px">Limited time</p>
  <h2 style="font-size:28px;color:#fff;margin-bottom:8px">Unlock premium</h2>
  <p style="color:#ccc;margin-bottom:20px">Stream exclusive movies &amp; shows tonight.</p>
  <img src="https://placehold.co/320x180/141414/e50914?text=2hotatl" alt="" style="width:100%;border-radius:12px;margin-bottom:16px"/>
  <p style="font-size:18px;color:#86efac;font-weight:bold">20% off with code HOT20</p>
</div>`,
  },
  popupMinimal: {
    name: "Popup — minimal",
    title: "For you",
    html: `<p style="font-size:16px;color:#eee">We picked something based on what you've been watching.</p>
<p style="margin-top:12px;color:#e50914;font-weight:bold">Tap Watch to open the app.</p>`,
  },
  notificationRich: {
    name: "Notification — rich (opens HTML on tap)",
    title: "New for you 🎬",
    html: `<p><strong>Your personalized pick is ready.</strong></p>
<ul style="margin:12px 0;padding-left:20px;color:#ccc">
  <li>Free episode included</li>
  <li>Watch with friends in sync</li>
</ul>
<p style="color:#fcd34d">Tap this notification to see the full offer.</p>`,
  },
  flashSale: {
    name: "Flash sale banner",
    title: "Flash sale",
    html: `<div style="background:linear-gradient(135deg,#e50914,#7f1d1d);padding:20px;border-radius:16px;text-align:center">
  <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:0.9">Today only</div>
  <div style="font-size:32px;font-weight:800;margin:8px 0">50% OFF</div>
  <div style="font-size:15px">Premium catalog · bKash / Surjo accepted</div>
</div>`,
  },
} as const;

export type HtmlTemplateKey = keyof typeof HTML_CAMPAIGN_TEMPLATES;

export function wrapHtmlPreview(html: string, title: string): string {
  const trimmed = html.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return trimmed;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#f5f5f5;padding:16px;margin:0;line-height:1.5}img{max-width:100%}</style></head>
<body><h1 style="color:#e50914;font-size:1.1rem;margin:0 0 12px">${title || "Preview"}</h1>${html}</body></html>`;
}
