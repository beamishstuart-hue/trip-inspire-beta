'use client';
import React, { useState } from 'react';

export default function QuizClient() {
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState(null);
  const [top5, setTop5] = useState([]);
  const [error, setError] = useState(null);
  const [includeItinNow, setIncludeItinNow] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setMeta(null); setTop5([]);

    const fd = new FormData(e.target);
    const prefs = {
      flight_time_hours: fd.get('flight_time_hours'),
      duration: fd.get('duration'),
      group: fd.get('group'),
      style: fd.get('style'),
      interests: fd.getAll('interests'),
      season: fd.get('season'),
    };

    try {
      const res = await fetch('/api/inspire', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          origin: 'LHR',
          preferences: prefs,
          highlightsOnly: !includeItinNow
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMeta(data.meta || null);

      // If includeItinNow is false => we expect { top5: [...] }
      if (Array.isArray(data.top5)) {
        setTop5(data.top5);
      } else if (Array.isArray(data.top3)) {
        // legacy support if you flip the API back
        setTop5(data.top3.map(t=>({
          city:t.city, country:t.country,
          summary:t.summary,
          highlights:(t.days||[]).slice(0,3).map((d,i)=> d.morning || d.afternoon || d.evening || `Highlight ${i+1}`)
        })));
      } else {
        setTop5([]);
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function buildItinerary(idx, daysLabel='7') {
    const card = top5[idx];
    if (!card) return;
    // Grab current duration selection from the form
    const durSel = document.querySelector('select[name="duration"]');
    const duration = durSel ? durSel.value : (daysLabel === '14' ? 'two-weeks' : 'week-7d');

    // Also pass the same preferences so the plan is consistent
    const form = document.querySelector('form');
    const fd = new FormData(form);
    const prefs = {
      flight_time_hours: fd.get('flight_time_hours'),
      duration,
      group: fd.get('group'),
      style: fd.get('style'),
      interests: fd.getAll('interests'),
      season: fd.get('season'),
    };

    // Mark this card as loading
    const prev = [...top5];
    prev[idx] = { ...card, _loading: true };
    setTop5(prev);

    try {
      const res = await fetch('/api/inspire', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          origin: 'LHR',
          preferences: prefs,
          buildItineraryFor: { city: card.city, country: card.country, duration }
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const next = [...prev];
      next[idx] = {
        ...card,
        _loading: false,
        days: Array.isArray(data.days) ? data.days : []
      };
      setTop5(next);
    } catch (e) {
      const next = [...top5];
      next[idx] = { ...card, _loading:false, _error: e.message || 'Failed to build itinerary' };
      setTop5(next);
    }
  }

  return (
    <main style={{maxWidth:800, margin:'32px auto', padding:16}}>
      <h1 style={{fontSize:28, fontWeight:800, marginBottom:8}}>The Edit Trip Quiz</h1>
      <p style={{color:'var(--muted)', marginBottom:24}}>Answer a few quick questions and we’ll suggest your Top 5, fast. Build a full itinerary only when you want it.</p>

      <form onSubmit={onSubmit} style={{display:'grid', gap:20, background:'var(--card)', padding:24, borderRadius:'var(--radius)', boxShadow:'var(--shadow)'}}>
        <label>
          1) Max flight time (hours, non-stop from UK):
          <input type="range" name="flight_time_hours" min="1" max="20" defaultValue="8" onInput={e=> (e.currentTarget.nextSibling.textContent = e.currentTarget.value+'h')} />
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

        <label style={{display:'flex', gap:8, alignItems:'center'}}>
          <input type="checkbox" checked={includeItinNow} onChange={e=>setIncludeItinNow(e.target.checked)} />
          Show full itineraries now (slower)
        </label>

        <button type="submit" style={{padding:'12px 18px', borderRadius:'var(--radius)', border:'1px solid transparent', background:'var(--brand)', color:'#fff', fontSize:16, fontWeight:600, cursor:'pointer', boxShadow:'var(--shadow)'}}>
          Show My Top {includeItinNow ? '3 with itineraries' : '5 Highlights'}
        </button>
      </form>

      {loading && <p style={{marginTop:16}}>Working…</p>}
      {error && <p style={{marginTop:16, color:'crimson'}}>{error}</p>}
      {meta && <p style={{marginTop:8, color:'var(--muted)'}}>API mode: <strong>{meta.mode}</strong></p>}

      <div style={{display:'grid', gap:16, marginTop:24}}>
        {top5.map((d, i)=>(
          <div key={`${d.city}-${i}`} style={{background:'var(--card)', padding:16, borderRadius:'var(--radius)', boxShadow:'var(--shadow)'}}>
            <h2 style={{marginTop:0}}>{d.city}{d.country ? `, ${d.country}` : ''}</h2>
            {d.summary && <p style={{fontStyle:'italic'}}>{d.summary}</p>}

            {!d.days && Array.isArray(d.highlights) && (
              <ul style={{marginTop:8}}>
                {d.highlights.map((h,hi)=> <li key={hi}>{h}</li>)}
              </ul>
            )}

            {/* Itinerary section (after request) */}
            {Array.isArray(d.days) && (
              <div style={{marginTop:12, display:'grid', gap:8}}>
                {d.days.map((day,di)=>(
                  <div key={di} style={{padding:'8px 10px', background:'#fafafa', borderRadius:8}}>
                    <strong>Day {di+1}</strong><br/>
                    {day.morning && <>🌅 Morning: {day.morning}<br/></>}
                    {day.afternoon && <>☀️ Afternoon: {day.afternoon}<br/></>}
                    {day.evening && <>🌙 Evening: {day.evening}</>}
                  </div>
                ))}
              </div>
            )}

            {/* Build Itinerary button */}
            {!d.days && (
              <div style={{marginTop:12}}>
                {d._error && <p style={{color:'crimson'}}>{d._error}</p>}
                <button
                  onClick={()=>buildItinerary(i)}
                  disabled={d._loading}
                  style={{padding:'10px 14px', borderRadius:10, border:'1px solid #ddd', background:d._loading?'#ddd':'#111', color:'#fff', cursor:d._loading?'default':'pointer'}}
                >
                  {d._loading ? 'Building…' : 'Build 7-day itinerary'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
