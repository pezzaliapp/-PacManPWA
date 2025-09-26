// Pac-Man PWA — v1 (MIT) — by pezzaliAPP
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

  // ===== Maze / Tiles =====
  let rows = [];
  let H=0, W=0;
  let pacStart = {x:1,y:1};
  let ghostStarts = [];
  let pellets = [];            // {x,y,power,eaten:false}
  let gates = new Set();       // '-'  (string key "x,y")
  let tunnels = new Set();     // 'X'
  let gateInfo = null;         // {y, xMin, xMax, midX}

  const WALLCH = '#';
  const DOT    = '.';
  const POWER  = 'o';
  const GHOST  = 'G';
  const PAC    = 'P';
  const TUN    = 'X';
  const GATE   = '-';

  const FALLBACK_MAZE = `############################
#............##............#
#.####.#####.##.#####.####.#
#X####.#####.##.#####.####X#
#..........................#
#.####.##.########.##.####.#
#......##....##....##......#
######.##### ## #####.######
     #.##          ##.#
     #.## ###--### ##.#
######.## # GGGG # ##.######
      .   # GGGG #   .      
######.## # GGGG # ##.######
     #.## ######## ##.#
     #.##    P     ##.#     
######.## ######## ##.######
#............##............#
#.####.#####.##.#####.####.#
#X..##................##..X#
###.##.##.########.##.##.###
#......##....##....##......#
#.##########.##.##########.#
#..........................#
############################`;

  const k = (x,y)=>`${x},${y}`;

  // Carica maze.txt con fallback integrato
  async function loadMaze(){
    let txt = '';
    try{
      const r = await fetch('maze.txt', {cache:'no-store'});
      if(!r.ok) throw new Error('maze.txt HTTP '+r.status);
      txt = await r.text();
    }catch(err){
      console.warn('maze.txt load failed, using fallback', err);
      txt = FALLBACK_MAZE;
    }

    rows = txt.replace(/\r/g,'').split('\n').filter(Boolean);
    W = Math.max(...rows.map(r=>r.length));
    rows = rows.map(r=> r.padEnd(W, ' '));
    H = rows.length;

    pellets = [];
    gates = new Set();
    tunnels = new Set();
    ghostStarts = [];
    pacStart = {x:1,y:1};
    gateInfo = null;

    for (let y=0;y<H;y++){
      for (let x=0;x<W;x++){
        const c = rows[y][x];
        if (c===PAC)    pacStart = {x,y};
        else if (c===GHOST) ghostStarts.push({x,y});
        else if (c===DOT)   pellets.push({x,y,power:false,eaten:false});
        else if (c===POWER) pellets.push({x,y,power:true, eaten:false});
        else if (c===GATE)  gates.add(k(x,y));
        else if (c===TUN)   tunnels.add(k(x,y));
      }
    }
    // Assicura almeno qualche power-pill
    if (!pellets.some(p=>p.power)){
      [{x:1,y:1},{x:W-2,y:1},{x:1,y:H-2},{x:W-2,y:H-2}]
        .forEach(c=>{ const p = pellets.find(p=>p.x===c.x && p.y===c.y); if (p) p.power = true; });
    }

    // Calcola info del gate (assumiamo un’unica riga di '-')
    if (gates.size){
      const coords = [...gates].map(s=>s.split(',').map(Number));
      const y = coords[0][1];
      const xs = coords.filter(([_,gy])=>gy===y).map(([gx])=>gx);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const midX = Math.round((xMin + xMax)/2);
      gateInfo = { y, xMin, xMax, midX };
    }
  }

  // Solo '#' sono muri
  function isWall(x,y){
    const c = (rows[y]||'')[x]||' ';
    return c === WALLCH;
  }

  // Pac NON attraversa il gate '-'
  function passableForPac(x,y){
    if (x<0||y<0||y>=H||x>=W) return false;
    if (gates.has(k(x,y))) return false;   // gate chiuso a Pac
    return !isWall(x,y);
  }

  // I fantasmi POSSONO attraversare il gate
  function passableForGhost(x,y){
    if (x<0||y<0||y>=H||x>=W) return false;
    if (gates.has(k(x,y))) return true;    // escono dalla casa
    return !isWall(x,y);
  }

  function pelletAt(x,y){
    return pellets.find(p=>p.x===x && p.y===y && !p.eaten);
  }

  function wrap(x,y){
    // Teletrasporto su 'X' allo stesso y
    if (tunnels.has(k(x,y))){
      for (const t of tunnels){
        const [tx,ty] = t.split(',').map(Number);
        if (ty===y && tx!==x) return {x:tx,y:ty};
      }
    }
    if (x<0) x=W-1;
    if (x>=W) x=0;
    return {x,y};
  }

  // ===== Game state =====
  const S = { score:0, lives:3, level:1, paused:false, over:false };
  const updateHUD = ()=>{
    scoreEl.textContent = S.score;
    livesEl.textContent = S.lives;
    levelEl.textContent = S.level;
  };
  function toast(msg, ms=1000){
    toastEl.textContent = msg;
    toastEl.style.display='block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(()=> toastEl.style.display='none', ms);
  }

  // ===== Entities =====
  function makeEntity(x,y,speed,color){
    return { x, y, dir:{x:0,y:0}, sub:0, speed, color, frightened:0, dead:false, spawnX:x, spawnY:y, inHouse:false };
  }
  const pac = makeEntity(0,0,0.11,'#ffdd00');
  let ghosts = [];

  // Input intent (solo Pac lo usa)
  let intent = {x:0,y:0};
  const setIntent = (x,y)=>{ intent = {x,y}; };

  // Input
  window.addEventListener('keydown', (e)=>{
    const k = e.key.toLowerCase();
    if (k==='arrowup' || k==='w') setIntent(0,-1);
    else if (k==='arrowdown' || k==='s') setIntent(0,1);
    else if (k==='arrowleft' || k==='a') setIntent(-1,0);
    else if (k==='arrowright' || k==='d') setIntent(1,0);
    else if (k===' ') togglePause();
  });
  [['btnUp',0,-1],['btnDown',0,1],['btnLeft',-1,0],['btnRight',1,0]].forEach(([id,dx,dy])=>{
    const el = document.getElementById(id);
    const on = (ev)=>{ ev.preventDefault(); setIntent(dx,dy); };
    el.addEventListener('touchstart', on, {passive:false});
    el.addEventListener('touchend', on,   {passive:false});
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
      const g = Object.assign(
        makeEntity(s.x, s.y, GPROPS[i].speed, GPROPS[i].color),
        {name:GPROPS[i].name, bias:GPROPS[i].bias}
      );
      g.inHouse = true;       // finché non supera il gate
      g.dir = {x:0, y:0};     // verrà deciso in stepGhost()
      ghosts.push(g);
    }
  }

  // ===== Movement helpers =====
  const canMovePac   = (x,y,dx,dy)=> passableForPac(x+dx, y+dy);
  const canMoveGhost = (x,y,dx,dy)=> passableForGhost(x+dx, y+dy);

  // stepEntity “muto” (non legge intent)
  function stepEntity(e, canMove){
    if (!canMove(e.x,e.y,e.dir.x,e.dir.y)) e.dir = {x:0,y:0};
    e.sub += e.speed;
    if (e.sub>=1){
      e.x += e.dir.x; e.y += e.dir.y; e.sub=0;
      const w = wrap(e.x,e.y);
      e.x=w.x; e.y=w.y;
    }
  }

  function stepPac(){
    // turn su centro-tile
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
    // muovi
    pac.sub += pac.speed;
    if (pac.sub>=1){
      pac.x += pac.dir.x; pac.y += pac.dir.y; pac.sub=0;
      const w = wrap(pac.x,pac.y);
      pac.x=w.x; pac.y=w.y;
    }
    // eat
    const p = pelletAt(pac.x,pac.y);
    if (p && !p.eaten){
      p.eaten=true;
      S.score += p.power ? 50 : 10;
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

  function ghostDir(g){
    // Fase release: allineati al centro del gate e poi esci verso l'alto
    if (g.inHouse && gateInfo){
      const gx = g.x, gy = g.y, mid = gateInfo.midX, gateY = gateInfo.y;
      if (gy <= gateY-1){
        // ha superato il gate
        g.inHouse = false;
      } else {
        if (gx < mid && canMoveGhost(gx,gy,1,0))  return {x:1,y:0};   // vai verso dx
        if (gx > mid && canMoveGhost(gx,gy,-1,0)) return {x:-1,y:0};  // vai verso sx
        if (canMoveGhost(gx,gy,0,-1)) return {x:0,y:-1};              // poi su attraverso il gate
        // fallback: prova altre direzioni percorribili per non restare fermo
        const alt = [{x:0
