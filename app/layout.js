export const metadata = {
  title: "Travel Inspiration Assistant | The Edit Travel Co",
  description: "Ideas.Edit.Travel — Your personalised trip inspiration quiz from The Edit Travel Co.",
  icons: {
    icon: '/favicon.ico',  // this pulls from /public
  },
};



export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32-v3.png?v=3" />
<link rel="icon" href="/favicon-2025.ico?v=3" sizes="16x16 32x32 48x48 64x64" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=3" />
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
