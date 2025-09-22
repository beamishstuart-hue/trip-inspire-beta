// lib/analytics.js
export function track(event, props = {}) {
  if (typeof window === "undefined") return;
  window.gtag?.("event", event, props);
}
