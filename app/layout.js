// app/layout.js

export const metadata = {
  title: "The Edit Travel Quiz",
  description:
    "Your personalised trip inspiration quiz from The Edit Travel Co.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=5" },
      { url: "/favicon-32-v3.png?v=5", type: "image/png", sizes: "32x32" },
    ],
    apple: "/apple-touch-icon.png?v=5",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* GA4 */}
        {process.env.NEXT_PUBLIC_GA_ID && (
          <>
            <script
              async
              src={`https://www.googletagmanager.com/gtag/js?id=${process.env.NEXT_PUBLIC_GA_ID}`}
            />
            <script
              dangerouslySetInnerHTML={{
                __html: `
                  window.dataLayer = window.dataLayer || [];
                  function gtag(){dataLayer.push(arguments);}
                  gtag('js', new Date());

                  // Default: deny everything until user decides
                  gtag('consent', 'default', {
                    ad_user_data: 'denied',
                    ad_personalization: 'denied',
                    ad_storage: 'denied',
                    analytics_storage: 'denied'
                  });

                  // Enable analytics immediately if user previously consented
                  try {
                    if (localStorage.getItem('consent_analytics') === 'yes') {
                      gtag('consent', 'update', {
                        ad_user_data: 'granted',
                        ad_personalization: 'granted',
                        ad_storage: 'granted',
                        analytics_storage: 'granted'
                      });
                    }
                  } catch(e){}

                  gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}', { anonymize_ip: true });
                `,
              }}
            />
          </>
        )}

        {/* Global styles */}
        <style>{`
          :root{
            /* Brand */
            --brand: #C65A3A;        /* terracotta */
            --brand-ink: #3A241E;    /* deep ink for headings on sand */
            --bg: #F6EFE7;           /* sandcream page background */
            --card: #FFFFFF;         /* cards stay white for contrast */
            --muted: #6B5F57;        /* muted text on sand */
            --radius: 14px;
            --shadow: 0 6px 18px rgba(0,0,0,0.06);
            --focus: 0 0 0 3px rgba(198,90,58,0.25);
          }
          html,body{ height:100%; }
          body{
            margin:0;
            background:var(--bg);
            color:var(--brand-ink);
            font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
          }
          a{ color:var(--brand); text-decoration:none; }
          a:hover{ text-decoration:underline; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
