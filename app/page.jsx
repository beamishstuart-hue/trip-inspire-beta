'use client';
import React, { useState } from 'react';

export default function Home() {
  const [form, setForm] = useState({
    flight_time_hours: 8,
    duration: 'weekend-2d',
    group: 'couple',
    style: 'relaxation',
    interests: [],
    season: 'flexible',
    pace: 'relaxed'
  });

  function updateField(name, value) {
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function toggleInterest(interest) {
    setForm(prev => {
      const exists = prev.interests.includes(interest);
      return {
        ...prev,
        interests: exists
          ? prev.interests.filter(i => i !== interest)
          : [...prev.interests, interest]
      };
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    alert(JSON.stringify(form, null, 2)); // for now just preview the answers
  }

  return (
    <main style={{maxWidth:720, margin:'32px auto', padding:16}}>
      <h1 style={{fontSize:28, fontWeight:700, marginBottom:12}}>Find Your Perfect Trip</h1>
      <form onSubmit={onSubmit} style={{display:'grid', gap:24}}>

        {/* 1. Flight time */}
        <label>
          <strong>1) Maximum flight time (non-stop from UK):</strong><br/>
          <input
            type="range" min="1" max="20" value={form.flight_time_hours}
            onChange={e => updateField('flight_time_hours', Number(e.target.value))}
          />
          <div>{form.flight_time_hours}+ hours</div>
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
            <label key={val} style={{display:'block', marginTop:4}}>
              <input type="radio" name="duration" checked={form.duration===val}
                onChange={()=>updateField('duration',val)} />
              {' '}{label}
            </label>
          ))}
        </fieldset>

        {/* 3. Group */}
        <fieldset>
          <legend><strong>3) Who’s travelling?</strong></legend>
          {['solo','couple','family','friends'].map(val=>(
            <label key={val} style={{display:'block', marginTop:4}}>
              <input type="radio" name="group" checked={form.group===val}
                onChange={()=>updateField('group',val)} />
              {' '}{val.charAt(0).toUpperCase()+val.slice(1)}
            </label>
          ))}
        </fieldset>

        {/* 4. Style */}
        <fieldset>
          <legend><strong>4) What’s your travel style?</strong></legend>
          {[
            ['adventure','Adventure & outdoors'],
            ['relaxation','Relaxation & beach'],
            ['cultural','Cultural & historical'],
            ['luxury','Luxury & fine dining'],
            ['budget','Budget & backpacking']
          ].map(([val,label])=>(
            <label key={val} style={{display:'block', marginTop:4}}>
              <input type="radio" name="style" checked={form.style===val}
                onChange={()=>updateField('style',val)} />
              {' '}{label}
            </label>
          ))}
        </fieldset>

        {/* 5. Interests */}
        <fieldset>
          <legend><strong>5) What interests you most? (select all that apply)</strong></legend>
          {['Beaches','Cities','Food & drink','Nightlife','Photography','Hiking','Mountains','Wildlife','Museums','Shopping','Water sports','Local culture'].map(label=>(
            <label key={label} style={{display:'block', marginTop:4}}>
              <input type="checkbox"
                checked={form.interests.includes(label)}
                onChange={()=>toggleInterest(label)} />
              {' '}{label}
            </label>
          ))}
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
            <label key={val} style={{display:'block', marginTop:4}}>
              <input type="radio" name="season" checked={form.season===val}
                onChange={()=>updateField('season',val)} />
              {' '}{label}
            </label>
          ))}
        </fieldset>

        {/* 7. Pace */}
        <fieldset>
          <legend><strong>7) Itinerary pace</strong></legend>
          {[
            ['total','Total relaxation – one thing is fine'],
            ['relaxed','A few relaxing activities'],
            ['daily','Something different every day'],
            ['packed','Pack it full!']
          ].map(([val,label])=>(
            <label key={val} style={{display:'block', marginTop:4}}>
              <input type="radio" name="pace" checked={form.pace===val}
                onChange={()=>updateField('pace',val)} />
              {' '}{label}
            </label>
          ))}
        </fieldset>

        <button type="submit" style={{padding:'12px 16px', borderRadius:10, border:'1px solid #ddd', background:'#111', color:'#fff'}}>
          Show My Top 3
        </button>
      </form>
    </main>
  );
}
