'use client';

import React, { useEffect, useState } from 'react';
import { track } from '@/lib/analytics';

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
  lines.push('— Sent from The Edit Travel Co');
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
  lines.push('— Sent from The Edit Travel Co');
  const body = encodeURIComponent(lines.join('\n'));
  const subject = encodeURIComponent(title);
  return `mailto:?subject=${subject}&body=${body}`;
}

export default function QuizClient() {
  const [loading, setLoading] = useState(false);
  const [top5, setTop5] = useState([]);
  const [error, setError] = useState(null);
  const [logoLoaded, setLogoLoaded] = useState(false);

  // --- GA: quiz start (on first render) ---
  useEffect(() => {
    track('quiz_start', { referrer: document.referrer || 'direct' });
  }, []);

  // Helpers to read current form values when needed for analytics
  const readPrefsFromForm = () => {
    const form = document.querySelector('form');
    if (!form) return {};
    const fd = new FormData(form);
    return {
      flight_time_hours: fd.get('flight_time_hours'),
      duration: fd.get('duration'),
      group: fd.get('group'),
      interests: fd.getAll('interests'),
      season: fd.get('season'),
    };
  };

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

        // --- GA: quiz complete (results returned) ---
        track('quiz_complete', {
          result_type: 'top5_generated',
          interests_csv: (prefs.interests || []).join(','),
          max_flight_time_h: String(prefs.flight_time_hours || ''),
          trip_length: prefs.duration || '',
          travellers: prefs.group || '',
          travel_timeframe: prefs.season || ''
        });
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

    // --- GA: user asked to build an itinerary (CTA) ---
    track('itinerary_request', {
      city: card.city || '',
      country: card.country || '',
      days: daysLabel
    });

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
