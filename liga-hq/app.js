const LEAGUE_ID="1312228455764492288";
const MY_USER_ID="1362961772390154240";
const API="https://api.sleeper.app/v1";
const $=s=>document.querySelector(s);

let state={
  league:null, users:null, rosters:null, nflState:null,
  players:{},
  transactions:[],
  trendingAdd:[], trendingDrop:[],
  weeklyStats:{}, statsWeekLabel:""
};

function headshotUrl(playerId){ return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`; }
function teamLogoUrl(abbr){ return abbr ? `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png` : null; }
function avatarUrl(hash){
  if(!hash) return null;
  return hash.startsWith("http") ? hash : `https://sleepercdn.com/avatars/thumbs/${hash}`;
}
function imgTag(src, cls, fallbackText){
  if(!src) return `<div class="${cls}" style="display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--dimmer)">${fallbackText||""}</div>`;
  return `<img class="${cls}" src="${src}" loading="lazy" onerror="this.style.visibility='hidden'">`;
}

async function fetchJSON(url){
  const r=await fetch(url);
  if(!r.ok) throw new Error(url+" -> "+r.status);
  return r.json();
}

const PLAYERS_CACHE_KEY="ligahq_players_v2";
async function loadPlayers(){
  try{
    const cached=localStorage.getItem(PLAYERS_CACHE_KEY);
    if(cached){
      const parsed=JSON.parse(cached);
      if(Date.now()-parsed.ts < 24*3600*1000){ state.players=parsed.data; return; }
    }
  }catch(e){}
  const raw=await fetchJSON(`${API}/players/nfl`);
  const trimmed={};
  for(const id in raw){
    const p=raw[id];
    if(!p || !p.fantasy_positions || !p.fantasy_positions.length) continue;
    trimmed[id]={
      n:p.full_name || `${p.first_name||""} ${p.last_name||""}`.trim() || id,
      p:p.position, tm:p.team,
      ist:p.injury_status, ibp:p.injury_body_part, inote:p.injury_notes,
      pp:p.practice_participation, active:p.active,
      espn:p.espn_id
    };
  }
  state.players=trimmed;
  try{ localStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify({ts:Date.now(), data:trimmed})); }catch(e){}
}

function pl(id){ return state.players[id] || {n:id, p:"?", tm:"—"}; }
function isTeamDef(id){ return !state.players[id]; }
function displayName(id){
  if(isTeamDef(id)) return {n:id, p:"DEF", tm:id, isDef:true};
  return pl(id);
}
function photoFor(id){
  const info=displayName(id);
  return info.isDef ? teamLogoUrl(id) : headshotUrl(id);
}

function rosterOwnerMap(){
  const byRoster={};
  (state.rosters||[]).forEach(r=>{ byRoster[r.roster_id]=r.owner_id; });
  return byRoster;
}
function userMap(){
  const byUser={};
  (state.users||[]).forEach(u=>{ byUser[u.user_id]=u; });
  return byUser;
}
function userForRoster(rosterId){
  const owner=rosterOwnerMap()[rosterId];
  return userMap()[owner];
}
function teamNameForRoster(rosterId){
  const u=userForRoster(rosterId);
  if(!u) return "Time "+rosterId;
  return u.metadata?.team_name || u.display_name || "Time "+rosterId;
}
function myRoster(){
  return (state.rosters||[]).find(r=>r.owner_id===MY_USER_ID);
}

function injuryBadge(p){
  if(!p || !p.ist) return "";
  const low=p.ist.toLowerCase();
  const cls = low.includes("out") ? "out"
    : low.includes("doubt") ? "doubtful"
    : low.includes("quest") ? "questionable"
    : low.includes("ir") ? "ir" : "questionable";
  return `<span class="badge ${cls}">${p.ist}${p.ibp?" · "+p.ibp:""}</span>`;
}

function injuryLinks(p){
  const q=encodeURIComponent(p.n+" injury "+(p.tm||""));
  const links=[
    {label:"Notícias", url:`https://www.google.com/search?q=${q}&tbm=nws`},
    {label:"Twitter/X", url:`https://twitter.com/search?q=${encodeURIComponent(p.n+" injury")}&f=live`}
  ];
  if(p.espn) links.unshift({label:"Perfil ESPN", url:`https://www.espn.com/nfl/player/_/id/${p.espn}`});
  return links;
}

async function loadAll(){
  setStatus("conectando na API do Sleeper…", false);
  try{
    state.nflState = await fetchJSON(`${API}/state/nfl`);
    const [league, users, rosters] = await Promise.all([
      fetchJSON(`${API}/league/${LEAGUE_ID}`),
      fetchJSON(`${API}/league/${LEAGUE_ID}/users`),
      fetchJSON(`${API}/league/${LEAGUE_ID}/rosters`)
    ]);
    state.league=league; state.users=users; state.rosters=rosters;

    await loadPlayers();

    const week=state.nflState.week || 1;
    const weeksToFetch=[]; for(let w=Math.max(1,week-2); w<=week; w++) weeksToFetch.push(w);
    const txByWeek = await Promise.all(weeksToFetch.map(w=>
      fetchJSON(`${API}/league/${LEAGUE_ID}/transactions/${w}`).catch(()=>[])
    ));
    state.transactions = txByWeek.flat()
      .filter(t=>t.status==="complete")
      .sort((a,b)=>b.created-a.created);

    const [tAdd, tDrop] = await Promise.all([
      fetchJSON(`${API}/players/nfl/trending/add?lookback_hours=48&limit=25`).catch(()=>[]),
      fetchJSON(`${API}/players/nfl/trending/drop?lookback_hours=48&limit=25`).catch(()=>[])
    ]);
    state.trendingAdd=tAdd; state.trendingDrop=tDrop;

    const statsWeek=Math.max(1, week-1);
    try{
      state.weeklyStats = await fetchJSON(`${API}/stats/nfl/${state.nflState.season_type}/${state.nflState.season}/${statsWeek}`);
      state.statsWeekLabel = `${state.nflState.season_type==="regular"?"semana":"pré-temporada"} ${statsWeek}`;
    }catch(e){ state.weeklyStats={}; state.statsWeekLabel=""; }

    $("#leagueSub").innerHTML = `<b>${league.name}</b><br>${league.season} · semana ${week}`;
    setStatus(`atualizado às ${new Date().toLocaleTimeString("pt-BR")}`, false);
    renderAll();
  }catch(e){
    setStatus("erro ao carregar: "+e.message, true);
  }
}

function setStatus(text, isErr){
  const el=$("#statusText"); el.textContent=text; el.className=isErr?"err":"";
}

function renderAll(){
  renderStandings();
  renderMeuTime();
  renderWaivers();
  renderLesoes();
  renderUsage();
}

function renderStandings(){
  const wrap=$("#tabStandings");
  const meta=state.league.metadata||{};
  const divNames={1:meta.division_1, 2:meta.division_2, 3:meta.division_3};
  const divAvatars={1:meta.division_1_avatar, 2:meta.division_2_avatar, 3:meta.division_3_avatar};

  const rosters=[...(state.rosters||[])].map(r=>{
    const s=r.settings||{};
    return {
      roster_id:r.roster_id,
      div:s.division||0,
      wins:s.wins||0, losses:s.losses||0, ties:s.ties||0,
      fpts:(s.fpts||0)+(s.fpts_decimal||0)/100,
      waiverLeft:100-(s.waiver_budget_used||0),
      mine:r.owner_id===MY_USER_ID
    };
  });

  const byDiv={};
  rosters.forEach(r=>{ (byDiv[r.div]=byDiv[r.div]||[]).push(r); });
  Object.values(byDiv).forEach(list=>list.sort((a,b)=> b.wins-a.wins || b.fpts-a.fpts));

  const divIds=Object.keys(byDiv).sort((a,b)=>a-b);
  const sections=divIds.map(divId=>{
    const list=byDiv[divId];
    const rows=list.map((r,i)=>{
      const u=userForRoster(r.roster_id);
      const avatar=avatarUrl(u?.metadata?.avatar || u?.avatar);
      return `<div class="standRow${r.mine?" mine":""}">
        <span class="rank mono">${i+1}</span>
        ${imgTag(avatar,"teamlogo round","")}
        <div>
          <div class="standName">${teamNameForRoster(r.roster_id)}</div>
          <div class="standOwner">${u?.display_name||""}</div>
        </div>
        <span class="standRec mono">${r.wins}-${r.losses}${r.ties?"-"+r.ties:""}</span>
        <span class="standPf mono">${r.fpts.toFixed(1)} pts</span>
        <span class="rightbit mono">$${r.waiverLeft} FAAB</span>
      </div>`;
    }).join("");
    return `<div class="divHeader">${divNames[divId]||"Divisão "+divId}</div>${rows}`;
  }).join("");

  wrap.innerHTML=`<div class="card">
    <div class="hd"><span>Classificação por divisão</span><span>${rosters.length} times</span></div>
    ${sections}
  </div>`;
}

function renderMeuTime(){
  const wrap=$("#tabTime");
  const r=myRoster();
  if(!r){ wrap.innerHTML='<div class="loading">Não achei seu roster nessa liga.</div>'; return; }
  const s=r.settings||{};
  const starterSet=new Set(r.starters||[]);
  const all=[...(r.starters||[]), ...((r.players||[]).filter(id=>!starterSet.has(id)))];

  const rows=all.map(id=>{
    const isStarter=starterSet.has(id);
    const info=displayName(id);
    return `<div class="row">
      ${imgTag(photoFor(id),"headshot",info.p)}
      <span class="pos ${info.p}">${info.p}</span>
      <div class="flex1">
        <span class="nm">${info.n}</span><span class="tm">${info.tm||""}</span>${injuryBadge(info)}
        <div class="sub2">${isStarter?"titular":"banco"}</div>
      </div>
    </div>`;
  }).join("");

  wrap.innerHTML=`<div class="card">
    <div class="hd"><span>First Down Syndrome · elenco</span>
      <span>${s.wins||0}-${s.losses||0}${s.ties?"-"+s.ties:""} · ${((s.fpts||0)+(s.fpts_decimal||0)/100).toFixed(1)} pts</span>
    </div>
    ${rows || '<div class="emptyNote">vazio</div>'}
  </div>`;
}

function renderWaivers(){
  const wrap=$("#tabWaivers");
  const owned=new Set();
  (state.rosters||[]).forEach(r=>(r.players||[]).forEach(id=>owned.add(id)));

  const txRows=state.transactions.slice(0,25).map(t=>{
    const teamNm=teamNameForRoster((t.roster_ids||[])[0]);
    const adds=Object.keys(t.adds||{});
    const drops=Object.keys(t.drops||{});
    const faab = (t.waiver_budget||[]).map(w=>w.amount).find(a=>a!=null);
    const when=new Date(t.created).toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"});
    return `<div class="row">
      <div class="flex1">
        <span class="teamchip">${teamNm}</span> · ${when}
        ${adds.map(id=>`<div><span class="badge add">+ ${displayName(id).n}</span></div>`).join("")}
        ${drops.map(id=>`<div><span class="badge drop">− ${displayName(id).n}</span></div>`).join("")}
      </div>
      ${faab!=null?`<span class="badge faab">$${faab}</span>`:""}
    </div>`;
  }).join("");

  const trendRows=state.trendingAdd
    .filter(t=>!owned.has(t.player_id))
    .slice(0,15)
    .map(t=>{
      const info=displayName(t.player_id);
      return `<div class="row">
        ${imgTag(photoFor(t.player_id),"headshot",info.p)}
        <span class="pos ${info.p}">${info.p}</span>
        <div class="flex1"><span class="nm">${info.n}</span><span class="tm">${info.tm||""}</span>${injuryBadge(info)}</div>
        <span class="rightbit mono">${t.count.toLocaleString("pt-BR")} adds</span>
      </div>`;
    }).join("");

  wrap.innerHTML=`
    <div class="card">
      <div class="hd"><span>Livres em alta no Sleeper (48h, disponíveis na sua liga)</span></div>
      ${trendRows || '<div class="emptyNote">nada em alta ainda — muito cedo na temporada</div>'}
    </div>
    <div class="card">
      <div class="hd"><span>Movimentações recentes na liga</span></div>
      ${txRows || '<div class="emptyNote">nenhuma transação recente</div>'}
    </div>`;
}

const INJURY_CHECKS = {
  updated: "17/08/2026",
  items: [
    {
      id:"8146", name:"Jaylen Waddle", pos:"WR", team:"DEN",
      summary:"Estiramento leve na perna esquerda (saiu de um drill individual). Segundo o técnico Sean Payton, sem preocupação de longo prazo — já treinou por fora sem a joelheira/manga de compressão e correndo com mais soltura. Previsão de volta em 4-5 dias.",
      prob:"~85% pra temporada regular",
      links:[
        {label:"Payton dá atualização positiva", url:"https://predominantlyorange.com/sean-payton-provides-positive-update-on-broncos-jaylen-waddle-s-injury-01kzc70e4jhz"},
        {label:"Linha do tempo de retorno", url:"https://atozsports.com/nfl/denver-broncos-news/broncos-sean-payton-jaylen-waddle-leg-strain-limping-training-camp-recovery-timeline/"}
      ]
    },
    {
      id:"9509", name:"DK Metcalf", pos:"WR", team:"PIT",
      summary:"Lesão não divulgada, fora dos treinos desde 11/08. Mike McCarthy disse que ele está \"difícil\" de voltar nesse fim de semana — previsão de retorno só na última semana de agosto. Site aponta que a lesão \"não parece muito séria\", mas o prazo é mais longo que o do Waddle.",
      prob:"~70% pra essa semana · ~80% pra temporada regular",
      links:[
        {label:"Fora com lesão não divulgada", url:"https://www.rotoballer.com/player-news/dk-metcalf-out-with-undisclosed-injury-on-tuesday/1907116"},
        {label:"McCarthy: \"difícil\" de voltar", url:"https://sports.yahoo.com/articles/mike-mccarthy-dk-metcalf-michael-204000292.html"}
      ]
    },
    {
      id:"13324", name:"Kyle Monangai", pos:"RB", team:"CHI",
      summary:"Lesão no joelho direito em treino, saiu mancando. Exames iniciais não mostraram dano estrutural e o time \"acredita que ele está bem\" — mas ainda aguardando ressonância (MRI) pra confirmar. Otimismo cauteloso.",
      prob:"~80% (aguardando confirmação da ressonância)",
      links:[
        {label:"Bears recebem atualização promissora", url:"https://sports.yahoo.com/articles/bears-news-initial-kyle-monangai-233209036.html"},
        {label:"Vai fazer ressonância, sem dano grave aparente", url:"https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/report-kyle-monangai-to-have-mri-on-knee-bears-believe-he-avoided-serious-injury"}
      ]
    }
  ]
};

function renderInjuryCheckHTML(){
  const cards=INJURY_CHECKS.items.map(p=>`<div class="pickcard">
    <div class="pickhd">
      ${imgTag(headshotUrl(p.id),"headshot sm",p.pos)}
      <span class="pos ${p.pos}">${p.pos}</span>
      <span class="nm">${p.name}</span><span class="tm">${p.team}</span>
      <span class="badge prob">${p.prob}</span>
    </div>
    <div class="why">${p.summary}</div>
    <div class="picklinks">${p.links.map(l=>`<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>
  </div>`).join("");
  return `<div class="card">
    <div class="hd"><span>Checagem manual · questionable</span><span>atualizado ${INJURY_CHECKS.updated}</span></div>
    ${cards}
    <div class="insightsMeta" style="padding:10px 15px">pesquisa pontual via Twitter/notícias — peça "checa as lesões questionable" pra atualizar</div>
  </div>`;
}

function renderLesoes(){
  const wrap=$("#tabLesoes");
  const rows=[];
  (state.rosters||[]).forEach(r=>{
    (r.players||[]).forEach(id=>{
      const info=pl(id);
      if(info.ist){
        rows.push({...info, id, roster:r.roster_id, mine:r.owner_id===MY_USER_ID});
      }
    });
  });
  const order={Out:0,Doubtful:1,IR:2,Questionable:3,Sus:4};
  rows.sort((a,b)=>(order[a.ist]??9)-(order[b.ist]??9));

  const html=rows.map(p=>`<div class="row">
    ${imgTag(headshotUrl(p.id),"headshot",p.p)}
    <span class="pos ${p.p}">${p.p}</span>
    <div class="flex1">
      <span class="nm ${p.mine?"mine":""}">${p.n}</span><span class="tm">${p.tm||""}</span>${injuryBadge(p)}
      <div class="sub2">${p.mine?"seu time":teamNameForRoster(p.roster)}${p.inote?" · "+p.inote:""}</div>
      <div class="picklinks" style="margin-top:5px">${injuryLinks(p).map(l=>`<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>
    </div>
  </div>`).join("");

  wrap.innerHTML=`<div class="card">
    <div class="hd"><span>Lesões · times da liga</span><span>${rows.length}</span></div>
    ${html || '<div class="emptyNote">ninguém machucado nos elencos da liga agora</div>'}
  </div>` + renderInjuryCheckHTML();
}

function renderUsage(){
  const wrap=$("#tabUsage");
  const r=myRoster();
  if(!r){ wrap.innerHTML='<div class="loading">Sem roster.</div>'; return; }

  const rows=(r.players||[]).map(id=>{
    const info=pl(id);
    const st=state.weeklyStats[id];
    if(!["QB","RB","WR","TE"].includes(info.p)) return null;
    const tgt=st?.rec_tgt ?? null;
    const snp=st?.off_snp ?? null;
    const tmSnp=st?.tm_off_snp ?? null;
    const snapPct = (snp!=null && tmSnp) ? Math.round(100*snp/tmSnp) : null;
    const pts=st?.pts_ppr ?? null;
    return {id, info, tgt, snapPct, pts};
  }).filter(Boolean)
    .sort((a,b)=>(b.pts??-1)-(a.pts??-1));

  const rowsHtml=rows.map(x=>`<div class="row">
    ${imgTag(headshotUrl(x.id),"headshot",x.info.p)}
    <span class="pos ${x.info.p}">${x.info.p}</span>
    <div class="flex1">
      <span class="nm">${x.info.n}</span><span class="tm">${x.info.tm||""}</span>
      <div class="sub2">${x.tgt!=null?x.tgt+" alvos":"sem alvos"}${x.pts!=null?" · "+x.pts.toFixed(1)+" pts":""}</div>
    </div>
    ${x.snapPct!=null ? `
      <div class="barwrap"><div class="barfill" style="width:${x.snapPct}%"></div></div>
      <span class="rightbit mono">${x.snapPct}%</span>
    ` : '<span class="rightbit">—</span>'}
  </div>`).join("");

  wrap.innerHTML=`<div class="card">
    <div class="hd"><span>Uso · ${state.statsWeekLabel || "sem dados ainda"}</span></div>
    ${rowsHtml || '<div class="emptyNote">sem estatísticas pra essa semana ainda</div>'}
  </div>`;
}

function renderInsights(){
  const wrap=$("#tabInsights");
  wrap.innerHTML=`
    <div class="card">
      <div class="insightsMeta">atualizado 17/08/2026 · pré-temporada, semana 2</div>
      <div class="insightsBody">

        <h3>Relevante pro seu time</h3>
        <ul>
          <li><b>Jonathan Taylor</b> segue confirmado como RB de elite tier-1 nos rankings de pré-temporada
            (junto com Gibbs/Bijan/Chase/Nacua) — sua base no RB1 está sólida.</li>
          <li>Nenhuma notícia negativa nova achada pros seus outros titulares além do que já está na aba
            Lesões (Waddle, Metcalf, Monangai — todos com prognóstico ok).</li>
        </ul>

        <h3>Disputas de posição pra ficar de olho</h3>
        <ul>
          <li><b>49ers:</b> Jordan James está ganhando mais trabalho que o rookie de 3ª rodada Jaboree Black
            como RB2 atrás de McCaffrey.</li>
          <li><b>Ravens:</b> com Rashod Bateman fora de 2 treinos, o rookie de 3ª rodada Ja'Kobi Lane ganhou
            espaço pra brigar pelo posto de WR2 atrás de Zay Flowers.</li>
          <li><b>Colts:</b> com Michael Pittman fora, Alec Pierce vira sleeper — foi 2º da liga em jardas por
            recepção (21.3) no ano passado, e algum modelo já projeta ele acima de nomes como Nabers/Jefferson.</li>
        </ul>

        <h3>Lesões que valem acompanhar (fora da sua liga)</h3>
        <ul>
          <li><b>Ricky Pearsall (SF)</b> — fora da temporada 2026 inteira, cirurgia no LCP.</li>
          <li><b>Jordyn Tyson (NO, rookie)</b> — risco real de perder a semana 1 por lesão no posterior de coxa.</li>
          <li><b>Chuba Hubbard (CAR)</b> — posterior de coxa, semana a semana.</li>
          <li><b>Luther Burden III (CHI)</b> — deve perder a pré-temporada com lesão na virilha, mas Chicago
            está otimista pra semana 1.</li>
          <li><b>Malik Nabers (NYG)</b> — boa notícia: voltou a treinar pela primeira vez desde a ruptura do
            LCA, já correndo rotas antes mesmo do camp.</li>
          <li><b>Patrick Mahomes (KC)</b> — disse que o joelho "está ótimo", seguindo pra retorno na semana 1.</li>
        </ul>

        <h3>Sleepers/breakouts em alta nas fontes</h3>
        <ul>
          <li><b>Bhayshul Tuten (JAX)</b> — rookie de 4ª rodada em 2025, teve 386 jardas e 7 TDs como reserva
            de Etienne; com Etienne agora no NO, assume a titularidade.</li>
          <li><b>Jaxson Dart (NYG)</b> — 2º ano, elenco reforçado + volta de Nabers, apontado como possível
            "roubada" no ADP atual.</li>
          <li><b>Gunnar Helm (TEN, TE)</b> — hype de breakout forte a temporada inteira na pré-temporada.</li>
        </ul>

        <h3>Fontes usadas nessa pesquisa</h3>
        <ul>
          <li><a href="https://www.fantasypros.com/2026/07/nfl-training-camp-news-fantasy-football-impact-2026/" target="_blank" rel="noopener">FantasyPros — Training Camp News & Impact</a></li>
          <li><a href="https://www.rotowire.com/football/article/2026-fantasy-football-training-camp-battles-to-watch-127668" target="_blank" rel="noopener">RotoWire — Training Camp Battles to Watch</a></li>
          <li><a href="https://www.espn.com/fantasy/football/story/_/page/FFSleepBustBreak26-49030808/fantasy-football-2026-rankings-nfl-sleepers-breakouts-busts" target="_blank" rel="noopener">ESPN — Sleepers, Busts, Breakouts 2026</a></li>
          <li><a href="https://www.rotoballer.com/8-fantasy-football-sleepers-breakouts-and-league-winners-2026/1877912" target="_blank" rel="noopener">RotoBaller — Sleepers & League-Winners</a></li>
          <li><a href="https://www.cbssports.com/fantasy/football/news/fantasy-football-rankings-2026-sleepers-breakouts-busts-by-model-that-predicted-daniel-jones-big-year/" target="_blank" rel="noopener">CBS Sports — Sleepers/Breakouts/Busts (modelo)</a></li>
        </ul>
      </div>
    </div>`;
}
renderInsights();

const HOT_WAIVERS = [];
const HOT_WAIVERS_NOTE = `Pesquisei antes de montar essa aba (17/08/2026): ainda é pré-temporada — a liga real
  começa depois do fim de agosto, e as fontes de fantasy (FantasyPros, ESPN, The Ringer etc.) praticamente não
  publicam recomendação de waiver nessa fase, porque o jogo de pré-temporada não reflete uso real de titulares.
  Não vou forçar um nome só pra essa aba não ficar vazia. Assim que a temporada regular começar e der pra ver
  quem está de fato ganhando alvos/snaps, peço pra você pra atualizar e trago picks com motivo, links e fonte.`;

function renderHotWaivers(){
  const wrap=$("#tabHotWaivers");
  if(!HOT_WAIVERS.length){
    wrap.innerHTML=`<div class="card">
      <div class="insightsMeta">nenhum pick recomendado agora</div>
      <div class="insightsBody">${HOT_WAIVERS_NOTE}</div>
    </div>`;
    return;
  }
  const cards=HOT_WAIVERS.map(p=>`<div class="pickcard">
    <div class="pickhd">
      ${imgTag(headshotUrl(p.id),"headshot sm",p.pos)}
      <span class="pos ${p.pos}">${p.pos}</span>
      <span class="nm">${p.name}</span><span class="tm">${p.team||""}</span>
    </div>
    <div class="why">${p.why}</div>
    <div class="picklinks">${(p.links||[]).map(l=>`<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>
  </div>`).join("");
  wrap.innerHTML=`<div class="card"><div class="hd"><span>Hot Waivers · picks com motivo</span></div>${cards}</div>`;
}
renderHotWaivers();

document.querySelectorAll(".tabBtn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("on"));
    btn.classList.add("on");
    document.querySelectorAll("main > div").forEach(d=>d.hidden=true);
    const map={standings:"tabStandings",time:"tabTime",waivers:"tabWaivers",hotwaivers:"tabHotWaivers",lesoes:"tabLesoes",usage:"tabUsage",insights:"tabInsights"};
    $("#"+map[btn.dataset.tab]).hidden=false;
  });
});

$("#refreshBtn").addEventListener("click", loadAll);

loadAll();
