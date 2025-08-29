export default function Home() {
  return (
    <main style={{maxWidth:720, margin:'32px auto', padding:16}}>
      <h1 style={{fontSize:28, fontWeight:700}}>Trip Inspire</h1>
      <p style={{color:'#555'}}>Home route sanity check.</p>
      <p><a href="/api/inspire" style={{textDecoration:'underline'}}>Open /api/inspire</a></p>
    </main>
  );
}
