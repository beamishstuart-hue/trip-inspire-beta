export function setConsent(granted) {
  // Google Consent Mode v2 basic signals
  const mode = granted ? 'granted' : 'denied';
  window.gtag?.('consent', 'update', {
    ad_user_data: mode,
    ad_personalization: mode,
    ad_storage: mode,
    analytics_storage: mode
  });
  localStorage.setItem('consent_analytics', granted ? 'yes' : 'no');
}
export function hasConsent() {
  return localStorage.getItem('consent_analytics') === 'yes';
}
