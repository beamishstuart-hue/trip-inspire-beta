'use client';
import React, { useState } from 'react';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setResults([]);
    try {
      const res = await fetch('/api/inspire'); // simple ping; we’ll wire the quiz after page loads
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResults(Array.isArray(data?.top3) ? data.top3 : []);
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{maxWidth:720, margin:'32px auto', padding:16}}>
      <h1 style={{fontSize:28, fontWeight:700, marginBottom:12}}>Trip Inspire</h1>
      <p style={{color:'#555', marginBottom:12}}>Quick check that the homepage renders on Vercel.</p>
      <form onSubmit={onSubmit}>
        <button type="submit" style={{padding:'10px 14px'}}>Test API</button>
      </form>

      {loading && <p style={{marginTop:12}}>Working…</p>}
      {error && <p style={{marginTop:12, color:'crimson'}}>{error}</p>}

      {results.length > 0 && (
        <pre style={{marginTop:12, background:'#fff', padding:12, borderRadius:8, whiteSpace:'pre-wrap'}}>
{JSON.stringify(results[0], null, 2)}
        </pre>
      )}
    </main>
  );
}
