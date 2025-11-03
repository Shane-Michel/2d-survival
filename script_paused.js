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
      [T.TREE] : '#082814ff',
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
      player:{x:MAP_W*TILE/2, y:MAP_H*TILE/2, baseSpeed:140},
      mode:'gather',
      toolIndex:0,
      inventory:{ wood:10, stone:10, seeds:10, food:10 },
      buildings:[],
      nextBuildingId:1,
      servants:[],
      nextServantId:1,
      waterRations:0,
      servantUiTimer:0,
      paused:false,
      last: performance.now(),
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
      {id:'silo', name:'Silo', w:2, h:2, cost:{wood:6, stone:6}, dropOff:true},
      {id:'well', name:'Well', w:1, h:1, cost:{stone:5}},
    ];

    const BUILDING_DEFS = {};
    Buildings.forEach(proto=>{ BUILDING_DEFS[proto.id] = proto; });
    BUILDING_DEFS.towncenter = {id:'towncenter', name:'Town Center', w:3, h:3, cost:{}, dropOff:true};

    const SERVANT_CONSTANTS = {
      hungerDecayPerMinute:0.035,
      thirstDecayPerMinute:0.05,
      shelterDecayPerMinute:0.02,
      gatherIntervalMinutes:240, // every 4 hours
      gatherWorkSeconds:3,
      moveSpeed:70,
      agePerDay:0.2,
      hungerThreshold:60,
      thirstThreshold:60,
      shelterThreshold:40,
      maxNeed:100,
      oldAge:80,
      baseFoodStorage:20,
      foodPerSilo:40,
      waterPerWell:8,
      hutCapacity:6,
    };

    const SERVANT_ROLES = [
      {id:'lumberjack', name:'Lumberjack', description:'Chops nearby trees for wood.'},
      {id:'miner', name:'Miner', description:'Mines stone from rocky outcrops.'},
      {id:'farmer', name:'Farmer', description:'Plants seeds and harvests crops.'},
    ];
    const SERVANT_ROLE_MAP = {};
    SERVANT_ROLES.forEach(role=>{ SERVANT_ROLE_MAP[role.id] = role; });

    const UI = {
      modeLabel: document.getElementById('modeLabel'),
      toolLabel: document.getElementById('toolLabel'),
      inv: document.getElementById('inv'),
      buildGrid: document.getElementById('buildGrid'),
      log: document.getElementById('log'),
      dayLabel: document.getElementById('dayLabel'),
      clockLabel: document.getElementById('clockLabel'),
      dayMeter: document.getElementById('dayMeter'),
      servantList: document.getElementById('servantList'),
      servantSummary: document.getElementById('servantSummary'),
      saveBtn: document.getElementById('saveBtn'),
      loadBtn: document.getElementById('loadBtn'),
      resetBtn: document.getElementById('resetBtn'),
      centerBtn: document.getElementById('centerBtn'),
      guideBtn: document.getElementById('guideBtn'),
      guideContent: document.getElementById('guideContent'),
    };
// === Pause / Resume Controls ===
(function(){
  const wrap = document.createElement('div');
  wrap.style.position='fixed'; wrap.style.top='12px'; wrap.style.right='12px';
  wrap.style.display='flex'; wrap.style.gap='8px'; wrap.style.zIndex='9999';
  const btn = document.createElement('button'); btn.id='pauseBtn'; btn.type='button';
  btn.textContent='Pause';
  btn.style.padding='6px 12px'; btn.style.border='1px solid #444'; btn.style.borderRadius='6px';
  btn.style.background='#222'; btn.style.color='#fff'; btn.style.cursor='pointer';
  const dot = document.createElement('span'); dot.id='pauseDot';
  dot.style.width='10px'; dot.style.height='10px'; dot.style.borderRadius='50%'; dot.style.alignSelf='center';
  dot.style.display='inline-block'; dot.style.background='#2ecc71'; // green running
  wrap.appendChild(btn); wrap.appendChild(dot); document.body.appendChild(wrap);

  function setPaused(next){
    state.paused = !!next;
    btn.textContent = state.paused ? 'Resume' : 'Pause';
    dot.style.background = state.paused ? '#e74c3c' : '#2ecc71';
  }
  function togglePause(){ setPaused(!state.paused); }

  btn.addEventListener('click', togglePause);
  window.addEventListener('keydown', (e)=>{
    if((e.key||'').toLowerCase()==='p') togglePause();
  });

  // expose for debugging
  window.setPaused = setPaused;
  window.togglePause = togglePause;
})();

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
      state.buildings = [];
      state.nextBuildingId = 1;
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
      placeTownCenter(sx, sy);
      log('New world generated. Welcome!');
      initServants();
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

    function placeTownCenter(centerTileX, centerTileY){
      const proto = BUILDING_DEFS.towncenter;
      const startX = centerTileX - Math.floor(proto.w/2);
      const startY = centerTileY - Math.floor(proto.h/2);
      const building = {
        uid: state.nextBuildingId++,
        id: proto.id,
        x: startX,
        y: startY,
        w: proto.w,
        h: proto.h,
        rot: 0,
        built: true,
        progress: 100,
        dropOff: true,
      };
      for(let oy=0;oy<building.h;oy++){
        for(let ox=0;ox<building.w;ox++){
          if(inBounds(building.x+ox, building.y+oy)) setFeature(building.x+ox, building.y+oy, null);
        }
      }
      state.buildings.push(building);
    }

    // ===================
    // Servants & society
    // ===================
    function initServants(){
      state.servants.length = 0;
      state.nextServantId = 1;
      spawnServant('Adalyn');
      spawnServant('Brom');
      state.waterRations = 0;
      assignHousing();
      pruneDeadServants();
      invalidateServantUI();
    }

    function spawnServant(name, silent=false){
      const servant = {
        id: state.nextServantId++,
        name,
        job:SERVANT_ROLES[0].id,
        hunger:SERVANT_CONSTANTS.maxNeed,
        thirst:SERVANT_CONSTANTS.maxNeed,
        shelter:SERVANT_CONSTANTS.maxNeed,
        age:18 + Math.random()*4,
        x: clamp(state.player.x + (Math.random()*TILE*2 - TILE), TILE/2, MAP_W*TILE - TILE/2),
        y: clamp(state.player.y + (Math.random()*TILE*2 - TILE), TILE/2, MAP_H*TILE - TILE/2),
        taskTimer:0,
        currentTask:null,
        homeId:null,
        alive:true,
      };
      state.servants.push(servant);
      if(!silent) log(`Servant ${servant.name} has joined your settlement.`);
      invalidateServantUI();
      return servant;
    }

    function invalidateServantUI(){ state.servantUiTimer = -1; }

    function builtCount(id){ return state.buildings.filter(b=>b.id===id && b.built).length; }

    function maxFoodStorage(){
      return SERVANT_CONSTANTS.baseFoodStorage + builtCount('silo')*SERVANT_CONSTANTS.foodPerSilo;
    }

    function availableWellCapacity(){
      return builtCount('well') * SERVANT_CONSTANTS.waterPerWell;
    }

    function hutCapacity(){
      return builtCount('hut') * SERVANT_CONSTANTS.hutCapacity;
    }

    function assignHousing(){
      const huts = state.buildings.filter(b=>b.id==='hut' && b.built);
      let capacityRemaining = huts.length * SERVANT_CONSTANTS.hutCapacity;
      const occupantsByHut = new Map();
      huts.forEach(h=>occupantsByHut.set(h.uid, []));

      // Clear previous assignment
      state.servants.forEach(s=>{ if(s.alive) s.homeId = null; });

      if(capacityRemaining<=0) return;

      let hutIndex = 0;
      const aliveServants = state.servants.filter(s=>s.alive);
      for(const servant of aliveServants){
        const hut = huts[hutIndex % huts.length];
        const occupants = occupantsByHut.get(hut.uid);
        if(occupants.length < SERVANT_CONSTANTS.hutCapacity){
          occupants.push(servant);
          servant.homeId = hut.uid;
          capacityRemaining--;
          if(occupants.length>=SERVANT_CONSTANTS.hutCapacity) hutIndex++;
        }
        if(capacityRemaining<=0) break;
      }
    }

    function countAdultPairs(){
      const huts = state.buildings.filter(b=>b.id==='hut' && b.built);
      let pairs = 0;
      huts.forEach(h=>{
        const occupants = state.servants.filter(s=>s.alive && s.homeId===h.uid && s.age>=18);
        pairs += Math.floor(occupants.length/2);
      });
      return pairs;
    }

    function handleBreeding(){
      const availableCapacity = hutCapacity() - state.servants.filter(s=>s.alive && s.homeId).length;
      if(availableCapacity<=0) return;
      if(state.inventory.food <= 1) return;
      if(availableWellCapacity()<=0) return;
      const pairs = countAdultPairs();
      if(pairs<=0) return;
      const chance = Math.min(0.4, 0.1*pairs);
      if(Math.random() < chance){
        const babyNames = ['Cora','Eldon','Mira','Soren','Lysa','Tavin','Enid','Hale'];
        const name = babyNames[Math.floor(Math.random()*babyNames.length)] + ' Jr.';
        const child = spawnServant(name, true);
        child.age = 1;
        child.hunger = SERVANT_CONSTANTS.maxNeed*0.8;
        child.thirst = SERVANT_CONSTANTS.maxNeed*0.8;
        child.shelter = SERVANT_CONSTANTS.maxNeed;
        assignHousing();
        log(`${child.name} was born in the huts.`);
      }
    }

    function feedAndWaterServants(){
      const alive = state.servants.filter(s=>s.alive);
      state.waterRations = availableWellCapacity();
      let hungry=0, thirsty=0;
      for(const servant of alive){
        if(servant.hunger < SERVANT_CONSTANTS.maxNeed && state.inventory.food>0){
          state.inventory.food--;
          servant.hunger = SERVANT_CONSTANTS.maxNeed;
        }else if(servant.hunger < SERVANT_CONSTANTS.maxNeed){
          hungry++;
        }
        if(servant.thirst < SERVANT_CONSTANTS.maxNeed && state.waterRations>0){
          state.waterRations--;
          servant.thirst = SERVANT_CONSTANTS.maxNeed;
        }else if(servant.thirst < SERVANT_CONSTANTS.maxNeed){
          thirsty++;
        }
        if(servant.homeId){
          servant.shelter = Math.min(SERVANT_CONSTANTS.maxNeed, servant.shelter+20);
        }
      }
      if(hungry>0) log(`Food stores ran short for ${hungry} servant${hungry>1?'s':''}.`);
      if(thirsty>0) log(`No water to refresh ${thirsty} servant${thirsty>1?'s':''}. Build wells!`);
      updateInventoryUI();
    }

    function updateServants(dt){
      const minutes = dt*24;
      const aliveServants = state.servants.filter(s=>s.alive);
      if(aliveServants.length===0) return;

      for(const servant of aliveServants){
        servant.age += (minutes/1440)*SERVANT_CONSTANTS.agePerDay;
        servant.hunger = Math.max(0, servant.hunger - SERVANT_CONSTANTS.hungerDecayPerMinute*minutes);
        servant.thirst = Math.max(0, servant.thirst - SERVANT_CONSTANTS.thirstDecayPerMinute*minutes);
        if(!servant.homeId){
          servant.shelter = Math.max(0, servant.shelter - SERVANT_CONSTANTS.shelterDecayPerMinute*minutes);
        }else{
          servant.shelter = Math.min(SERVANT_CONSTANTS.maxNeed, servant.shelter + 0.02*minutes);
        }

        if(typeof servant.x!=='number' || typeof servant.y!=='number'){
          servant.x = state.player.x;
          servant.y = state.player.y;
        }

        if(!SERVANT_ROLE_MAP[servant.job]){
          servant.job = SERVANT_ROLES[0].id;
        }

        if(servant.currentTask){
          handleServantTask(servant, dt);
        }else{
          servant.taskTimer = Math.max(0, servant.taskTimer - minutes);
          if(servant.taskTimer<=0){
            const task = pickGatherTask(servant);
            if(task){
              servant.currentTask = task;
            }else{
              servant.taskTimer = SERVANT_CONSTANTS.gatherIntervalMinutes/2;
            }
          }
        }

        if(servant.hunger===0){
          servant.alive = false;
          log(`${servant.name} has died of starvation.`);
        }else if(servant.thirst===0){
          servant.alive = false;
          log(`${servant.name} has died of dehydration.`);
        }else if(servant.shelter===0){
          servant.alive = false;
          log(`${servant.name} succumbed to the elements without shelter.`);
        }else if(servant.age>=SERVANT_CONSTANTS.oldAge){
          servant.alive = false;
          log(`${servant.name} passed away of old age.`);
        }
      }

      invalidateServantUI();
    }

    function handleServantTask(servant, dt){
      const task = servant.currentTask;
      if(!task) return;
      if(task.state==='travel'){
        const targetPos = tileCenter(task.tx, task.ty);
        const dx = targetPos.x - servant.x;
        const dy = targetPos.y - servant.y;
        const dist = Math.hypot(dx, dy);
        const step = SERVANT_CONSTANTS.moveSpeed * dt;
        if(dist > 1){
          const inv = dist===0?0:1/dist;
          const move = Math.min(dist, step);
          servant.x += dx*inv*move;
          servant.y += dy*inv*move;
        }else{
          task.state = 'gather';
          task.timer = SERVANT_CONSTANTS.gatherWorkSeconds;
        }
      }else if(task.state==='gather'){
        task.timer -= dt;
        if(task.timer<=0){
          task.payload = harvestTaskResources(servant, task);
          if(payloadHasResources(task.payload)){
            const drop = resolveDropoffTarget(servant, task);
            if(drop){
              task.dropId = drop.uid;
              task.state = 'return';
            }else{
              deliverTaskPayload(servant, task, null);
              task.dropId = null;
              servant.currentTask = null;
              servant.taskTimer = SERVANT_CONSTANTS.gatherIntervalMinutes;
            }
          }else{
            deliverTaskPayload(servant, task, null);
            task.payload = null;
            task.dropId = null;
            servant.currentTask = null;
            servant.taskTimer = SERVANT_CONSTANTS.gatherIntervalMinutes;
          }
        }
      }else if(task.state==='return'){
        if(!payloadHasResources(task.payload)){
          deliverTaskPayload(servant, task, null);
          task.payload = null;
          task.dropId = null;
          servant.currentTask = null;
          servant.taskTimer = SERVANT_CONSTANTS.gatherIntervalMinutes;
          return;
        }
        const drop = resolveDropoffTarget(servant, task);
        if(!drop){
          deliverTaskPayload(servant, task, null);
          servant.currentTask = null;
          servant.taskTimer = SERVANT_CONSTANTS.gatherIntervalMinutes;
          return;
        }
        const targetPos = buildingCenter(drop);
        const dx = targetPos.x - servant.x;
        const dy = targetPos.y - servant.y;
        const dist = Math.hypot(dx, dy);
        const step = SERVANT_CONSTANTS.moveSpeed * dt;
        if(dist > 1){
          const inv = dist===0?0:1/dist;
          const move = Math.min(dist, step);
          servant.x += dx*inv*move;
          servant.y += dy*inv*move;
        }else{
          deliverTaskPayload(servant, task, drop);
          servant.currentTask = null;
          servant.taskTimer = SERVANT_CONSTANTS.gatherIntervalMinutes;
        }
      }
    }

    function pickGatherTask(servant){
      const tileX = Math.floor(servant.x / TILE);
      const tileY = Math.floor(servant.y / TILE);
      let roleId = servant.job;
      if(!SERVANT_ROLE_MAP[roleId]){
        roleId = SERVANT_ROLES[0].id;
        servant.job = roleId;
      }

      if(roleId==='lumberjack'){
        const target = findClosestTileOfType(T.TREE, tileX, tileY);
        if(target){
          return {type:'tree', tx:target.x, ty:target.y, state:'travel', timer:0};
        }
        return null;
      }else if(roleId==='miner'){
        const target = findClosestTileOfType(T.ROCK, tileX, tileY);
        if(target){
          return {type:'rock', tx:target.x, ty:target.y, state:'travel', timer:0};
        }
        return null;
      }else if(roleId==='farmer'){
        const harvestTarget = findClosestMatureCrop(tileX, tileY);
        if(harvestTarget){
          return {type:'farmHarvest', tx:harvestTarget.x, ty:harvestTarget.y, state:'travel', timer:0};
        }
        if(state.inventory.seeds>0){
          const plantTarget = findClosestPlantableFarmTile(tileX, tileY);
          if(plantTarget){
            return {type:'farmPlant', tx:plantTarget.x, ty:plantTarget.y, state:'travel', timer:0};
          }
        }
        return null;
      }

      const preferences = preferredResourceOrder();
      for(const type of preferences){
        const tileType = type==='tree'?T.TREE:T.ROCK;
        const target = findClosestTileOfType(tileType, tileX, tileY);
        if(target){
          return {type, tx:target.x, ty:target.y, state:'travel', timer:0};
        }
      }
      return null;
    }

    function preferredResourceOrder(){
      const order = [];
      if(state.inventory.wood <= state.inventory.stone){
        order.push('tree', 'rock');
      }else{
        order.push('rock', 'tree');
      }
      return order;
    }

    function findClosestTileOfType(tileType, fromX, fromY){
      let best=null;
      let bestDist=Infinity;
      for(let y=0;y<MAP_H;y++){
        for(let x=0;x<MAP_W;x++){
          if(getTile(x,y)!==tileType) continue;
          const dx = x-fromX;
          const dy = y-fromY;
          const d = dx*dx + dy*dy;
          if(d<bestDist){
            bestDist = d;
            best = {x,y};
          }
        }
      }
      return best;
    }

    function findClosestMatureCrop(fromX, fromY){
      let best = null;
      let bestDist = Infinity;
      for(let y=0;y<MAP_H;y++){
        for(let x=0;x<MAP_W;x++){
          const crop = state.crops[idx(x,y)];
          if(!crop || crop.growth<100) continue;
          const dx = x-fromX;
          const dy = y-fromY;
          const dist = dx*dx + dy*dy;
          if(dist<bestDist){
            bestDist = dist;
            best = {x,y};
          }
        }
      }
      return best;
    }

    function findClosestPlantableFarmTile(fromX, fromY){
      let best = null;
      let bestDist = Infinity;
      for(let y=0;y<MAP_H;y++){
        for(let x=0;x<MAP_W;x++){
          if(getTile(x,y)!==T.TILLED) continue;
          if(state.crops[idx(x,y)]) continue;
          const dx = x-fromX;
          const dy = y-fromY;
          const dist = dx*dx + dy*dy;
          if(dist<bestDist){
            bestDist = dist;
            best = {x,y};
          }
        }
      }
      return best;
    }

    function tileCenter(x,y){
      return {x:x*TILE+TILE/2, y:y*TILE+TILE/2};
    }

    function buildingCenter(b){
      return {x:(b.x + b.w/2)*TILE, y:(b.y + b.h/2)*TILE};
    }

    function findNearestDropoff(worldX, worldY){
      let best=null;
      let bestDist=Infinity;
      for(const b of state.buildings){
        if(!b || !b.built || !b.dropOff) continue;
        const center = buildingCenter(b);
        const dx = center.x - worldX;
        const dy = center.y - worldY;
        const dist = dx*dx + dy*dy;
        if(dist<bestDist){
          bestDist = dist;
          best = b;
        }
      }
      return best;
    }

    function harvestTaskResources(servant, task){
      let woodGain = 0;
      let stoneGain = 0;
      let foodGain = 0;
      let seedGain = 0;
      let resourceLabel = 'resources';

      if(task.type==='tree'){
        resourceLabel = 'wood';
        if(getTile(task.tx, task.ty)===T.TREE){
          setTile(task.tx, task.ty, T.GRASS);
          setFeature(task.tx, task.ty, {timer:RESPAWN_DAYS.TREE, type:T.TREE});
          woodGain = 2 + Math.floor(Math.random()*2);
        }else{
          woodGain = 1;
        }
        if(servant.hunger < SERVANT_CONSTANTS.hungerThreshold){
          woodGain = Math.max(0, woodGain-1);
        }
      }else if(task.type==='rock'){
        resourceLabel = 'stone';
        if(getTile(task.tx, task.ty)===T.ROCK){
          setTile(task.tx, task.ty, T.GRASS);
          setFeature(task.tx, task.ty, {timer:RESPAWN_DAYS.ROCK, type:T.ROCK});
          stoneGain = 1 + Math.floor(Math.random()*3);
        }else{
          stoneGain = 1;
        }
        if(servant.thirst < SERVANT_CONSTANTS.thirstThreshold){
          stoneGain = Math.max(0, stoneGain-1);
        }
      }else if(task.type==='farmHarvest'){
        resourceLabel = 'harvest';
        const tileIndex = idx(task.tx, task.ty);
        const crop = state.crops[tileIndex];
        if(crop && crop.growth>=100){
          state.crops[tileIndex] = null;
          setTile(task.tx, task.ty, T.TILLED);
          setFeature(task.tx, task.ty, null);
          foodGain = 1;
          seedGain = 2;
        }
      }else if(task.type==='farmPlant'){
        const tileIndex = idx(task.tx, task.ty);
        if(state.inventory.seeds>0 && getTile(task.tx, task.ty)===T.TILLED && !state.crops[tileIndex]){
          state.inventory.seeds = Math.max(0, state.inventory.seeds-1);
          plantCrop(task.tx, task.ty);
          log(`${servant.name} planted a seed.`);
          updateInventoryUI();
        }
        return null;
      }

      return {
        wood: woodGain,
        stone: stoneGain,
        food: foodGain,
        seeds: seedGain,
        label: resourceLabel,
      };
    }

    function payloadHasResources(payload){
      if(!payload) return false;
      const {wood=0, stone=0, food=0, seeds=0} = payload;
      return wood>0 || stone>0 || food>0 || seeds>0;
    }

    function resolveDropoffTarget(servant, task){
      const preferredId = task.dropId;
      if(typeof preferredId==='number'){
        const existing = state.buildings.find(b=>b.uid===preferredId && b.built && b.dropOff);
        if(existing) return existing;
      }
      return findNearestDropoff(servant.x, servant.y);
    }

    function deliverTaskPayload(servant, task, dropBuilding){
      if(!task.payload) return;
      const payload = task.payload;
      if(!payloadHasResources(payload)){
        task.payload = null;
        task.dropId = null;
        return;
      }
      state.inventory.wood += payload.wood;
      state.inventory.stone += payload.stone;
      state.inventory.seeds += payload.seeds;

      const beforeFood = state.inventory.food;
      const maxFood = maxFoodStorage();
      const potentialFood = beforeFood + payload.food;
      state.inventory.food = Math.min(maxFood, potentialFood);
      const foodAdded = state.inventory.food - beforeFood;

      const parts = [];
      if(payload.wood>0) parts.push(`+${payload.wood} wood`);
      if(payload.stone>0) parts.push(`+${payload.stone} stone`);
      if(foodAdded>0) parts.push(`+${foodAdded} food`);
      if(payload.seeds>0) parts.push(`+${payload.seeds} seeds`);
      const extras = parts.length?` (${parts.join(', ')})`:'';

      const dropName = dropBuilding ? (BUILDING_DEFS[dropBuilding.id]?.name || 'structure') : 'storage';
      log(`${servant.name} delivered ${payload.label}${extras} to the ${dropName}.`);
      updateInventoryUI();
      task.payload = null;
      task.dropId = null;
    }

    function sanitizeServantTask(task){
      if(!task || typeof task!=='object') return null;
      const type = task.type;
      const allowedTypes = ['tree','rock','farmHarvest','farmPlant'];
      if(!allowedTypes.includes(type)) return null;
      if(typeof task.tx!=='number' || typeof task.ty!=='number') return null;
      const allowedStates = ['travel','gather','return'];
      const state = allowedStates.includes(task.state)?task.state:'travel';
      const timer = typeof task.timer==='number' ? task.timer : 0;
      const dropId = typeof task.dropId==='number'?task.dropId:null;
      let payload = null;
      if(task.payload && typeof task.payload==='object'){
        const w = Math.max(0, Number(task.payload.wood)||0);
        const s = Math.max(0, Number(task.payload.stone)||0);
        const f = Math.max(0, Number(task.payload.food)||0);
        const seeds = Math.max(0, Number(task.payload.seeds)||0);
        payload = {wood:w, stone:s, food:f, seeds:seeds, label: typeof task.payload.label==='string'?task.payload.label:'resources'};
      }
      return {type, tx:Math.floor(task.tx), ty:Math.floor(task.ty), state, timer, dropId, payload};
    }

    function finalizeBuilding(site){
      site.built = true;
      if(site.id==='road'){
        for(let oy=0;oy<site.h;oy++) for(let ox=0;ox<site.w;ox++){
          setTile(site.x+ox, site.y+oy, T.ROAD);
        }
      }
      if(site.id==='field'){
        for(let oy=0;oy<site.h;oy++) for(let ox=0;ox<site.w;ox++){
          if(getTile(site.x+ox, site.y+oy)===T.GRASS) setTile(site.x+ox, site.y+oy, T.TILLED);
        }
      }
      site.progress = 100;
      assignHousing();
      updateInventoryUI();
      invalidateServantUI();
    }

    function pruneDeadServants(){
      const before = state.servants.length;
      state.servants = state.servants.filter(s=>s.alive);
      if(state.servants.length!==before){
        assignHousing();
        invalidateServantUI();
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

      // servants
      for(const servant of state.servants){
        if(!servant.alive) continue;
        if(typeof servant.x!=='number' || typeof servant.y!=='number') continue;
        ctx.save();
        ctx.translate(servant.x, servant.y);
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(0,0,8,0,Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();
        const roleIcon = servant.job==='miner'?'⛏':(servant.job==='farmer'?'🌾':'🪓');
        if(servant.currentTask && servant.currentTask.state==='gather'){
          ctx.fillStyle = 'rgba(255,255,255,0.8)';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(roleIcon, 0, 4);
        }
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
      const progress = clamp((b.progress||0)/100, 0, 1);
      ctx.globalAlpha = 0.6 + 0.4*progress;
      ctx.fillStyle = '#9ca3af';
      switch(b.id){
        case 'towncenter':
          ctx.fillStyle = '#b45309';
          ctx.fillRect(0,0,b.w*TILE,b.h*TILE);
          ctx.fillStyle = '#78350f';
          ctx.fillRect(TILE*0.2, TILE*0.2, b.w*TILE-TILE*0.4, b.h*TILE-TILE*0.4);
          ctx.fillStyle = '#fde68a';
          ctx.fillRect(b.w*TILE/2 - TILE*0.4, b.h*TILE/2 - TILE*0.7, TILE*0.8, TILE*1.2);
          break;
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
      ctx.globalAlpha = 1;
      if(!b.built){
        ctx.fillStyle = 'rgba(15,23,42,0.45)';
        ctx.fillRect(0,0,b.w*TILE,b.h*TILE);
        ctx.fillStyle = '#e5e7eb';
        ctx.font = '12px sans-serif';
        ctx.fillText(`${Math.round(progress*100)}%`, 4, 14);
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
    window.addEventListener('keydown', (e)=>{
      const tag = (e.target && e.target.tagName) || '';
      const isFormEl = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
      keys[e.key] = true;
      if (!state.paused && !isFormEl && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
        e.preventDefault();
      }
    });
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
        if(c && c.growth>=100){
          state.crops[idx(tx,ty)]=null;
          setTile(tx,ty,T.TILLED);
          setFeature(tx,ty,null);
          const prevFood = state.inventory.food;
          const newFood = Math.min(maxFoodStorage(), prevFood+1);
          state.inventory.food = newFood;
          const foodGained = newFood - prevFood;
          const seedsGained = foodGained * 2;
          if(seedsGained>0) state.inventory.seeds += seedsGained;
          const parts = [];
          if(foodGained>0) parts.push(`+${foodGained} food`);
          if(seedsGained>0) parts.push(`+${seedsGained} seeds`);
          log(`Harvested crop${parts.length?`: ${parts.join(', ')}`:''}`);
        }
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
      const building = {uid:state.nextBuildingId++, id:proto.id, x:tx, y:ty, w:proto.w, h:proto.h, rot:buildRot, built:true, progress:100, dropOff:!!proto.dropOff};
      state.buildings.push(building);
      for(let oy=0;oy<proto.h;oy++) for(let ox=0;ox<proto.w;ox++){ setFeature(tx+ox,ty+oy,null); }
      finalizeBuilding(building);
      log(`You built a ${proto.name}.`);
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
        let displayValue = v;
        if(k==='food'){
          displayValue = `${v}/${maxFoodStorage()}`;
        }
        card.innerHTML=`<div class="row"><div class="title">${k}</div><div>${displayValue}</div></div>`;
        UI.inv.appendChild(card);
      }
    }

    function renderServantUI(){
      if(!UI.servantList) return;
      UI.servantList.innerHTML='';
      const alive = state.servants.filter(s=>s.alive);
      const summaryParts = [];
      summaryParts.push(`${alive.length} active`);
      const housed = alive.filter(s=>s.homeId).length;
      summaryParts.push(`Housing ${housed}/${hutCapacity()}`);
      summaryParts.push(`Food cap ${maxFoodStorage()}`);
      const waterCap = availableWellCapacity();
      summaryParts.push(`Water ${Math.max(0,state.waterRations)}/${waterCap} rations`);
      UI.servantSummary.textContent = summaryParts.join(' • ');

      if(alive.length===0){
        const empty=document.createElement('div');
        empty.className='small';
        empty.textContent='No active servants.';
        UI.servantList.appendChild(empty);
        return;
      }

      alive.forEach(servant=>{
        const card=document.createElement('div');
        card.className='servant-card';
        const header=document.createElement('div');
        header.className='servant-header';
        header.innerHTML=`<span>${servant.name}</span><span class="small">${servant.age.toFixed(1)} yrs</span>`;
        card.appendChild(header);

        const needs=document.createElement('div');
        needs.className='servant-needs';
        needs.appendChild(makeNeedRow('Food', servant.hunger));
        needs.appendChild(makeNeedRow('Water', servant.thirst));
        needs.appendChild(makeNeedRow('Shelter', servant.shelter));
        card.appendChild(needs);

        const jobRow=document.createElement('div');
        jobRow.className='servant-job';
        const roleRow=document.createElement('div');
        roleRow.className='row';
        const roleLabel=document.createElement('div');
        roleLabel.textContent='Role';
        const roleValue=document.createElement('div');
        const select=document.createElement('select');
        SERVANT_ROLES.forEach(role=>{
          const opt=document.createElement('option');
          opt.value = role.id;
          opt.textContent = role.name;
          select.appendChild(opt);
        });
        if(!SERVANT_ROLE_MAP[servant.job]) servant.job = SERVANT_ROLES[0].id;
        select.value = servant.job;
        select.addEventListener('change',e=>{
          const newJob = e.target.value;
          if(!SERVANT_ROLE_MAP[newJob]) return;
          if(servant.job===newJob) return;
          servant.job = newJob;
          servant.currentTask = null;
          servant.taskTimer = 0;
          const roleName = SERVANT_ROLE_MAP[newJob]?.name || 'worker';
          log(`${servant.name} is now a ${roleName}.`);
          invalidateServantUI();
        });
        roleValue.appendChild(select);
        roleRow.appendChild(roleLabel);
        roleRow.appendChild(roleValue);
        jobRow.appendChild(roleRow);
        const roleInfo = SERVANT_ROLE_MAP[servant.job];
        if(roleInfo && roleInfo.description){
          const desc=document.createElement('div');
          desc.className='small';
          desc.textContent = roleInfo.description;
          jobRow.appendChild(desc);
        }
        card.appendChild(jobRow);

        UI.servantList.appendChild(card);
      });
    }

    function makeNeedRow(label, value){
      const wrap=document.createElement('div');
      wrap.innerHTML=`<div class="row"><div>${label}</div><div>${Math.round(value)}</div></div>`;
      const bar=document.createElement('div');
      bar.className='need-bar';
      const fill=document.createElement('div');
      fill.style.width=`${clamp(value,0,100)}%`;
      if(value<40) fill.style.background='#f97316';
      if(value<20) fill.style.background='#ef4444';
      bar.appendChild(fill);
      wrap.appendChild(bar);
      return wrap;
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
      if(state.paused){ requestAnimationFrame(tick); return; }


      // time passes
      state.time += dt*24; // ~1 minute per 2.5 seconds
      if(state.time>=24*60){ state.time-=24*60; state.day++; UI.dayLabel.textContent=state.day; dailyRespawn(); handleNewDay(); }
      UI.clockLabel.textContent = fmtClock(Math.floor(state.time));
      UI.dayMeter.style.width = `${((state.time%1440)/1440)*100}%`;

      // player movement
      let sp = state.player.baseSpeed;
      const tileX = Math.floor(state.player.x / TILE);
      const tileY = Math.floor(state.player.y / TILE);
      if(inBounds(tileX,tileY) && getTile(tileX,tileY)===T.ROAD){
        sp *= 1.35;
      }
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

      updateServants(dt);

      state.servantUiTimer += dt;
      if(state.servantUiTimer<0 || state.servantUiTimer>=0.5){
        renderServantUI();
        state.servantUiTimer = 0;
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

    function handleNewDay(){
      assignHousing();
      feedAndWaterServants();
      handleBreeding();
      pruneDeadServants();
      invalidateServantUI();
    }

    // ===================
    // Save / Load
    // ===================
    function saveGame(){
      const data = {
        day:state.day, time:state.time, world:state.world, crops:state.crops, features:state.features,
        player:state.player, inventory:state.inventory, buildings:state.buildings,
        servants:state.servants, nextServantId:state.nextServantId, nextBuildingId:state.nextBuildingId,
        waterRations:state.waterRations
      };
      localStorage.setItem('builderSave', JSON.stringify(data));
    }
    function loadGame(){
      const raw=localStorage.getItem('builderSave'); if(!raw) return false; const d=JSON.parse(raw);
      state.day = d.day||1;
      state.time = d.time||6*60;
      state.player = {...(d.player||{})};
      if(typeof state.player.baseSpeed!=='number'){
        state.player.baseSpeed = state.player.speed||140;
      }
      state.inventory = {...(d.inventory||{wood:0,stone:0,seeds:0,food:0})};

      state.nextBuildingId = d.nextBuildingId || 1;
      state.buildings = Array.isArray(d.buildings)? d.buildings.map(b=>{
        const copy = {...b};
        if(!copy.uid) copy.uid = state.nextBuildingId++;
        if(typeof copy.built!=='boolean') copy.built = true;
        copy.progress = copy.built ? 100 : (copy.progress||0);
        const def = BUILDING_DEFS[copy.id];
        copy.dropOff = !!(def && def.dropOff);
        return copy;
      }) : [];

      if(!state.buildings.some(b=>b.id==='towncenter')){
        const sx=Math.floor(MAP_W/2), sy=Math.floor(MAP_H/2);
        placeTownCenter(sx, sy);
      }

      state.inventory.food = Math.min(maxFoodStorage(), state.inventory.food||0);

      if(Array.isArray(d.servants)){
        state.servants = d.servants.map(s=>({
          id: s.id,
          name: s.name||'Helper',
          job: SERVANT_ROLE_MAP[s.job]?s.job:SERVANT_ROLES[0].id,
          hunger: typeof s.hunger==='number'?s.hunger:SERVANT_CONSTANTS.maxNeed,
          thirst: typeof s.thirst==='number'?s.thirst:SERVANT_CONSTANTS.maxNeed,
          shelter: typeof s.shelter==='number'?s.shelter:SERVANT_CONSTANTS.maxNeed,
          age: typeof s.age==='number'?s.age:20,
          taskTimer: Math.max(0, typeof s.taskTimer==='number'?s.taskTimer:0),
          x: clamp(typeof s.x==='number'?s.x:state.player.x, TILE/2, MAP_W*TILE - TILE/2),
          y: clamp(typeof s.y==='number'?s.y:state.player.y, TILE/2, MAP_H*TILE - TILE/2),
          currentTask: sanitizeServantTask(s.currentTask),
          homeId: s.homeId||null,
          alive: s.alive!==false,
        }));
        state.nextServantId = d.nextServantId || (Math.max(0,...state.servants.map(s=>s.id||0))+1);
      }else{
        initServants();
      }

      const savedWater = typeof d.waterRations==='number'?d.waterRations:availableWellCapacity();
      state.waterRations = clamp(savedWater, 0, availableWellCapacity());

      pruneDeadServants();
      assignHousing();
      invalidateServantUI();
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
      updateInventoryUI(); renderServantUI(); centerCamera();
      return true;
    }

    // ===================
    // Boot
    // ===================
    function boot(){
      genWorld( (Date.now()>>>0) & 0xfffffff );
      renderBuildMenu();
      updateInventoryUI();
      renderServantUI();
      UI.toolLabel.textContent = Tools[state.toolIndex].name;
      UI.modeLabel.textContent = 'Gather';
      centerCamera();
      requestAnimationFrame(tick);
    }
    boot();
