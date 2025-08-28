'use client';
import React, { useState } from 'react';

function strip(s) {
  return (s || '')
    .replace(/\s*\(add a named street\/venue\/landmark\)\s*/gi, '')
    .replace(/\s*— plus a contrasting nearby activity\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setResults([]);
    try {
      const res = await fetch('/api/inspire'); // GET
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const top3 = Array.isArray(data?.top3) ? data.top3 : [];
      // strip any hints client-side too (belt + braces)
      setResults(top3.map(t => ({
        ...t,
        city: strip(t.city),
        country: strip(t.country),
        summary: strip(t.summary),
        days: (t.days || []).map(d => ({
          morning: strip(d.morning),
          afternoon: strip(d.afternoon),
          evening: strip(d.evening),
        }))
      })));
    } catch (err) {
      setError(err?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{maxWidth:720, margin:'32px auto', padding:16}}>
      <h1 style={{fontSize:28, fontWeight:700, marginBottom:12}}>Trip Inspire (beta)</h1>
      <form onSubmit={onSubmit} style={{marginTop:12}}>
        <button type="submit" style={{padding:'10px 14px'}}>Show My Top 3</button>
      </form>

      {loading && <p style={{marginTop:12}}>Working…</p>}
      {error && <p style={{marginTop:12, color:'crimson'}}>{error}</p>}

      <div style={{display:'grid', gap:16, marginTop:24}}>
        {results.map((trip, i) => (
          <div key={i} style={{border:'1px solid #eee', borderRadius:12, padding:16, background:'#fff'}}>
            <img
              src={`https://source.unsplash.com/1200x720/?${encodeURIComponent(trip.city || 'travel city')}&sig=${i}`}
              alt={`${trip.city || 'Destination'} hero`}
              style={{ width: '100%', height: 'auto', borderRadius: 12, objectFit: 'cover', marginBottom: 12, display:'block' }}
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <h2 style={{fontSize:20, fontWeight:700}}>
              {trip.city}{trip.country ? `, ${trip.country}` : ''}
            </h2>
            {trip.summary && <p style={{color:'#555', marginTop:4}}>{trip.summary}</p>}
            <ol style={{marginTop:12, paddingLeft:18}}>
              {(trip.days || []).slice(0,4).map((d, j) => (
                <li key={j} style={{marginBottom:8}}>
                  <div><strong>Morning:</strong> {d.morning}</div>
                  <div><strong>Afternoon:</strong> {d.afternoon}</div>
                  <div><strong>Evening:</strong> {d.evening}</div>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </main>
  );
}
