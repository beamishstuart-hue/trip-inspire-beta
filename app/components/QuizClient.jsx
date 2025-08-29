'use client';
import React, { useState } from 'react';

export default function QuizClient() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setResults([]);

    const formData = new FormData(e.target);
    const prefs = {
      flight_time_hours: formData.get('flight_time_hours'),
      duration: formData.get('duration'),
      group: formData.get('group'),
      style: formData.get('style'),
      interests: formData.getAll('interests'),
      season: formData.get('season'),
      pace: formData.get('pace'),
    };

    try {
      const res = await fetch('/api/inspire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: 'LHR', preferences: prefs })
      });
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
    <main style={{maxWidth:800, margin:'32px auto', padding:16, fontFamily:'system-ui, sans-serif'}}>
      <h1 style={{fontSize:28, fontWeight:800, marginBottom:8}}>The Edit Ideas Quiz</h1>
<p style={{color:'var(--muted)', marginBottom:24}}>
  Answer a few quick questions and we’ll suggest your Top 3 trip ideas.
</p>


      <form onSubmit={onSubmit} style={{
  display:'grid',
  gap:20,
  background:'var(--card)',
  padding:24,
  borderRadius:'var(--radius)',
  boxShadow:'var(--shadow)'
}}
>
        <label>
          1) Max flight time (hours, non-stop from UK):
          <input type="range" name="flight_time_hours" min="1" max="20" defaultValue="8" onInput={e => e.target.nextSibling.textContent = e.target.value + 'h'} />
          <span>8h</span>
        </label>

        <label>
          2) Trip length:
          <select name="duration" defaultValue="week-7d">
            <option value="weekend-2d">Weekend (2 days)</option>
            <option value="mini-4d">Mini break (4 days)</option>
            <option value="week-7d">One week (7 days)</option>
            <option value="two-weeks">Two weeks (14 days)</option>
          </select>
        </label>

        <label>
          3) Who’s travelling?
          <select name="group" defaultValue="couple">
            <option value="solo">Solo</option>
            <option value="couple">Couple</option>
            <option value="family">Family with kids</option>
            <option value="friends">Group of friends</option>
          </select>
        </label>

        <label>
          4) Travel style:
          <select name="style" defaultValue="relaxation">
            <option value="adventure">Adventure & Outdoor</option>
            <option value="relaxation">Relaxation & Beach</option>
            <option value="cultural">Cultural & Historical</option>
            <option value="luxury">Luxury & Fine Dining</option>
            <option value="budget">Budget & Backpacking</option>
          </select>
        </label>

        <fieldset>
          <legend>5) Interests (select all that apply):</legend>
          {['Beaches','Cities','Food & drink','Nightlife','Photography','Hiking','Mountains','Wildlife','Museums','Shopping','Water sports','Local culture'].map(i=>(
            <label key={i} style={{display:'block'}}>
              <input type="checkbox" name="interests" value={i}/> {i}
            </label>
          ))}
        </fieldset>

        <label>
          6) When are you planning to travel?
          <select name="season" defaultValue="summer">
            <option value="spring">Spring (Mar–May)</option>
            <option value="summer">Summer (Jun–Aug)</option>
            <option value="autumn">Autumn (Sep–Nov)</option>
            <option value="winter">Winter (Dec–Feb)</option>
            <option value="flexible">Flexible</option>
          </select>
        </label>

        <label>
          7) Itinerary pace:
          <select name="pace" defaultValue="relaxed">
            <option value="total">Total relaxation</option>
            <option value="relaxed">A few relaxing activities</option>
            <option value="daily">Something different every day</option>
            <option value="packed">Pack it full</option>
          </select>
        </label>

       <button
  type="submit"
  style={{
    padding:'12px 18px',
    borderRadius:'var(--radius)',
    border:'1px solid transparent',
    background:'var(--brand)',
    color:'#fff',
    fontSize:16,
    fontWeight:600,
    cursor:'pointer',
    boxShadow:'var(--shadow)'
  }}
>
  Show My Top 3
</button>

      </form>

      {loading && <p style={{marginTop:16}}>Working on your ideas…</p>}
      {error && <p style={{marginTop:16, color:'crimson'}}>{error}</p>}

      <div style={{display:'grid', gap:16, marginTop:24}}>
        {results.map((trip,i)=>(
          <div key={i} style={{background:'#fff', padding:16, borderRadius:12, boxShadow:'0 1px 6px rgba(0,0,0,0.05)'}}>
            <h2 style={{marginTop:0}}>{trip.city}, {trip.country}</h2>
            <p style={{fontStyle:'italic'}}>{trip.summary}</p>
            {trip.days?.map((d,di)=>(
              <div key={di} style={{marginBottom:12}}>
                <strong>Day {di+1}</strong><br/>
                🌅 Morning: {d.morning}<br/>
                ☀️ Afternoon: {d.afternoon}<br/>
                🌙 Evening: {d.evening}
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}
