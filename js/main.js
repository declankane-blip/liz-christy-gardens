(function(){
  // Router: one file, separate pages via #/page
  const pages=['home','visit','history','volunteer','donate'];
  function route(){
    const h=location.hash;
    if(h && !h.startsWith('#/')) return; // in-page anchors leave the page alone
    const name=(h.replace('#/','').split('/')[0])||'home';
    const page=pages.includes(name)?name:'home';
    document.querySelectorAll('.view').forEach(v=>v.hidden=v.dataset.page!==page);
    document.querySelectorAll('[data-nav]').forEach(a=>{ if(a.dataset.nav===page) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    const v=document.querySelector('.view[data-page="'+page+'"]');
    document.title=v.dataset.title;
    window.scrollTo(0,0);
    if(route.started){ const h1=v.querySelector('h1'); if(h1) h1.focus({preventScroll:true}); }
    route.started=true;
  }
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-track]'); if(!el||el.type==='submit') return;
    try{ if(window.goatcounter&&goatcounter.count) goatcounter.count({path:'click-'+el.dataset.track,event:true}); }catch(e){}
  });
  window.addEventListener('hashchange',route); route();

  // Next open hours, in New York time
  function nextOpen(){
    try{
      const now=new Date();
      const ny=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));
      const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      for(let add=0;add<8;add++){
        const d=new Date(ny); d.setDate(ny.getDate()+add);
        const dow=d.getDay(), m=d.getMonth()+1, season=m>=5&&m<=9;
        let slot=null;
        if(dow===6||(season&&dow===0)) slot=[12*60,16*60,'noon to 4 PM'];
        else if(season&&(dow===2||dow===4)) slot=[18*60,(m===9?19*60+15:20*60+15),'6 PM to dusk'];
        if(!slot) continue;
        const mins=ny.getHours()*60+ny.getMinutes();
        if(add===0&&mins>=slot[1]) continue;
        if(add===0&&mins>=slot[0]) return 'The garden is open right now, until '+(slot[2].split(' to ')[1])+'.';
        const day=add===0?'today':add===1?'tomorrow':names[dow];
        return 'Next open: '+day+', '+slot[2]+'.';
      }
    }catch(e){}
    return '';
  }
  document.querySelectorAll('[data-next-open]').forEach(el=>el.textContent=nextOpen());
  (function(){
    const t=nextOpen(), d=document.querySelector('[data-next-day]'), tm=document.querySelector('[data-next-time]');
    if(!d||!t) return;
    if(t.startsWith('The garden is open')){ d.textContent='Right now'; tm.textContent=t.replace('The garden is open right now, ','').replace(/\.$/,''); return; }
    const m=t.match(/^Next open: ([^,]+), (.+)\.$/);
    if(m){ d.textContent=m[1].charAt(0).toUpperCase()+m[1].slice(1); tm.textContent=m[2].charAt(0).toUpperCase()+m[2].slice(1); }
  })();

  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'short',month:'numeric',hour:'numeric',minute:'numeric',hour12:false}).formatToParts(new Date());
    const g=t=>(parts.find(p=>p.type===t)||{}).value;
    const day={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}[g('weekday')];
    const month=parseInt(g('month'),10);
    const mins=(parseInt(g('hour'),10)%24)*60+parseInt(g('minute'),10);
    const season=month>=5&&month<=9;
    const dusk=month===9?19*60+15:20*60+15; // approximate
    const slots={6:[720,960,'4 PM'],0:season?[720,960,'4 PM']:null,2:season?[1080,dusk,'dusk']:null,4:season?[1080,dusk,'dusk']:null};
    const s=slots[day], el=document.getElementById('status'), t=document.getElementById('status-text');
    if(s){const row=document.querySelector('tr[data-day="'+day+'"]'); if(row) row.classList.add('today');}
    if(s&&mins>=s[0]&&mins<s[1]){el.classList.add('open');t.textContent='Open now until '+s[2];}
    else if(s&&mins<s[0]){t.textContent='Opens today at '+(s[0]===720?'noon':'6 PM');}
    else{t.textContent=season?'Closed right now':'Closed now. Open Saturdays, noon to 4 PM';}
  }catch(e){document.getElementById('status').hidden=true;}

  // Copy mailing address
  const addr='Green Guerillas\n307 7th Avenue, Room 1601\nNew York, NY 10001';
  const copyBtn=document.getElementById('copy-addr'); if(copyBtn) copyBtn.addEventListener('click',async()=>{
    const m=document.getElementById('copy-msg');
    try{await navigator.clipboard.writeText(addr);m.textContent='Address copied. Remember “Liz Christy” on the memo line.';}
    catch(e){
      const range=document.createRange();range.selectNodeContents(document.querySelector('.mail address'));
      const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
      m.textContent='Address selected. Press Ctrl+C or ⌘C to copy.';
    }
  });

})();
