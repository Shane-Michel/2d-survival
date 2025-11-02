// ===================
    // Utility / RNG (seedable)
    // ===================
    function mulberry32(a){return function(){var t=a+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296}};
    function clamp(v,min,max){return v<min?min:v>max?max:v}
    function lerp(a,b,t){return a+(b-a)*t}

    // ===================
    // World config
    // ===================
    const TILE=32;
    const MAP_W=120, MAP_H=120; // large scrolling map
    const T = {
      GRASS:0, TREE:1, ROCK:2, WATER:3, TILLED:4, CROP:5, ROAD:6
    };
    const TILE_COLORS = {
      [T.GRASS]: '#1b4d2b',
      [T.TREE] : '#134e2a',
      [T.ROCK] : '#4b5563',
      [T.WATER]: '#1d4ed8',
      [T.TILLED]:'#7c3f18',
      [T.CROP] : '#84cc16',
      [T.ROAD] : '#57534e',
    };

    const RESPAWN_DAYS = { TREE: 3, ROCK: 7 };

    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    let zoom=1.2;
    let cam = {x:0,y:0};

    const state = {
      day:1, time:6*60, // minutes since midnight
      world:[], features:[], crops:[], // arrays per tile
      player:{x:MAP_W*TILE/2, y:MAP_H*TILE/2, speed:140},
      mode:'gather',
      toolIndex:0,
      inventory:{ wood:0, stone:0, seeds:4, food:0 },
      buildings:[],
    };

    const Tools=[
      {id:'hand', name:'Hand'},
      {id:'hoe', name:'Hoe'},
      {id:'seeder', name:'Seeder'},
      {id:'pick', name:'Pickaxe'},
      {id:'axe', name:'Axe'},
    ];

    const Buildings=[
      {id:'hut', name:'Hut', w:2, h:2, cost:{wood:10, stone:5}},
      {id:'field', name:'Field', w:2, h:2, cost:{wood:2}},
      {id:'road', name:'Road', w:1, h:1, cost:{stone:1}},
      {id:'silo', name:'Silo', w:2, h:2, cost:{wood:6, stone:6}},
      {id:'well', name:'Well', w:1, h:1, cost:{stone:5}},
    ];

    const UI = {
      modeLabel: document.getElementById('modeLabel'),
      toolLabel: document.getElementById('toolLabel'),
      inv: document.getElementById('inv'),
      buildGrid: document.getElementById('buildGrid'),
      log: document.getElementById('log'),
      dayLabel: document.getElementById('dayLabel'),
      clockLabel: document.getElementById('clockLabel'),
      dayMeter: document.getElementById('dayMeter'),
      saveBtn: document.getElementById('saveBtn'),
      loadBtn: document.getElementById('loadBtn'),
      resetBtn: document.getElementById('resetBtn'),
      centerBtn: document.getElementById('centerBtn'),
      guideBtn: document.getElementById('guideBtn'),
      guideContent: document.getElementById('guideContent'),
    };

    const LOG_LIMIT = 80;
    const logEntries = [];

    function log(msg){
      logEntries.unshift(`[Day ${state.day} ${fmtClock(state.time)}] ${msg}`);
      if(logEntries.length>LOG_LIMIT) logEntries.length = LOG_LIMIT;
      UI.log.textContent = logEntries.join('\n');
    }

    function fmtClock(mins){
      let h=Math.floor(mins/60)%24, m=mins%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    }

    // ===================
    // World generation
    // ===================
    function genWorld(seed=12345){
      const rnd = mulberry32(seed);
      state.world = new Array(MAP_W*MAP_H).fill(T.GRASS);
      state.features = new Array(MAP_W*MAP_H).fill(null); // respawn timers etc.
      state.crops = new Array(MAP_W*MAP_H).fill(null);
      logEntries.length = 0;
      UI.log.textContent = '';

      // Simple blobs for water
      for(let i=0;i<28;i++){
        const cx=Math.floor(rnd()*MAP_W), cy=Math.floor(rnd()*MAP_H);
        const r=3+Math.floor(rnd()*7);
        blob(cx,cy,r,T.WATER);
      }
      // Trees
      for(let i=0;i<500;i++){
        const x=Math.floor(rnd()*MAP_W), y=Math.floor(rnd()*MAP_H);
        if (getTile(x,y)!==T.WATER && rnd()<0.65) setTile(x,y,T.TREE);
      }
      // Rocks
      for(let i=0;i<280;i++){
        const x=Math.floor(rnd()*MAP_W), y=Math.floor(rnd()*MAP_H);
        if (getTile(x,y)===T.GRASS && rnd()<0.7) setTile(x,y,T.ROCK);
      }
      // Clear spawn area
      const sx=Math.floor(MAP_W/2), sy=Math.floor(MAP_H/2);
      for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++) if(inBounds(sx+x,sy+y)) setTile(sx+x,sy+y,T.GRASS);
      state.player.x = sx*TILE+TILE/2; state.player.y=sy*TILE+TILE/2;
      log('New world generated. Welcome!');
    }

    function inBounds(x,y){return x>=0&&y>=0&&x<MAP_W&&y<MAP_H}
    function idx(x,y){return y*MAP_W+x}
    function getTile(x,y){return state.world[idx(x,y)]}
    function setTile(x,y,v){state.world[idx(x,y)]=v}
    function setFeature(x,y,data){state.features[idx(x,y)] = data ? {...data} : null;}
    function getFeature(x,y){return state.features[idx(x,y)];}
    function blob(cx,cy,r,type){
      for(let y=-r;y<=r;y++)for(let x=-r;x<=r;x++){
        if(x*x+y*y<=r*r&&inBounds(cx+x,cy+y)) setTile(cx+x,cy+y,type);
      }
    }

    // ===================
    // Rendering
    // ===================
    function draw(){
      const w=canvas.width, h=canvas.height;
      ctx.clearRect(0,0,w,h);
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.scale(zoom, zoom);
      ctx.translate(-cam.x, -cam.y);

      // Sky color changes with day time
      const sky = lerpColor([10,15,26],[60,80,120], dayLightFactor());
      canvas.style.background = `rgb(${sky[0]},${sky[1]},${sky[2]})`;

      // visible bounds
      const halfW = (w/2)/zoom, halfH=(h/2)/zoom;
      const minX = Math.floor((cam.x-halfW)/TILE)-1;
      const minY = Math.floor((cam.y-halfH)/TILE)-1;
      const maxX = Math.ceil((cam.x+halfW)/TILE)+1;
      const maxY = Math.ceil((cam.y+halfH)/TILE)+1;

      for(let y=minY;y<=maxY;y++){
        for(let x=minX;x<=maxX;x++){
          if(!inBounds(x,y)) continue;
          const t = getTile(x,y);
          ctx.fillStyle = TILE_COLORS[t]||'#222';
          ctx.fillRect(x*TILE, y*TILE, TILE, TILE);
          // subtle grid
          ctx.strokeStyle='rgba(0,0,0,.15)';
          ctx.strokeRect(x*TILE+0.5, y*TILE+0.5, TILE-1, TILE-1);

          // crops: draw growth
          const c = state.crops[idx(x,y)];
          if(c){
            const g = clamp(c.growth/100,0,1);
            ctx.fillStyle = `rgba(180,255,120,${0.3+0.6*g})`;
            ctx.fillRect(x*TILE+6, y*TILE+6, TILE-12, TILE-12);
          }
        }
      }

      // buildings
      for(const b of state.buildings){
        ctx.save();
        ctx.translate(b.x*TILE, b.y*TILE);
        drawBuilding(b);
        ctx.restore();
      }

      // player
      ctx.save();
      ctx.translate(state.player.x, state.player.y);
      const pSize=14;
      ctx.fillStyle = '#eab308';
      ctx.beginPath(); ctx.arc(0,0,pSize,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth=2; ctx.stroke();
      ctx.restore();

      ctx.restore();
    }

    function drawBuilding(b){
      ctx.fillStyle = '#9ca3af';
      switch(b.id){
        case 'hut':
          ctx.fillStyle = '#9b6b43';
          ctx.fillRect(0,0,b.w*TILE,b.h*TILE);
          ctx.fillStyle = '#3f2f23'; ctx.fillRect(TILE*0.7,TILE*1.2,TILE*0.6,TILE*0.8);
          break;
        case 'field':
          ctx.fillStyle = '#7c3f18';
          ctx.fillRect(0,0,b.w*TILE,b.h*TILE);
          ctx.strokeStyle = 'rgba(0,0,0,.3)';
          for(let y=0;y<b.h;y++){ for(let x=0;x<b.w;x++){ ctx.strokeRect(x*TILE+4,y*TILE+4,TILE-8,TILE-8); } }
          break;
        case 'road':
          ctx.fillStyle = TILE_COLORS[T.ROAD]; ctx.fillRect(0,0,TILE,TILE);
          ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.moveTo(0,TILE/2); ctx.lineTo(TILE,TILE/2); ctx.stroke();
          break;
        case 'silo':
          ctx.fillStyle = '#9ca3af'; ctx.fillRect(0,0,b.w*TILE,b.h*TILE);
          ctx.fillStyle = '#6b7280'; ctx.fillRect(TILE*0.2, TILE*0.2, b.w*TILE-TILE*0.4, b.h*TILE-TILE*0.4);
          break;
        case 'well':
          ctx.fillStyle = '#6b7280'; ctx.beginPath(); ctx.arc(TILE*0.5,TILE*0.5,TILE*0.4,0,Math.PI*2); ctx.fill();
          ctx.fillStyle = '#1d4ed8'; ctx.beginPath(); ctx.arc(TILE*0.5,TILE*0.5,TILE*0.25,0,Math.PI*2); ctx.fill();
          break;
      }
    }

    function dayLightFactor(){
      const t = state.time%1440; // minutes
      // peak at noon, low at midnight
      const rad = (t/1440)*Math.PI*2;
      return 0.2 + 0.8 * Math.max(0, Math.sin(rad- Math.PI/2));
    }
    function lerpColor(a,b,t){return [Math.round(lerp(a[0],b[0],t)),Math.round(lerp(a[1],b[1],t)),Math.round(lerp(a[2],b[2],t))]}

    // ===================
    // Input & camera
    // ===================
    const keys={};
    window.addEventListener('keydown',e=>{keys[e.key]=true; if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();});
    window.addEventListener('keyup',e=>{keys[e.key]=false});
    canvas.addEventListener('wheel',e=>{ zoom = clamp(zoom + (e.deltaY>0?-0.05:0.05), 0.6, 2.2); });

    canvas.addEventListener('mousedown',e=>{
      const world = screenToWorld(e.offsetX,e.offsetY);
      const tx=Math.floor(world.x/TILE), ty=Math.floor(world.y/TILE);
      if(!inBounds(tx,ty)) return;
      if(state.mode==='build'){ tryPlaceSelected(tx,ty); return; }
      // gather / farming
      const tool = Tools[state.toolIndex].id;
      const cur = getTile(tx,ty);
      if(tool==='axe' && cur===T.TREE){ setTile(tx,ty,T.GRASS); state.inventory.wood+=2+Math.floor(Math.random()*2); setFeature(tx,ty,{timer:RESPAWN_DAYS.TREE,type:T.TREE}); log('Chopped tree: +wood'); }
      else if(tool==='pick' && cur===T.ROCK){ setTile(tx,ty,T.GRASS); state.inventory.stone+=1+Math.floor(Math.random()*3); setFeature(tx,ty,{timer:RESPAWN_DAYS.ROCK,type:T.ROCK}); log('Mined rock: +stone'); }
      else if(tool==='hoe' && cur===T.GRASS){ setTile(tx,ty,T.TILLED); setFeature(tx,ty,null); log('Tilled soil'); }
      else if(tool==='seeder' && cur===T.TILLED){ if(state.inventory.seeds>0){ state.inventory.seeds--; plantCrop(tx,ty); log('Planted a seed'); } else log('No seeds'); }
      else if(tool==='hand'){
        // harvest crop if grown
        const c = state.crops[idx(tx,ty)];
        if(c && c.growth>=100){ state.crops[idx(tx,ty)]=null; setTile(tx,ty,T.TILLED); setFeature(tx,ty,null); state.inventory.food+=1; state.inventory.seeds+=Math.random()<0.6?1:0; log('Harvested crop: +food'); }
      }
      updateInventoryUI();
    });

    function screenToWorld(sx,sy){
      const w=canvas.width,h=canvas.height;
      const x = (sx - w/2)/zoom + cam.x;
      const y = (sy - h/2)/zoom + cam.y;
      return {x,y};
    }

    // ===================
    // Farming / crops
    // ===================
    function plantCrop(x,y){
      state.crops[idx(x,y)] = {growth:0};
      setTile(x,y,T.CROP);
    }

    // ===================
    // Build system
    // ===================
    let buildSel = 0; let buildRot=0;
    function canAfford(cost){
      for(const k in cost){ if((state.inventory[k]||0) < cost[k]) return false }
      return true;
    }
    function pay(cost){ for(const k in cost){ state.inventory[k]-=cost[k] } }

    function tryPlaceSelected(tx,ty){
      const proto = Buildings[buildSel];
      // Check area
      for(let y=0;y<proto.h;y++) for(let x=0;x<proto.w;x++){
        const gx=tx+x, gy=ty+y; if(!inBounds(gx,gy)) return;
        const t = getTile(gx,gy); if(t===T.WATER || t===T.TREE || t===T.ROCK || hasBuildingAt(gx,gy)) return;
      }
      if(!canAfford(proto.cost)){ log('Not enough resources'); return; }
      pay(proto.cost);
      state.buildings.push({id:proto.id, x:tx, y:ty, w:proto.w, h:proto.h, rot:buildRot});
      for(let oy=0;oy<proto.h;oy++) for(let ox=0;ox<proto.w;ox++){ setFeature(tx+ox,ty+oy,null); }
      log(`Placed ${proto.name}`);
      // if road, paint tiles
      if(proto.id==='road') setTile(tx,ty,T.ROAD);
      updateInventoryUI();
    }

    function hasBuildingAt(tx,ty){
      return state.buildings.some(b=> tx>=b.x && tx<b.x+b.w && ty>=b.y && ty<b.y+b.h);
    }

    // ===================
    // UI wiring
    // ===================
    function renderBuildMenu(){
      UI.buildGrid.innerHTML='';
      Buildings.forEach((b,i)=>{
        const btn=document.createElement('button');
        btn.className='btn';
        btn.innerHTML=`${b.name}<div class="small">${Object.entries(b.cost).map(([k,v])=>`${v} ${k}`).join(', ')||'Free'}</div>`;
        btn.onclick=()=>{buildSel=i; state.mode='build'; UI.modeLabel.textContent='Build'; highlightButtons();}
        UI.buildGrid.appendChild(btn);
      });
      highlightButtons();
    }

    function highlightButtons(){
      [...UI.buildGrid.children].forEach((el,idx)=>{
        el.classList.toggle('primary', idx===buildSel && state.mode==='build');
      });
    }

    function updateInventoryUI(){
      UI.inv.innerHTML='';
      for(const [k,v] of Object.entries(state.inventory)){
        const card=document.createElement('div'); card.className='card';
        card.innerHTML=`<div class="row"><div class="title">${k}</div><div>${v}</div></div>`;
        UI.inv.appendChild(card);
      }
    }

    // Buttons
    UI.saveBtn.onclick = ()=>{ saveGame(); log('Game saved'); };
    UI.loadBtn.onclick = ()=>{ if(loadGame()) log('Game loaded'); else log('No save found'); };
    UI.resetBtn.onclick = ()=>{ genWorld(Date.now()%0x7fffffff); updateInventoryUI(); };
    UI.centerBtn.onclick = ()=> centerCamera();
    UI.guideBtn.onclick = ()=>{
      const hidden = UI.guideContent.hasAttribute('hidden');
      if(hidden){
        UI.guideContent.removeAttribute('hidden');
        UI.guideBtn.innerHTML = '<span>Hide Guide</span>';
      }else{
        UI.guideContent.setAttribute('hidden','');
        UI.guideBtn.innerHTML = '<span>Show Guide</span>';
      }
    };

    // Keyboard
    window.addEventListener('keydown',e=>{
      if(e.key==='b' || e.key==='B'){ state.mode = (state.mode==='build'?'gather':'build'); UI.modeLabel.textContent = state.mode==='build'?'Build':'Gather'; highlightButtons(); }
      if(e.key==='r' || e.key==='R'){ buildRot=(buildRot+1)%4 }
      if(e.key==='c' || e.key==='C'){ centerCamera(); }
      if(e.key==='q' || e.key==='Q'){ state.toolIndex=(state.toolIndex-1+Tools.length)%Tools.length; UI.toolLabel.textContent=Tools[state.toolIndex].name }
      if(e.key==='e' || e.key==='E'){ state.toolIndex=(state.toolIndex+1)%Tools.length; UI.toolLabel.textContent=Tools[state.toolIndex].name }
    });

    function centerCamera(){
      cam.x = state.player.x; cam.y = state.player.y;
    }

    // ===================
    // Game loop & systems
    // ===================
    let last=performance.now();
    function tick(){
      const now=performance.now();
      const dt=(now-last)/1000; last=now;

      // time passes
      state.time += dt*24; // ~1 minute per 2.5 seconds
      if(state.time>=24*60){ state.time-=24*60; state.day++; UI.dayLabel.textContent=state.day; dailyRespawn(); }
      UI.clockLabel.textContent = fmtClock(Math.floor(state.time));
      UI.dayMeter.style.width = `${((state.time%1440)/1440)*100}%`;

      // player movement
      const sp = state.player.speed;
      let dx=(keys['a']||keys['A']||keys['ArrowLeft']?-1:0) + (keys['d']||keys['D']||keys['ArrowRight']?1:0);
      let dy=(keys['w']||keys['W']||keys['ArrowUp']?-1:0) + (keys['s']||keys['S']||keys['ArrowDown']?1:0);
      if(dx||dy){ const len=Math.hypot(dx,dy); dx/=len; dy/=len; state.player.x += dx*sp*dt; state.player.y += dy*sp*dt; }
      state.player.x = clamp(state.player.x, TILE/2, MAP_W*TILE - TILE/2);
      state.player.y = clamp(state.player.y, TILE/2, MAP_H*TILE - TILE/2);

      // camera follows
      cam.x = lerp(cam.x, state.player.x, 0.12);
      cam.y = lerp(cam.y, state.player.y, 0.12);

      // crop growth
      const growthRate = 0.6 * dayLightFactor();
      for(let i=0;i<state.crops.length;i++){
        const c=state.crops[i]; if(!c) continue; c.growth = Math.min(100, c.growth + growthRate);
      }

      draw();
      requestAnimationFrame(tick);
    }

    function dailyRespawn(){
      for(let y=0;y<MAP_H;y++){
        for(let x=0;x<MAP_W;x++){
          if(hasBuildingAt(x,y)) continue;
          const feat = getFeature(x,y);
          if(feat && feat.timer>0){
            feat.timer--;
            if(feat.timer<=0){
              setTile(x,y,feat.type);
              setFeature(x,y,null);
            }
          }
        }
      }
    }

    // ===================
    // Save / Load
    // ===================
    function saveGame(){
      const data = {
        day:state.day, time:state.time, world:state.world, crops:state.crops, features:state.features,
        player:state.player, inventory:state.inventory, buildings:state.buildings
      };
      localStorage.setItem('builderSave', JSON.stringify(data));
    }
    function loadGame(){
      const raw=localStorage.getItem('builderSave'); if(!raw) return false; const d=JSON.parse(raw);
      Object.assign(state,{day:d.day,time:d.time,player:d.player,inventory:d.inventory,buildings:d.buildings});
      state.world = new Array(MAP_W*MAP_H).fill(T.GRASS);
      if(d.world && d.world.length===MAP_W*MAP_H) state.world = d.world;
      state.crops = new Array(MAP_W*MAP_H).fill(null);
      if(d.crops && d.crops.length===MAP_W*MAP_H) state.crops = d.crops;
      state.features = new Array(MAP_W*MAP_H).fill(null);
      if(d.features && d.features.length===MAP_W*MAP_H){
        state.features = d.features.map(f=>{
          if(!f) return null;
          if(typeof f==='object' && 'timer' in f && 'type' in f) return {...f};
          if(typeof f==='number'){
            const type = f>=RESPAWN_DAYS.ROCK ? T.ROCK : T.TREE;
            return {timer:f,type};
          }
          return null;
        });
      }
      updateInventoryUI(); centerCamera();
      return true;
    }

    // ===================
    // Boot
    // ===================
    function boot(){
      genWorld( (Date.now()>>>0) & 0xfffffff );
      renderBuildMenu();
      updateInventoryUI();
      UI.toolLabel.textContent = Tools[state.toolIndex].name;
      UI.modeLabel.textContent = 'Gather';
      centerCamera();
      requestAnimationFrame(tick);
    }
    boot();
