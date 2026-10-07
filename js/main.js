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
  let dbP=null, userP=null;
  try{ if(window.claude&&claude.use){ dbP=claude.use('db'); userP=claude.use('user'); } }catch(e){}

  // Analytics: one private record per visitor (page views, button clicks, sign-ups, where they came from).
  // Only the site owner can read it. On the live site, GoatCounter (see <head>) does this job.
  const track=(function(){
    let ref=null, state=null, timer=null, loading=null;
    function load(){
      if(loading) return loading;
      return loading=(async()=>{
        const db=dbP?await dbP:null, user=userP?await userP:null;
        if(!db||!user) return false;
        ref=db.doc('analytics/'+await user.id());
        try{const snap=await ref.get(); state=snap.exists?snap.data():null;}catch(e){state=null;}
        if(!state){
          const q=new URLSearchParams(location.search); let src='direct';
          try{ if(document.referrer) src=new URL(document.referrer).hostname; }catch(e){}
          state={views:{},clicks:{},signups:0,firstSeen:new Date().toISOString(),source:q.get('utm_source')||src};
        }
        return true;
      })();
    }
    return async function(kind,name){
      try{
        if(!await load()) return;
        if(kind==='view') state.views[name]=(state.views[name]||0)+1;
        else if(kind==='signup') state.signups++;
        else state.clicks[name]=(state.clicks[name]||0)+1;
        clearTimeout(timer);
        timer=setTimeout(()=>{state.lastSeen=new Date().toISOString();ref.set(state).catch(()=>{});},1000);
      }catch(e){}
    };
  })();
  document.addEventListener('click',e=>{
    const el=e.target.closest('[data-track]'); if(!el||el.type==='submit') return;
    track('click',el.dataset.track);
    try{ if(window.goatcounter&&goatcounter.count) goatcounter.count({path:'click-'+el.dataset.track,event:true}); }catch(e){}
  });
  const viewOf=()=>((location.hash.startsWith('#/')?location.hash.slice(2).split('/')[0]:'')||'home');
  window.addEventListener('hashchange',()=>{ if(location.hash.startsWith('#/')||!location.hash) track('view',viewOf()); });

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

  // The full sign-up form is shared across pages; hide it where the page already has its own
  const sharedSignup=document.getElementById('signup');
  const routeSignup=()=>{ const pg=(location.hash.startsWith('#/')?location.hash.slice(2).split('/')[0]:'')||'home'; if(sharedSignup) sharedSignup.hidden=(pg==='home'||pg==='volunteer'); };
  window.addEventListener('hashchange',routeSignup); routeSignup();

  window.addEventListener('hashchange',route); route();
  track('view',viewOf());

  // In-page jumps (sign-up forms). If the target lives on another page, open that page first.
  document.querySelectorAll('a[href^="#"]:not([href^="#/"])').forEach(a=>a.addEventListener('click',e=>{
    const target=document.getElementById(a.getAttribute('href').slice(1)); if(!target) return;
    e.preventDefault();
    const view=target.closest('.view');
    if(view&&view.hidden) location.hash='#/'+view.dataset.page;
    requestAnimationFrame(()=>{
      target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      const f=target.querySelector('input[type=email]'); if(f) setTimeout(()=>f.focus({preventScroll:true}),400);
    });
  }));

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

  const r=document.getElementById('hrs'),f=document.getElementById('fill'),o=document.getElementById('hrs-out');
  function upd(){
    const h=+r.value; f.style.width=(h/45*100)+'%';
    o.textContent=h===0?'Your first visit is the first step.'
      :h<20?h+' hours. '+(20-h)+' more until you can get a key.'
      :h<40?h+' hours. You can get a key. '+(40-h)+' more to vote.'
      :h+' hours. You’re a Gardener with voting rights.';
  }
  r.addEventListener('input',upd); upd();

  // Years running
  const yEl=document.getElementById('years'); if(yEl) yEl.textContent=String(new Date().getFullYear()-1973);

  // Buttons that pre-select an interest on the sign-up form
  document.querySelectorAll('a[data-interest]').forEach(a=>a.addEventListener('click',()=>{
    const box=document.querySelector('#signup-form input[value="'+a.dataset.interest+'"]');
    if(box) box.checked=true;
    setTimeout(()=>document.getElementById('su-email').focus({preventScroll:true}),400);
  }));

  // Copy mailing address
  const addr='Green Guerillas\n307 7th Avenue, Room 1601\nNew York, NY 10001';
  document.getElementById('copy-addr').addEventListener('click',async()=>{
    const m=document.getElementById('copy-msg');
    try{await navigator.clipboard.writeText(addr);m.textContent='Address copied. Remember “Liz Christy” on the memo line.';}
    catch(e){
      const range=document.createRange();range.selectNodeContents(document.querySelector('.mail address'));
      const sel=getSelection();sel.removeAllRanges();sel.addRange(range);
      m.textContent='Address selected. Press Ctrl+C or ⌘C to copy.';
    }
  });

  // Sign-up capture
  const form=document.getElementById('signup-form'), msg=document.getElementById('su-msg'), btn=document.getElementById('su-submit');
  const okEmail=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  async function saveSignup(entry){
    const db=dbP?await dbP:null, user=userP?await userP:null;
    if(!db||!user) throw {code:'not_granted'};
    const ref=db.doc('signups/'+await user.id());
    let prev={}; try{const snap=await ref.get(); if(snap.exists) prev=snap.data()||{};}catch(e){}
    entry.interests=[...new Set([...(prev.interests||[]),...entry.interests])];
    await ref.set(Object.assign({},prev,entry));
    track('signup');
    try{ if(window.goatcounter&&goatcounter.count) goatcounter.count({path:'signup-'+entry.page,event:true}); }catch(e){}
  }
  const failText=e=>e&&e.code==='quota_exceeded'?'The list is full right now. Please tell a gardener during open hours.'
    :'We couldn’t save that here. Please share your email with the gardener on duty during open hours.';
  document.querySelectorAll('.quick-signup').forEach(qf=>qf.addEventListener('submit',async ev=>{
    ev.preventDefault();
    const inp=qf.querySelector('input[type=email]'), m=qf.querySelector('.form-msg'), b=qf.querySelector('button');
    const email=inp.value.trim(); m.className='form-msg';
    if(!okEmail(email)){inp.setAttribute('aria-invalid','true');m.textContent='Please enter a valid email address.';inp.focus();return;}
    inp.removeAttribute('aria-invalid'); b.disabled=true; m.textContent='Saving…';
    try{
      await saveSignup({email,interests:[qf.dataset.interest],source:'unspecified',page:qf.closest('.view').dataset.page,createdAt:new Date().toISOString()});
      m.className='form-msg ok'; m.textContent='Thanks! You’re on the list.'; qf.reset();
    }catch(e){m.textContent=failText(e);}finally{b.disabled=false;}
  }));
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    const email=form.email.value.trim();
    msg.className='form-msg';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
      form.email.setAttribute('aria-invalid','true'); msg.textContent='Please enter a valid email address.'; form.email.focus(); return;
    }
    form.email.removeAttribute('aria-invalid');
    const entry={email,name:form.name.value.trim(),interests:[...form.querySelectorAll('input[name=interest]:checked')].map(i=>i.value),source:form.source.value||'unspecified',page:'redesign',createdAt:new Date().toISOString()};
    btn.disabled=true; msg.textContent='Saving…';
    try{
      entry.page='donate';
      await saveSignup(entry);
      msg.className='form-msg ok';
      msg.textContent='Thanks'+(entry.name?', '+entry.name:'')+'! You’re on the list.';
      form.reset(); form.querySelector('input[value=news]').checked=true;
    }catch(e){
      msg.textContent=failText(e);
    }finally{ btn.disabled=false; }
  });
})();
