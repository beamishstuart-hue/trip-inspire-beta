export const metadata = { title: 'Trip Inspire', description: 'Top 3 destination ideas' };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{margin:0, fontFamily:'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', background:'#f6f7f8'}}>
        {children}
      </body>
    </html>
  );
}
