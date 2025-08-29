export const metadata = {
  title: 'The Edit Trip Quiz',
  description: 'Get your Top 3 trip ideas from The Edit Travel Co',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
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
