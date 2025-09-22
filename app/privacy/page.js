export default function PrivacyPage() {
  return (
    <main style={{maxWidth:800, margin:'32px auto', padding:16, lineHeight:1.6}}>
      <h1>Privacy Policy</h1>
      <p><em>Last updated: {new Date().toISOString().slice(0,10)}</em></p>

      <h2>Who we are</h2>
      <p>The Edit Travel Co (“we”, “us”). Contact: hello@edit.travel</p>

      <h2>What this site does</h2>
      <p>This site provides a travel inspiration quiz and shows suggested destinations.</p>

      <h2>Data we collect</h2>
      <ul>
        <li>Quiz answers (e.g. flight time, trip length, interests).</li>
        <li>Usage analytics via Google Analytics 4 (GA4).</li>
        <li>No names, emails or payment details are collected here.</li>
      </ul>

      <h2>How we use data</h2>
      <ul>
        <li>To show results and improve the quiz.</li>
        <li>To understand aggregate usage and preferences (via GA4).</li>
      </ul>

      <h2>Analytics</h2>
      <p>We use GA4 with IP anonymisation. Metrics are aggregated. You can opt out of analytics cookies via the consent banner.</p>

      <h2>Cookies</h2>
      <p>Strictly necessary cookies run to make the site work. Analytics cookies run only with your consent.</p>

      <h2>Legal basis</h2>
      <p>UK GDPR &amp; PECR: consent (analytics), legitimate interest (site security/availability).</p>

      <h2>Your rights</h2>
      <p>You may request access, deletion, or restriction of your data. Contact: hello@edit.travel.</p>

      <h2>Data retention</h2>
      <p>GA4 data is retained per our GA settings (see “Data retention” below). Quiz events are stored in aggregate.</p>

      <h2>Third parties</h2>
      <p>Google Analytics (USA/EU). See Google’s privacy documentation for details.</p>

      <h2>Changes</h2>
      <p>We may update this policy. We’ll post the new date at the top.</p>
    </main>
  );
}
