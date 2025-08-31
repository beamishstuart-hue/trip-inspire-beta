'use client';
import React, { useState } from 'react';

const MAIN_SITE_URL = 'https://edit.travel';

/* --- format a mailto body from an itinerary --- */
function buildItineraryEmail({ city, country, days }) {
  const title = `Trip plan – ${city}${country ? ', ' + country : ''}`;
  const lines = [];
  lines.push(title, '');
  days.forEach((d, i) => {
    lines.push(`Day ${i + 1}`);
    if (d.morning)   lines.push(`  • Morning: ${d.morning}`);
    if (d.afternoon) lines.push(`  • Afternoon: ${d.afternoon}`);
    if (d.evening)   lines.push(`  • Evening: ${d.evening}`);
    lines.push('');
  });
  lines.push('— Sent from The Edit Travel Co – Travel Matchmaker');
  const body = encodeURIComponent(lines.join('\n'));
  const subject = encodeURIComponent(title);
  return `mailto:?subject=${subject}&body=${body}`;
}

/* --- format a mailto body for Top 5 highlights (no itineraries) --- */
function buildTop5Email(top5 = []) {
  const title = 'My Top 5 trip ideas';
  const lines = [];
  lines.push(title, '');
  top5.forEach((d, i) => {
    lines.push(`${i + 1}. ${d.city}${d.country ? ', ' + d.country : ''}`);
    if (d.summary) lines.push(`   – ${d.summary}`);
    if (Array.isArray(d.highlights)) {
      d.highlights.forEach(h => lines.push(`   • ${h}`));
    }
    lines.push('');
  });
  lines.push('— Sent from The Edit Travel Co – Travel Matchmaker');
  const body = encodeURIComponent(lines.join('\n'));
  const subject = encodeURIComponent(title);
  return `mailto:?subject=${subject}&body=${body}`;
}

export default function QuizClient() {
  const [loading, setLoading] = useState(false);
  const [top5, setTop5] = useState([]);
  const [error, setError] = useState(null);
  const [logoLoaded, setLogoLoaded] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true); setError(null); setTop5([]);

    const fd = new FormData(e.target);
    const prefs = {
      flight_time_hours: fd.get('flight_time_hours'),
      duration: fd.get('duration'),
      group: fd.get('group'),
      interests: fd.getAll('interests'),
      season: fd.get('season'),
    };

    try {
      const res = await fetch('/api/inspire', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          origin: 'LHR',
          preferences: prefs
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.top5)) {
        setTop5(data.top5.map(x => ({ ...x, _loading7:false, _loading14:false })));
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

    const duration = daysLabel === '14' ? 'two-weeks' : 'week-7d';

    const form = document.querySelector('form');
    const fd = new FormData(form);
    const prefs = {
      flight_time_hours: fd.get('flight_time_hours'),
      duration,
      group: fd.get('group'),
      interests: fd.getAll('interests'),
      season: fd.get('season'),
    };

    const prev = [...top5];
    prev[idx] = {
      ...card,
      _loading7: daysLabel === '7',
      _loading14: daysLabel === '14'
    };
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
        _loading7: false,
        _loading14: false,
        days: Array.isArray(data.days) ? data.days : []
      };
      setTop5(next);
    } catch (e) {
      const next = [...top5];
      next[idx] = {
        ...card,
        _loading7:false,
        _loading14:false,
        _error: e.message || 'Failed to build itinerary'
      };
      setTop5(next);
    }
  }

  const ALL_INTERESTS = [
    'Beaches','Cities','Food & drink','Nightlife','Photography','Hiking','Mountains','Wildlife','Museums','Shopping','Water sports','Local culture',
    'Romantic','Performing arts','Theme parks','Scenic drives',
    'All-inclusive resorts','Less crowded'
  ];

  return (
    <main style={{maxWidth:800, margin:'32px auto', padding:16}}>
      <header style={{ display:'flex', justifyContent:'center', marginBottom:12 }}>
  <a href={MAIN_SITE_URL} aria-label="The Edit Travel Co">
    <img
      src="/logo-edit-travel.svg"
      alt="The Edit Travel Co"
      onLoad={() => setLogoLoaded(true)}
      onError={() => setLogoLoaded(false)}
      style={{
        height: 'clamp(64px, 10vw, 96px)', // <-- bigger: 64px on mobile, up to 96px on desktop
        width: 'auto',
        display: 'block'
      }}
    />
  </a>
</header>

      {/* Title + subheader + intro */}
      <h1 style={{fontSize:28, fontWeight:800, marginBottom:4, color:'#C66A3D'}}>
        Travel Matchmaker
      </h1>

      {!logoLoaded && (
        <p style={{fontSize:14, color:'var(--muted)', marginTop:0, marginBottom:8}}>
          from <strong>The Edit Travel Co</strong>
        </p>
      )}

      <div style={{fontSize:18, fontWeight:700, marginTop:4}}>
  Meet your perfect trip match
</div>
<p style={{fontSize:15, color:'var(--muted)', marginTop:6, marginBottom:18}}>
  No endless scrolling - our speedy quiz turns your travel likes into five tailored ideas, with ready-made itineraries.
</p>


      <form onSubmit={onSubmit} style={{display:'grid', gap:20, background:'var(--card)', padding:24, borderRadius:'var(--radius)', boxShadow:'var(--shadow)'}}>
        <label>
          1) Max flight time (hours, non-stop from UK):
          <input
            type="range"
            name="flight_time_hours"
            min="1"
            max="20"
            defaultValue="8"
            onInput={e=> (e.currentTarget.nextSibling.textContent = e.currentTarget.value+'h')}
            style={{width:'100%'}}
          />
          <span>8h</span>
        </label>

        <label>
          2) Trip length:
          <select name="duration" defaultValue="week-7d" style={{fontSize:15, padding:'6px 8px'}}>
            <option value="weekend-2d">Weekend (2 days)</option>
            <option value="mini-4d">Mini break (4 days)</option>
            <option value="week-7d">One week (7 days)</option>
            <option value="two-weeks">Two weeks (14 days)</option>
          </select>
        </label>

        <label>
          3) Who’s travelling?
          <select name="group" defaultValue="couple" style={{fontSize:15, padding:'6px 8px'}}>
            <option value="solo">Solo</option>
            <option value="couple">Couple</option>
            <option value="family">Family with kids</option>
            <option value="friends">Group of friends</option>
          </select>
        </label>

        <fieldset>
          <legend>4) Interests (select all that apply):</legend>
          {ALL_INTERESTS.map(i=>(
            <label key={i} style={{display:'block'}}>
              <input type="checkbox" name="interests" value={i}/> {i}
            </label>
          ))}
        </fieldset>

        <label>
          5) When are you planning to travel?
          <select name="season" defaultValue="summer" style={{fontSize:15, padding:'6px 8px'}}>
            <option value="spring">Spring (Mar–May)</option>
            <option value="summer">Summer (Jun–Aug)</option>
            <option value="autumn">Autumn (Sep–Nov)</option>
            <option value="winter">Winter (Dec–Feb)</option>
            <option value="flexible">Flexible</option>
          </select>
        </label>

        <button
          type="submit"
          style={{
            padding:'12px 18px',
            borderRadius:'var(--radius)',
            border:'1px solid transparent',
            backgroundColor:'#C66A3D',
            color:'#fff',
            fontSize:16,
            fontWeight:600,
            cursor:'pointer',
            boxShadow:'var(--shadow)'
          }}
        >
          Show My Top 5 Highlights
        </button>
      </form>

      {loading && (
        <div style={{marginTop:16, textAlign:'center'}}>
          <div className="spinner" style={{
            border:'4px solid #f3f3f3',
            borderTop:'4px solid var(--brand)',
            borderRadius:'50%',
            width:'32px',
            height:'32px',
            animation:'spin 1s linear infinite',
            margin:'0 auto'
          }} />
          <p style={{marginTop:8}}>Finding the best matches…</p>
          <style>{`@keyframes spin {0%{transform:rotate(0deg);}100%{transform:rotate(360deg);}}`}</style>
        </div>
      )}

      {error && <p style={{marginTop:16, color:'crimson'}}>{error}</p>}

      {/* Share Top 5 (only when we have highlights and before any itinerary is built) */}
      {top5.length > 0 && top5.every(d => !Array.isArray(d.days)) && (
        <div style={{marginTop:16}}>
          <a
            href={buildTop5Email(top5)}
            style={{display:'inline-block', padding:'10px 14px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111', textDecoration:'none'}}
          >
            📧 Email these Top 5
          </a>
        </div>
      )}

      {top5.length > 0 && (
        <>
          <div style={{display:'grid', gap:16, marginTop:24}}>
            {top5.map((d, i)=>(
              <div key={`${d.city}-${i}`} style={{background:'var(--card)', padding:16, borderRadius:'var(--radius)', boxShadow:'var(--shadow)'}}>
                <h2 style={{marginTop:0}}>
                  {d.city}{d.country ? `, ${d.country}` : ''}
                </h2>
                {d.summary && <p style={{fontStyle:'italic'}}>{d.summary}</p>}

                {!d.days && Array.isArray(d.highlights) && (
                  <ul style={{marginTop:8}}>
                    {d.highlights.map((h,hi)=> <li key={hi}>{h}</li>)}
                  </ul>
                )}

                {Array.isArray(d.days) && (
                  <div style={{marginTop:12, display:'grid', gap:8}}>
                    {d.days.map((day,di)=>(
                      <div key={di} style={{padding:'8px 10px', background:'#fafafa', borderRadius:8}}>
                        <strong>Day {di+1}</strong><br/>
                        {day.morning && <>Morning: {day.morning}<br/></>}
                        {day.afternoon && <>Afternoon: {day.afternoon}<br/></>}
                        {day.evening && <>Evening: {day.evening}</>}
                      </div>
                    ))}
                    <div style={{display:'flex', gap:12, marginTop:8}}>
                      <a
                        href={buildItineraryEmail({ city: d.city, country: d.country, days: d.days })}
                        style={{flex:1, textAlign:'center', padding:'10px 14px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111', textDecoration:'none'}}
                      >
                        📧 Email this plan
                      </a>
                    </div>
                  </div>
                )}

                {!d.days && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
                    {/* 7-day button */}
                    <button
                      onClick={() => buildItinerary(i, '7')}
                      disabled={d._loading14 || d._loading7}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '1px solid #ddd',
                        backgroundColor: d._loading14 ? '#ddd' : '#C66A3D',
                        color: '#fff',
                        cursor: (d._loading14 || d._loading7) ? 'default' : 'pointer',
                        opacity: d._loading14 ? 0.6 : 1
                      }}
                    >
                      {d._loading7 ? 'Preparing…' : 'Show 7-day itinerary'}
                    </button>

                    {/* 14-day button */}
                    <button
                      onClick={() => buildItinerary(i, '14')}
                      disabled={d._loading14 || d._loading7}
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        borderRadius: 10,
                        border: '1px solid #ddd',
                        backgroundColor: d._loading7 ? '#ddd' : '#C66A3D',
                        color: '#fff',
                        cursor: (d._loading14 || d._loading7) ? 'default' : 'pointer',
                        opacity: d._loading7 ? 0.6 : 1
                      }}
                    >
                      {d._loading14 ? 'Preparing…' : 'Show 14-day itinerary'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Centered CTA below results */}
          <div style={{ marginTop: 32, display: 'flex', justifyContent: 'center' }}>
            <a
              href="https://edit.travel/contact?utm_source=ideas&utm_medium=results&utm_campaign=handoff"
              style={{
                display: 'inline-block',
                padding: '12px 18px',
                borderRadius: 12,
                backgroundColor: '#FFFFFF',   // white
                border: '1px solid #C66A3D',  // terracotta border
                color: '#C66A3D',             // terracotta text
                textDecoration: 'none',
                fontWeight: 600,
                boxShadow: 'var(--shadow)',
                transition: 'opacity .15s ease, box-shadow .15s ease'
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.92')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              onFocus={e => (e.currentTarget.style.boxShadow = '0 0 0 3px rgba(198,106,61,0.25)')}
              onBlur={e => (e.currentTarget.style.boxShadow = 'var(--shadow)')}
              aria-label="Get a quote for your trip"
            >
              Get a quote for your trip
            </a>
          </div>
        </>
      )}

      <footer style={{marginTop:40, textAlign:'center', fontSize:13, color:'var(--muted)'}}>
        <a href={MAIN_SITE_URL} style={{color:'var(--brand)'}} rel="noopener">
          ← Back to The Edit Travel Co
        </a>
        <div style={{marginTop:8, opacity:0.8}}>
          © {new Date().getFullYear()} The Edit Travel Co
        </div>
      </footer>
    </main>
  );
}
