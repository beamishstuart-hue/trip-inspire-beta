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
    {/* Email CTA */}
    <div style={{display:'flex', gap:12, marginTop:8}}>
      <a
        href={buildEmail({ city: d.city, country: d.country, days: d.days })}
        style={{flex:1, textAlign:'center', padding:'10px 14px', borderRadius:10, border:'1px solid #ddd', background:'#fff', color:'#111', textDecoration:'none'}}
      >
        📧 Email this plan
      </a>
    </div>
  </div>
)}
