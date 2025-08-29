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
      const res = await fetch('/api/inspire');
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
      <form onSubmit={onSubmit}><button type="submit">Ping API</button></form>
      {loading && <p>Working…</p>}
      {error && <p style={{color:'crimson'}}>{error}</p>}
      <pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(results[0] || {}, null, 2)}</pre>
    </main>
  );
}


  return (
    <main style={{maxWidth: 900, margin:'32px auto', padding:16}}>
      <h1 style={{fontSize:28, fontWeight:700, marginBottom:12}}>Find Your Perfect Trip</h1>

      <form onSubmit={onSubmit} style={{display:'grid', gap:24, background:'#fff', padding:16, borderRadius:12, boxShadow:'0 2px 10px rgba(0,0,0,0.05)'}}>

        {/* 1. Flight time */}
        <label>
          <strong>1) Maximum flight time (non-stop from UK):</strong><br/>
          <input
            type="range" min="1" max="20" value={form.flight_time_hours}
            onChange={e => updateField('flight_time_hours', Number(e.target.value))}
            style={{width:'100%'}}
          />
          <div style={{marginTop:6}}>{form.flight_time_hours}{form.flight_time_hours===20?'+':''} hours</div>
        </label>

        {/* 2. Duration */}
        <fieldset>
          <legend><strong>2) How long is your trip?</strong></legend>
          {[
            ['weekend-2d','Weekend (2 days)'],
            ['mini-4d','Mini break (4 days)'],
            ['week-7d','One week (7 days)'],
            ['two-weeks','Two weeks (14 days)']
          ].map(([val,label])=>(
            <label key={val} style={{display:'block', marginTop:6}}>
              <input type="radio" name="duration" checked={form.duration===val} onChange={()=>updateField('duration',val)} />{' '}{label}
            </label>
          ))}
        </fieldset>

        {/* 3. Group */}
        <fieldset>
          <legend><strong>3) Who’s travelling?</strong></legend>
          {['solo','couple','family','friends'].map(val=>(
            <label key={val} style={{display:'block', marginTop:6}}>
              <input type="radio" name="group" checked={form.group===val} onChange={()=>updateField('group',val)} />{' '}
              {val==='solo'?'Solo':val==='couple'?'Couple':val==='family'?'Family with kids':'Group of friends'}
            </label>
          ))}
        </fieldset>

        {/* 4. Style */}
        <fieldset>
          <legend><strong>4) What’s your travel style?</strong></legend>
          {[
            ['adventure','Adventure & outdoor activities'],
            ['relaxation','Relaxation & beach'],
            ['cultural','Cultural & historical'],
            ['luxury','Luxury & fine dining'],
            ['budget','Budget & backpacking']
          ].map(([val,label])=>(
            <label key={val} style={{display:'block', marginTop:6}}>
              <input type="radio" name="style" checked={form.style===val} onChange={()=>updateField('style',val)} />{' '}{label}
            </label>
          ))}
        </fieldset>

        {/* 5. Interests */}
        <fieldset>
          <legend><strong>5) What interests you most? (select all that apply)</strong></legend>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px,1fr))', gap:8}}>
            {INTERESTS.map(label=>(
              <label key={label} style={{display:'flex', alignItems:'center', gap:8}}>
                <input type="checkbox" checked={form.interests.includes(label)} onChange={()=>toggleInterest(label)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* 6. Season */}
        <fieldset>
          <legend><strong>6) When are you planning to travel?</strong></legend>
          {[
            ['spring','Spring (Mar–May)'],
            ['summer','Summer (Jun–Aug)'],
            ['autumn','Autumn (Sep–Nov)'],
            ['winter','Winter (Dec–Feb)'],
            ['flexible','Flexible']
          ].map(([val,label])=>(
            <label key={val} style={{display:'block', marginTop:6}}>
              <input type="radio" name="season" checked={form.season===val} onChange={()=>updateField('season',val)} />{' '}{label}
            </label>
          ))}
        </fieldset>

        {/* 7. Pace */}
        <fieldset>
          <legend><strong>7) Itinerary pace</strong></legend>
          {[
            ['total','Total relaxation – if we do one thing that’s fine'],
            ['relaxed','A few relaxing activities'],
            ['daily','Something different every day'],
            ['packed','Pack it full']
          ].map(([val,label])=>(
            <label key={val} style={{display:'block', marginTop:6}}>
              <input type="radio" name="pace" checked={form.pace===val} onChange={()=>updateField('pace',val)} />{' '}{label}
            </label>
          ))}
        </fieldset>

        <button type="submit" style={{padding:'12px 16px', borderRadius:10, border:'1px solid #ddd', background:'#111', color:'#fff'}}>
          Show My Top 3
        </button>
      </form>

      {loading && <p style={{marginTop:16}}>Working…</p>}
      {error && <p style={{marginTop:16, color:'crimson'}}>{error}</p>}

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
              {(trip.days || []).map((d, j) => (
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
