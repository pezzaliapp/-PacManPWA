// Pac‑Man PWA — v1 (MIT) — by pezzaliAPP
(()=>{
  'use strict';

  // ===== Canvas & HUD =====
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const toastEl = document.getElementById('toast');
  const btnPlayPause = document.getElementById('btnPlayPause');
  const btnRestart = document.getElementById('btnRestart');

  // HiDPI scaling
  function fitHiDPI(){
    const ratio = Math.max(1, Math.min(3, Math.floor(window.devicePixelRatio||1)));
    const { clientWidth, clientHeight } = cvs;
    cvs.width = clientWidth * ratio;
    cvs.height = clientHeight * ratio;
    ctx.setTransform(ratio,0,0,ratio,0,0);
  }
  window.addEventListener('resize', fitHiDPI);

  // ===== Load maze.txt =====
  let rows = [];
  let H=0,W=0;
  let pacStart = {x:1,y:1};
  let ghostStarts = [];
  let pellets = []; // {x,y,power,eaten:false}
  let gates = new Set(); // positions of '-' (string key "x,y")
  let tunnels = new Set(); // 'X'

  const WALLCH='#';
  const EMPTYCH=' ';
  const DOT='.';
  const POWER='o';
  const GHOST='G';
  const PAC='P';
  const TUN='X';
  const GATE='-';

  function k(x,y){ return `${x},${y}`; }

  async function loadMaze(){
    const txt = await fetch('maze.txt').then(r=>r.text());
    rows = txt.replace(/\r/g,'').split('\n').filter(Boolean);
    // normalize width
    W = Math.max(...rows.map(r=>r.length));
    rows = rows.map(r=> r.padEnd(W, ' '));
    H = rows.length;

    // scan
    pellets = [];
    gates = new Set();
    tunnels = new Set();
    ghostStarts = [];
    for (let y=0;y<H;y++){
      for (let x=0;x<W;x++){
        const c = rows[y][x];
        if (c===PAC){ pacStart={x,y}; }
        else if (c===GHOST){ ghostStarts.push({x,y}); }
        else if (c===DOT){ pellets.push({x,y,power:false,eaten:false}); }
        else if (c===POWER){ pellets.push({x,y,power:true,eaten:false}); }
        else if (c===GATE){ gates.add(k(x,y)); }
        else if (c===TUN){ tunnels.add(k(x,y)); }
      }
    }

    // if no power pellets in file, add four corners as power where there are dots
    const candidates = [
      {x:1,y:1},{x:W-2,y:1},{x:1,y:H-2},{x:W-2,y:H-2}
    ];
    const repl = [];
    for (const c of candidates){
      const p = pellets.find(p=>p.x===c.x && p.y===c.y);
      if (p){ p.power=true; }
    }
  }

  function isWall(x,y){
    const c = (rows[y]||'')[x]||' ';
    return c===WALLCH || c===EMPTYCH || gates.has(k(x,y));
  }
  function passableForPac(x,y){
    const c = (rows[y]||'')[x]||' ';
    if (gates.has(k(x,y))) return false;
    return !isWall(x,y);
  }
  function passableForGhost(x,y){
    const c = (rows[y]||'')[x]||' ';
    if (c===GHOST || c===EMPTYCH) return true;
    if (gates.has(k(x,y))) return false; // keep simple
    return !isWall(x,y);
  }
  function pelletAt(x,y){
    return pellets.find(p=>p.x===x && p.y===y && !p.eaten);
  }
  function wrap(x,y){
    if (tunnels.has(k(x,y))){
      // teleport to the opposite tunnel with same y
      for (const t of tunnels){
        const [tx,ty] = t.split(',').map(Number);
        if (ty===y && tx!==x){ return {x:tx,y:ty}; }
      }
    }
    if (x<0) x=W-1;
    if (x>=W) x=0;
    return {x,y};
  }

  // ===== Game state =====
  const S = { score:0, lives:3, level:1, paused:false, over:false };
  function updateHUD(){
    scoreEl.textContent = S.score;
    livesEl.textContent = S.lives;
    levelEl.textContent = S.level;
  }
  function toast(msg, ms=1000){
    toastEl.textContent = msg;
    toastEl.style.display='block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(()=> toastEl.style.display='none', ms);
  }

  // Entities
  function makeEntity(x,y,speed,color){
    return { x, y, dir:{x:0,y:0}, sub:0, speed, color, frightened:0, dead:false, spawnX:x, spawnY:y };
  }
  const pac = makeEntity(0,0,0.11,'#ffdd00');
  let ghosts = [];

  let intent = {x:0,y:0};
  function setIntent(x,y){ intent={x,y}; }

  // Input
  window.addEventListener('keydown', (e)=>{
    const k = e.key.toLowerCase();
    if (k==='arrowup' || k==='w') setIntent(0,-1);
    else if (k==='arrowdown' || k==='s') setIntent(0,1);
    else if (k==='arrowleft' || k==='a') setIntent(-1,0);
    else if (k==='arrowright' || k==='d') setIntent(1,0);
    else if (k===' '){ togglePause(); }
  });
  [['btnUp',0,-1],['btnDown',0,1],['btnLeft',-1,0],['btnRight',1,0]].forEach(([id,dx,dy])=>{
    const el = document.getElementById(id);
    const on = (ev)=>{ ev.preventDefault(); setIntent(dx,dy); };
    el.addEventListener('touchstart', on, {passive:false});
    el.addEventListener('touchend', on, {passive:false});
    el.addEventListener('click', on);
  });
  btnPlayPause.addEventListener('click', ()=> togglePause());
  btnRestart.addEventListener('click', ()=> restart());

  function togglePause(){
    if (S.over) return;
    S.paused = !S.paused;
    btnPlayPause.textContent = S.paused ? '▶︎ Riprendi' : '⏸ Pausa';
    toast(S.paused ? 'Pausa' : 'Riprendi');
  }

  function restart(){
    S.score=0; S.lives=3; S.level=1; S.over=false; S.paused=false;
    pellets.forEach(p=> p.eaten=false);
    resetPositions();
    btnPlayPause.textContent='⏸ Pausa';
    updateHUD();
  }

  function resetPositions(){
    pac.x=pacStart.x; pac.y=pacStart.y; pac.dir={x:-1,y:0}; pac.sub=0; pac.frightened=0;
    ghosts = [];
    const GPROPS = [
      {name:'Blinky', color:'#ff4d4d', speed:0.10, bias:1.0},
      {name:'Pinky',  color:'#ff94d6', speed:0.095, bias:0.8},
      {name:'Inky',   color:'#6de1ff', speed:0.092, bias:0.6},
      {name:'Clyde',  color:'#ffb84d', speed:0.090, bias:0.3},
    ];
    for (let i=0;i<Math.min(4, Math.max(1, ghostStarts.length)); i++){
      const s = ghostStarts[i] || pacStart;
      const g = Object.assign(makeEntity(s.x, s.y, GPROPS[i].speed, GPROPS[i].color), {name:GPROPS[i].name, bias:GPROPS[i].bias});
      ghosts.push(g);
    }
  }

  // Movement helpers
  function canMovePac(x,y,dx,dy){
    const nx=x+dx, ny=y+dy;
    return passableForPac(nx,ny);
  }
  function canMoveGhost(x,y,dx,dy){
    const nx=x+dx, ny=y+dy;
    return passableForGhost(nx,ny);
  }

  function stepEntity(e, canMove){
    // Move forward, do not use player intent here.
    if (!canMove(e.x,e.y,e.dir.x,e.dir.y)){
      e.dir = {x:0,y:0};
    }
    e.sub += e.speed;
    if (e.sub>=1){
      e.x += e.dir.x; e.y += e.dir.y; e.sub=0;
      const w = wrap(e.x,e.y);
      e.x=w.x; e.y=w.y;
    }
  };
        }
      }
      if (!canMove(e.x,e.y,e.dir.x,e.dir.y)){
        e.dir={x:0,y:0};
      }
    }
    e.sub += e.speed;
    if (e.sub>=1){
      e.x += e.dir.x; e.y += e.dir.y; e.sub=0;
      const w = wrap(e.x,e.y);
      e.x=w.x; e.y=w.y;
    }
  }

  function stepPac(){
    // Turn on tile center if possible
    if (pac.sub<=0){
      if (intent.x||intent.y){
        if (canMovePac(pac.x,pac.y,intent.x,intent.y)){
          pac.dir = {x:intent.x, y:intent.y};
        }
      }
      if (!canMovePac(pac.x,pac.y,pac.dir.x,pac.dir.y)){
        pac.dir = {x:0,y:0};
      }
    }
    // Move
    pac.sub += pac.speed;
    if (pac.sub>=1){
      pac.x += pac.dir.x; pac.y += pac.dir.y; pac.sub=0;
      const w = wrap(pac.x,pac.y);
      pac.x=w.x; pac.y=w.y;
    }
    // Eat
    const p = pelletAt(pac.x,pac.y);
    if (p && !p.eaten){
      p.eaten=true;
      const add = p.power ? 50 : 10;
      S.score += add;
      if (p.power){
        ghosts.forEach(g=> g.frightened = 6 + (S.level-1));
        toast('Power-pill!');
      }
      updateHUD();
      if (pellets.every(p=>p.eaten)){
        S.level++;
        pellets.forEach(p=> p.eaten=false);
        resetPositions();
        toast(`Livello ${S.level}`);
        updateHUD();
      }
    }
  }
      updateHUD();
      if (pellets.every(p=>p.eaten)){
        S.level++;
        pellets.forEach(p=> p.eaten=false);
        resetPositions();
        toast(`Livello ${S.level}`);
        updateHUD();
      }
    }
  }

  function ghostDir(g){
    // frightened: random
    if (g.frightened>0){
      const dirs = [{x:1,y:0},{x:-1,y:0},{x:0, y:1},{x:0, y:-1}]
        .filter(d=> canMoveGhost(g.x,g.y,d.x,d.y) && !(d.x===-g.dir.x && d.y===-g.dir.y));
      if (dirs.length===0) return {x:0,y:0};
      return dirs[Math.floor(Math.random()*dirs.length)];
    }
    // choose direction reducing distance to pac
    const dirs = [{x:1,y:0},{x:-1,y:0},{x:0, y:1},{x:0, y:-1}]
      .filter(d=> canMoveGhost(g.x,g.y,d.x,d.y) && !(d.x===-g.dir.x && d.y===-g.dir.y));
    if (dirs.length===0) return {x:0,y:0};
    let tx=pac.x, ty=pac.y;
    if (g.name==='Pinky'){ tx+=2*pac.dir.x; ty+=2*pac.dir.y; }
    if (g.name==='Inky'){
      const bl = ghosts[0]||g;
      tx = Math.round((bl.x+pac.x)/2);
      ty = Math.round((bl.y+pac.y)/2);
    }
    if (g.name==='Clyde'){
      const dist = Math.abs(g.x-pac.x)+Math.abs(g.y-pac.y);
      if (dist<6){ tx=1; ty=H-2; }
    }
    let best=dirs[0], bestScore=Infinity;
    for (const d of dirs){
      const nx=g.x+d.x, ny=g.y+d.y;
      const sc = Math.hypot(nx-tx, ny-ty) * (1 - 0.15*g.bias);
      if (sc<bestScore){ bestScore=sc; best=d; }
    }
    return best;
  }

  function stepGhost(g){
    if (g.sub<=0){
      const nd = ghostDir(g);
      if (nd.x||nd.y) g.dir=nd;
    }
    stepEntity(g, canMoveGhost);
    if (g.frightened>0) g.frightened -= 0.02;
  }
    stepEntity(g, canMoveGhost);
    if (g.frightened>0) g.frightened -= 0.02;
  }

  // ===== Rendering =====
  let TILE = 20, offsetX=0, offsetY=0;
  function computeScale(){
    // fit tiles
    TILE = Math.min( Math.floor(cvs.clientWidth / W), Math.floor(cvs.clientHeight / H) );
    if (TILE<10) TILE=10;
    offsetX = Math.floor((cvs.clientWidth - W*TILE)/2);
    offsetY = Math.floor((cvs.clientHeight - H*TILE)/2);
  }

  function drawMaze(){
    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,cvs.clientWidth, cvs.clientHeight);
    for (let y=0;y<H;y++){
      for (let x=0;x<W;x++){
        const ch = rows[y][x];
        const X = offsetX + x*TILE;
        const Y = offsetY + y*TILE;
        if (ch===WALLCH || ch===EMPTYCH){
          ctx.fillStyle = '#0b2b99';
          ctx.fillRect(X, Y, TILE, TILE);
          ctx.fillStyle = '#133bbb';
          ctx.fillRect(X+2, Y+2, TILE-4, TILE-4);
        }
      }
    }
    // pellets
    for (const p of pellets){
      if (p.eaten) continue;
      const X = offsetX + p.x*TILE + TILE/2;
      const Y = offsetY + p.y*TILE + TILE/2;
      ctx.fillStyle = p.power ? '#9df' : '#ffd';
      const r = p.power ? TILE*0.18 : TILE*0.10;
      ctx.beginPath();
      ctx.arc(X,Y,r,0,Math.PI*2);
      ctx.fill();
    }
  }

  let anim = 0;
  function drawPac(){
    const X = offsetX + (pac.x + pac.sub*pac.dir.x)*TILE + TILE/2;
    const Y = offsetY + (pac.y + pac.sub*pac.dir.y)*TILE + TILE/2;
    const mouth = (Math.sin(anim*0.25)+1)/2 * 0.6 + 0.2;
    let angle=0;
    if (pac.dir.x===1) angle=0;
    else if (pac.dir.x===-1) angle=Math.PI;
    else if (pac.dir.y===1) angle=Math.PI/2;
    else if (pac.dir.y===-1) angle=-Math.PI/2;
    ctx.fillStyle = '#ffdd00';
    ctx.beginPath();
    ctx.moveTo(X,Y);
    ctx.arc(X,Y,TILE*0.45, angle+mouth, angle+Math.PI*2-mouth);
    ctx.closePath();
    ctx.fill();
    // eye
    ctx.fillStyle='#000';
    ctx.beginPath();
    ctx.arc(X + Math.cos(angle-Math.PI/2)*TILE*0.15, Y + Math.sin(angle-Math.PI/2)*TILE*0.15, TILE*0.06, 0, Math.PI*2);
    ctx.fill();
  }

  function drawGhost(g){
    const X = offsetX + (g.x + g.sub*g.dir.x)*TILE + TILE/2;
    const Y = offsetY + (g.y + g.sub*g.dir.y)*TILE + TILE/2;
    ctx.fillStyle = g.frightened>0 ? '#2fd3ff' : g.color;
    // body
    ctx.beginPath();
    ctx.arc(X, Y, TILE*0.45, Math.PI, 0);
    ctx.lineTo(X+TILE*0.45, Y+TILE*0.4);
    for (let i=0;i<4;i++){
      ctx.lineTo(X+TILE*0.45 - i*TILE*0.3, Y+TILE*0.45);
      ctx.lineTo(X+TILE*0.30 - i*TILE*0.3, Y+TILE*0.35);
    }
    ctx.closePath(); ctx.fill();
    // eyes
    ctx.fillStyle='#fff';
    ctx.beginPath(); ctx.arc(X-TILE*0.15,Y-TILE*0.1,TILE*0.12,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(X+TILE*0.15,Y-TILE*0.1,TILE*0.12,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#000';
    ctx.beginPath(); ctx.arc(X-TILE*0.12 + g.dir.x*TILE*0.05,Y-TILE*0.1 + g.dir.y*TILE*0.05,TILE*0.06,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(X+TILE*0.18 + g.dir.x*TILE*0.05,Y-TILE*0.1 + g.dir.y*TILE*0.05,TILE*0.06,0,Math.PI*2); ctx.fill();
  }

  function collide(){
    for (const g of ghosts){
      if (g.x===pac.x && g.y===pac.y){
        if (g.frightened>0){
          S.score += 200;
          g.x=g.spawnX; g.y=g.spawnY; g.frightened=0; g.sub=0; g.dir={x:0,y:0};
          toast('Ghost! +200');
          updateHUD();
        }else{
          S.lives--;
          updateHUD();
          if (S.lives<=0){
            S.over=true; S.paused=true;
            toast('Game Over', 2000);
          }else{
            toast('Oops! -1 vita', 1000);
            resetPositions();
          }
        }
        break;
      }
    }
  };
          toast('Ghost! +200');
          updateHUD();
        }else{
          // lose life
          S.lives--;
          updateHUD();
          if (S.lives<=0){
            S.over=true; S.paused=true;
            toast('Game Over', 2000);
          }else{
            toast('Oops! -1 vita', 1000);
            resetPositions();
          }
        }
        break;
      }
    }
  }

  // ===== Main loop =====
  function tick(){
    if (!S.paused && !S.over){
      stepPac();
      for (const g of ghosts) stepGhost(g);
      collide();
      anim++;
    }
    // draw
    computeScale();
    fitHiDPI();
    drawMaze();
    drawPac();
    for (const g of ghosts) drawGhost(g);
    requestAnimationFrame(tick);
  }

  // ===== Boot =====
  (async function init(){
    await loadMaze();
    updateHUD();
    resetPositions();
    requestAnimationFrame(tick);
  })();

})();
