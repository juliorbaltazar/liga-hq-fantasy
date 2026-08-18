const LEAGUE_ID="1312228455764492288";
const MY_USER_ID="1362961772390154240";
const API="https://api.sleeper.app/v1";
const $=s=>document.querySelector(s);

let state={
  league:null, users:null, rosters:null, nflState:null,
  players:{},
  transactions:[],
  trendingAdd:[], trendingDrop:[],
  weeklyStats:{}, statsWeekLabel:"",
  snapshot:null
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

  // O snapshot é um arquivo local do próprio site — carrega primeiro e renderiza o que
  // depende só dele (Escalação/Byes), pra essas abas não ficarem reféns da API.
  try{
    state.snapshot = await fetchJSON(`sleeper-snapshot.json?t=${Date.now()}`);
    renderByes();
  }catch(e){ state.snapshot=null; }

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
  renderLineup();
  renderByes();
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
    const newsRow = info.ist
      ? `<div class="picklinks" style="margin-top:5px">${injuryLinks(info).map(l=>`<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>`
      : "";
    return `<div class="row">
      ${imgTag(photoFor(id),"headshot",info.p)}
      <span class="pos ${info.p}">${info.p}</span>
      <div class="flex1">
        <span class="nm">${info.n}</span><span class="tm">${info.tm||""}</span>${injuryBadge(info)}
        <div class="sub2">${isStarter?"titular":"banco"}</div>
        ${newsRow}
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

// ===================== ESCALAÇÃO RECOMENDADA =====================
// Preenchido pela rotina diária. `slots` segue a formação da liga (QB/RB/RB/WR/WR/TE/FLEX/K/DEF).
// Cada slot: {slot, id, name, pos, team, verdict: "start"|"risky", why, metrics:[{label,value,tone}],
//   alt: {name, why} | null }   ← alt = quem ficou no banco naquela vaga e por quê.
const LINEUP = {
  updated: "18/08/2026",
  week: 1,
  seasonType: "regular",
  opponent: {teamName:"Cowboy Sem Cueca", owner:"Marcelorenno", projected:null},
  myProjected: null,
  scoreSim: null,
  summary: `<b>Alvo: semana 1 da temporada regular (13/09)</b> — é a primeira semana que realmente pontua na sua
    liga, então é nela que a análise está mirando, não na pré-temporada. Base dos confrontos: <b>temporada 2025
    completa (18 semanas)</b> de pontos fantasy cedidos por cada defesa, por posição — amostra real, não ruído de
    pré-temporada. O que ainda vai melhorar até lá: as projeções oficiais da semana 1 (saem mais perto do jogo) e
    a definição dos três questionable do elenco, que devem estar resolvidos bem antes de setembro. <b>Boa notícia
    do sorteio:</b> nenhum jogador seu está em bye na semana 1, e você pega um adversário com dois desfalques
    sérios (veja a análise dele abaixo).`,
  slots: [
    {
      slot:"QB", id:"4984", name:"Josh Allen", pos:"QB", team:"BUF", verdict:"start",
      metrics:[
        {label:"2025", value:"22.0 pts/jogo", tone:"good"},
        {label:"HOU cede a QB", value:"13.8 (30º)", tone:"bad"},
        {label:"bye", value:"semana 7"}
      ],
      why:`Único QB do elenco e, mesmo se houvesse alternativa, seria ele. O confronto é o pior possível no papel
        — Houston foi a 30ª defesa que menos cedeu a quarterbacks em 2025 (13.8 pontos por jogo), das mais duras
        da liga. Ainda assim: 22.0 pontos por jogo em 17 jogos é produção de QB1 geral, e o piso dele contra
        defesa boa continua alto porque ele corre (produção que não depende de acertar passe contra secundária
        forte). Escala sem pensar. <b>Anote:</b> ele tem bye na semana 7 e você não tem QB reserva — precisa
        resolver isso antes (veja a aba Byes).`,
      alt:null
    },
    {
      slot:"RB1", id:"6813", name:"Jonathan Taylor", pos:"RB", team:"IND", verdict:"start",
      metrics:[
        {label:"2025", value:"21.3 pts/jogo", tone:"good"},
        {label:"BAL cede a RB", value:"23.2 (11º)", tone:"good"},
        {label:"bye", value:"semana 13"}
      ],
      why:`A escolha mais fácil do elenco inteiro: melhor jogador do seu time (21.3 pontos por jogo em 17 jogos
        em 2025, produção de RB1 absoluto) com confronto <b>favorável</b> — Baltimore foi a 11ª defesa que mais
        cedeu a corredores no ano passado (23.2 pontos por jogo). Volume garantido, matchup bom, sem lesão. É o
        seu pilar da semana.`,
      alt:null
    },
    {
      slot:"RB2", id:"4866", name:"Saquon Barkley", pos:"RB", team:"PHI", verdict:"start",
      metrics:[
        {label:"2025", value:"14.5 pts/jogo", tone:"good"},
        {label:"WAS cede a RB", value:"24.9 (7º)", tone:"good"},
        {label:"bye", value:"semana 10"}
      ],
      why:`Segundo RB titular, e o confronto ajuda bastante: Washington foi a <b>7ª defesa que mais cedeu a
        corredores</b> em 2025 (24.9 pontos por jogo), e ainda é jogo em casa na Filadélfia. Com 14.5 pontos por
        jogo de base, esse é o tipo de semana em que ele pode entregar bem acima da média. Escala tranquilo.`,
      alt:{name:"Kyle Monangai", why:`tem confronto parecido (Carolina cede 23.6 a RBs, 9º) e é o próximo da
        fila, mas está questionable e o volume dele é bem menor — fica como reserva de luxo e primeiro substituto
        se algo acontecer com Taylor ou Saquon.`}
    },
    {
      slot:"WR1", id:"11646", name:"Jalen Coker", pos:"WR", team:"CAR", verdict:"risky",
      metrics:[
        {label:"2025", value:"8.2 pts/jogo"},
        {label:"CHI cede a WR", value:"36.2 (2º)", tone:"good"},
        {label:"bye", value:"semana 5"}
      ],
      why:`Aposta calculada, e explico o porquê: Chicago foi a <b>2ª defesa que mais cedeu a wide receivers em
        toda a temporada 2025</b> (36.2 pontos por jogo) — é o melhor confronto de recepção do seu elenco inteiro,
        por margem larga. O contra é o volume: Coker fez 8.2 pontos por jogo em 11 jogos e ainda briga por espaço
        na Carolina. <b>O que checar antes:</b> a participação dele nos últimos jogos de pré-temporada — se ele
        aparecer como titular claro, essa vira uma das melhores escalações da semana; se seguir rodando pouco,
        troque pelo Deebo.`,
      alt:{name:"Deebo Samuel", why:`mais seguro no volume (11.8 pts/jogo) e saudável, mas o confronto é bem pior:
        os Rams cederam 33.1 a WRs (12º), contra os 36.2 do Chicago. É a troca imediata se o papel do Coker não
        se confirmar.`}
    },
    {
      slot:"WR2", id:"5872", name:"Deebo Samuel", pos:"WR", team:"SF", verdict:"start",
      metrics:[
        {label:"2025", value:"11.8 pts/jogo", tone:"good"},
        {label:"LAR cede a WR", value:"33.1 (12º)"},
        {label:"bye", value:"semana 8"}
      ],
      why:`O WR mais confiável do elenco pra semana 1: 11.8 pontos por jogo em 16 jogos, <b>sem status de lesão</b>
        (diferente de Metcalf e Waddle) e com confronto acima da média — os Rams cederam 33.1 pontos a receptores
        em 2025, 12º maior da liga. Não é o teto mais alto, é o melhor equilíbrio entre volume garantido e
        confronto favorável.`,
      alt:{name:"Jakobi Meyers", why:`saudável também, mas pega o pior confronto do grupo — Cleveland foi a 27ª
        defesa contra WRs (26.7 pontos cedidos). Deebo passa na frente pelo matchup.`}
    },
    {
      slot:"TE", id:"12506", name:"Harold Fannin", pos:"TE", team:"CLE", verdict:"start",
      metrics:[
        {label:"2025", value:"11.7 pts/jogo", tone:"good"},
        {label:"JAX cede a TE", value:"14.8 (10º)", tone:"good"},
        {label:"bye", value:"semana 11"}
      ],
      why:`Único TE do elenco, mas dessa vez a obrigação vem com boa notícia: Jacksonville foi a 10ª defesa que
        mais cedeu a tight ends em 2025 (14.8 pontos por jogo), confronto favorável. Fannin vem de 11.7 pontos por
        jogo como novato — número muito bom pra posição, que é a mais escassa do fantasy. <b>Atenção:</b> bye na
        semana 11 e sem reserva na posição.`,
      alt:null
    },
    {
      slot:"FLEX", id:"11610", name:"Malik Washington", pos:"WR", team:"MIA", verdict:"risky",
      metrics:[
        {label:"2025", value:"6.9 pts/jogo"},
        {label:"LV cede a WR", value:"33.5 (10º)", tone:"good"},
        {label:"bye", value:"semana 6"}
      ],
      why:`Vaga mais aberta do time, e a decisão depende de uma coisa só: o papel dele no Miami. O sinal recente é
        bom — na estreia da pré-temporada ele e Caleb Douglas foram claramente a dupla titular de recebedores, com
        distância dos outros. O confronto ajuda (Las Vegas cedeu 33.5 a WRs, 10º maior de 2025). O risco é a base
        baixa de 2025 (6.9 pontos por jogo como novato). <b>Confira até setembro:</b> se ele confirmar a
        titularidade, é escalação fácil; se o Miami trouxer alguém ou ele perder espaço, troque pelo Meyers.`,
      alt:{name:"Jakobi Meyers", why:`piso mais alto e confiável (11.0 pts/jogo em 16 jogos), mas confronto ruim
        contra Cleveland (26.7 cedidos, 27º). É a escolha conservadora dessa vaga.`}
    },
    {
      slot:"K", id:"8259", name:"Cameron Dicker", pos:"K", team:"LAC", verdict:"start",
      metrics:[
        {label:"2025", value:"9.8 pts/jogo"},
        {label:"ARI cede a K", value:"10.5 (2º)", tone:"good"},
        {label:"bye", value:"semana 7"}
      ],
      why:`Único kicker, e com ótimo confronto: Arizona foi a <b>2ª defesa que mais cedeu pontos a kickers</b> em
        2025 (10.5 por jogo). Dicker é dos mais consistentes da posição (9.8 pontos por jogo em 17 jogos). Semana
        boa pra posição que normalmente ninguém olha. <b>Lembrete:</b> bye na semana 7, junto com Josh Allen.`,
      alt:null
    },
    {
      slot:"DEF", id:"HOU", name:"Houston Texans", pos:"DEF", team:"HOU", verdict:"risky",
      metrics:[
        {label:"jogo", value:"vs BUF", tone:"bad"},
        {label:"bye", value:"semana 8"}
      ],
      why:`Única defesa do elenco, mas o confronto é dos piores possíveis: enfrentar o Buffalo do Josh Allen é
        justamente o tipo de jogo em que defesas tomam pontos negativos. Como você não tem alternativa no elenco,
        <b>essa é a posição mais óbvia pra mexer no waiver antes da semana 1</b> — pegar uma defesa que enfrente
        um ataque fraco costuma valer mais pontos do que qualquer outra troca marginal de elenco.`,
      alt:null
    }
  ],
  // Escalação provável do adversário + leitura de onde ele é forte e fraco.
  oppLineup: [
    {slot:"QB", name:"Dak Prescott", pos:"QB", team:"DAL", flag:"", note:`19.1 pts/jogo em 2025 e confronto bom (Giants cederam 18.8 a QBs, 10º). Sólido, sem ser assustador.`},
    {slot:"RB", name:"De'Von Achane", pos:"RB", team:"MIA", flag:"strong", note:`O jogador mais perigoso do time dele: 20.2 pontos por jogo em 2025, saudável, contra Las Vegas (13º que mais cede a RBs). É onde ele deve fazer a maior pontuação.`},
    {slot:"RB", name:"Travis Etienne", pos:"RB", team:"NO", flag:"", note:`14.9 pts/jogo, mas confronto duro contra Detroit (24º). Deve entregar produção média.`},
    {slot:"WR", name:"Justin Jefferson", pos:"WR", team:"MIN", flag:"strong", note:`Nome de elite e confronto neutro contra Green Bay (31.1 cedidos, 15º). Sempre risco de explodir.`},
    {slot:"WR", name:"Tetairoa McMillan", pos:"WR", team:"CAR", flag:"strong", note:`Atenção: pega o mesmo confronto excelente do seu Coker — Chicago, 2ª defesa que mais cede a WRs (36.2). Provável boa pontuação.`},
    {slot:"TE", name:"George Kittle", pos:"TE", team:"SF", flag:"weak", note:`<b>Está na lista PUP</b> (recuperando de cirurgia no tendão de Aquiles) — pode nem jogar a semana 1. Se ele não for liberado, o adversário fica com Isaiah Likely, que fez apenas 4.4 pontos por jogo em 2025. Rombo grande na posição.`},
    {slot:"FLEX", name:"Chuba Hubbard", pos:"RB", team:"CAR", flag:"weak", note:`Questionable (posterior de coxa, semana a semana) e base modesta de 8.4 pontos por jogo. Uma das vagas fracas dele.`},
    {slot:"K", name:"Ka'imi Fairbairn", pos:"K", team:"HOU", flag:"", note:`12.7 pts/jogo foi excelente em 2025, mas enfrenta Buffalo (26º que menos cede a kickers). Confronto ruim.`},
    {slot:"DEF", name:"New England Patriots", pos:"DEF", team:"NE", flag:"", note:`Enfrenta Seattle fora de casa. Confronto neutro.`}
  ],
  oppReadout: `<b>Leitura do Cowboy Sem Cueca:</b> o time dele tem topo forte (Achane e Jefferson são jogadores
    capazes de ganhar a semana sozinhos), mas chega à semana 1 com <b>dois buracos concretos</b>: George Kittle
    está na lista PUP se recuperando de cirurgia no Aquiles e pode nem jogar — o substituto, Isaiah Likely, fez
    só 4.4 pontos por jogo em 2025 — e Chuba Hubbard está questionable com problema no posterior de coxa. Além
    disso, o kicker dele pega o pior confronto possível (Buffalo). <b>Conclusão prática:</b> você não precisa
    forçar risco alto pra vencer esse confronto. Escalar os seguros (Taylor, Saquon, Deebo) e resolver a sua
    defesa no waiver já deve bastar — o desfalque no TE dele é uma vantagem sua de graça.`,
  benchNotes: [
    {name:"DK Metcalf (WR, PIT) — questionable",
     note:`Fora dos treinos desde 11/08, com retorno previsto pra última semana de agosto — ou seja, deve estar
       resolvido bem antes da semana 1. Confronto neutro contra Atlanta (33.5 cedidos, 11º) e base de 12.5 pontos
       por jogo. <b>Se ele estiver 100% em setembro, ele entra no lugar do Coker ou do Malik Washington</b>, que
       são as duas vagas mais arriscadas da sua escalação.`},
    {name:"Jaylen Waddle (WR, DEN) — questionable",
     note:`Prognóstico bom (estiramento leve, ~85%), mas o confronto da semana 1 é ruim: Kansas City foi a 21ª
       defesa contra WRs (27.9 cedidos). Mesmo saudável, ele fica atrás do Deebo e do Coker nessa semana
       específica por causa do matchup.`},
    {name:"Kyle Monangai (RB, CHI) — questionable",
     note:`Confronto bom contra Carolina (23.6 cedidos a RBs, 9º) e é seu terceiro RB. Não passa na frente de
       Taylor e Saquon, mas é o primeiro nome a entrar se um deles cair — vale confirmar que o joelho está
       resolvido antes de setembro.`},
    {name:"Tyler Allgeier (RB, ARI)",
     note:`Confronto ruim na semana 1 (Chargers foram a 30ª defesa contra RBs, só 18.4 cedidos) e volume baixo em
       Arizona. É profundidade pra bye weeks, não opção de escalação agora.`}
  ]
};

// ===================== IDENTIFICADOR DE BYES =====================
// Calculado direto do snapshot (bye_weeks vem do calendário completo da NFL), então não
// precisa de manutenção manual: cruza cada jogador do elenco com a semana de folga do time
// dele e aponta em quais semanas você fica sem cobertura numa posição.
const LINEUP_REQUIREMENTS = {QB:1, RB:2, WR:2, TE:1, K:1, DEF:1};  // FLEX conta à parte

function renderByes(){
  const wrap=$("#tabByes");
  const snap=state.snapshot;
  if(!snap || !snap.bye_weeks){
    wrap.innerHTML=`<div class="card"><div class="insightsMeta">sem dados de bye ainda</div>
      <div class="insightsBody">O mapa de byes vem do snapshot diário (calendário completo da NFL).
      Se estiver vazio, é porque a coleta ainda não rodou.</div></div>`;
    return;
  }

  // Roda a partir do snapshot (arquivo local), não da API — assim a aba funciona mesmo se
  // a API do Sleeper estiver lenta ou fora do ar.
  const snapRoster=(snap.rosters||[]).find(r=>r.owner_id===MY_USER_ID);
  const r=myRoster()||snapRoster;
  if(!r){
    wrap.innerHTML=`<div class="card"><div class="insightsBody">Não achei seu elenco no snapshot.</div></div>`;
    return;
  }

  const byes=snap.bye_weeks;
  const snapPlayers=snap.players||{};
  const roster=(r.players||[]).map(id=>{
    const sp=snapPlayers[id];
    const info = sp ? {n:sp.n, p:sp.p, tm:sp.tm, isDef:false} : displayName(id);
    const team=info.isDef||!info.tm ? id : info.tm;
    return {id, name:info.n, pos:info.p||"DEF", team, bye:byes[team]||null};
  });

  // agrupa por semana de bye
  const byWeek={};
  roster.forEach(p=>{ if(p.bye) (byWeek[p.bye]=byWeek[p.bye]||[]).push(p); });

  // conta quantos você tem por posição pra saber se sobra gente na semana
  const totalByPos={};
  roster.forEach(p=>{ totalByPos[p.pos]=(totalByPos[p.pos]||0)+1; });

  const weeks=Object.keys(byWeek).map(Number).sort((a,b)=>a-b);
  if(!weeks.length){
    wrap.innerHTML=`<div class="card"><div class="insightsBody">Nenhum bye detectado no elenco.</div></div>`;
    return;
  }

  const cards=weeks.map(wk=>{
    const outList=byWeek[wk];
    // quantos sobram por posição nessa semana
    const outByPos={};
    outList.forEach(p=>{ outByPos[p.pos]=(outByPos[p.pos]||0)+1; });

    const problems=[];
    Object.keys(LINEUP_REQUIREMENTS).forEach(pos=>{
      const need=LINEUP_REQUIREMENTS[pos];
      const have=(totalByPos[pos]||0)-(outByPos[pos]||0);
      if(have<need){
        problems.push({pos, need, have, gap:need-have});
      }
    });

    const sev = problems.length ? (problems.some(p=>p.have===0) ? "crit" : "warn") : "ok";
    const sevTag = sev==="crit"
      ? `<span class="verdict sit">precisa agir</span>`
      : sev==="warn" ? `<span class="verdict risky">atenção</span>`
      : `<span class="verdict start">tranquilo</span>`;

    const players=outList.map(p=>
      `<span class="metric"><b>${p.name}</b> ${p.pos}·${p.team}</span>`).join("");

    let diagnosis;
    if(!problems.length){
      diagnosis=`Você tem reserva suficiente em todas as posições nessa semana — dá pra cobrir sem mexer no elenco.`;
    }else{
      const parts=problems.map(p=>{
        if(p.have===0) return `fica com <b>zero ${p.pos}</b> (precisa de ${p.need})`;
        return `fica com ${p.have} ${p.pos} pra ${p.need} vagas`;
      });
      diagnosis=`<b>Problema:</b> ${parts.join(" e ")}. `
        + (sev==="crit"
          ? `Sem ninguém na posição, o sistema escala vazio e você perde os pontos daquela vaga inteira — precisa
             buscar um substituto no waiver com pelo menos 1-2 semanas de antecedência (quem espera a semana chegar
             pega o que sobrou).`
          : `Dá pra sobreviver, mas vai escalar seu pior reserva. Se aparecer alguém bom no waiver antes dessa
             semana, vale segurar pensando nela.`);
    }

    return `<div class="slotRow">
      <div class="slotHd">
        <span class="slotTag">Semana ${wk}</span>
        <span class="nm">${outList.length} ${outList.length===1?"jogador":"jogadores"} em bye</span>
        ${sevTag}
      </div>
      <div class="slotMeta">${players}</div>
      <div class="slotWhy">${diagnosis}</div>
    </div>`;
  }).join("");

  const crit=weeks.filter(wk=>{
    const outByPos={};
    byWeek[wk].forEach(p=>{ outByPos[p.pos]=(outByPos[p.pos]||0)+1; });
    return Object.keys(LINEUP_REQUIREMENTS).some(pos=>
      ((totalByPos[pos]||0)-(outByPos[pos]||0)) < LINEUP_REQUIREMENTS[pos]);
  });

  const header = crit.length
    ? `<div class="insightsBody" style="border-bottom:1px solid var(--line)">
        <b>Semanas que exigem preparação:</b> ${crit.map(w=>"semana "+w).join(", ")}. Nessas datas seu elenco não
        cobre a formação inteira — o ideal é resolver via waiver <b>antes</b> da semana chegar, porque quando ela
        chega todo mundo da liga está atrás do mesmo tipo de reposição. Detalhe de cada uma abaixo.
      </div>`
    : `<div class="insightsBody" style="border-bottom:1px solid var(--line)">
        Seu elenco cobre todas as semanas de bye sem furo de formação. Nada urgente a fazer.
      </div>`;

  wrap.innerHTML=`<div class="card">
    <div class="hd"><span>Byes do elenco</span><span>${weeks.length} semanas afetadas</span></div>
    ${header}
    ${cards}
  </div>`;
}

// ===================== REGISTRO DE ACERTOS =====================
// Histórico do que a ferramenta recomendou vs. o que realmente pontuou. A rotina anota a decisão
// na semana em que ela é feita e volta depois pra preencher os pontos reais e o veredito.
// entry: {week, seasonType, player, slot, decision:"escalado"|"sentado", benchedFor, pts, altPts,
//          result:"ok"|"miss"|"pending", note}
const TRACK_RECORD = {
  entries: [],
  summary: ""
};

function renderTrackRecord(){
  const e=TRACK_RECORD.entries||[];
  if(!e.length) return "";
  const rows=e.map(t=>{
    const cls = t.result==="ok" ? "ok" : t.result==="miss" ? "miss" : "pending";
    const txt = t.result==="ok" ? "acerto" : t.result==="miss" ? "erro" : "aguardando";
    const wk = `${t.seasonType==="pre"?"PS":"S"}${t.week}`;
    const pts = t.pts!=null ? t.pts.toFixed(1) : "—";
    return `<div class="trackRow">
        <span class="trackWk">${wk} · ${t.slot}</span>
        <span><b>${t.player}</b>${t.benchedFor?` <span class="tm">no lugar de ${t.benchedFor}</span>`:""}</span>
        <span class="trackPts">${pts}${t.altPts!=null?` <span class="tm">(${t.altPts.toFixed(1)})</span>`:""}</span>
        <span class="trackHit ${cls}">${txt}</span>
      </div>${t.note?`<div class="slotWhy" style="padding:0 15px 10px;margin-top:-2px">${t.note}</div>`:""}`;
  }).join("");
  return `<div class="card">
    <div class="hd"><span>Registro de acertos</span><span>${e.length} decisões</span></div>
    ${TRACK_RECORD.summary?`<div class="trackSummary">${TRACK_RECORD.summary}</div>`:""}
    ${rows}
  </div>`;
}

function renderScoreSim(){
  const s=LINEUP.scoreSim;
  if(!s || s.myProj==null || s.oppProj==null) return "";
  const total=Math.max(s.myProj+s.oppProj, 1);
  const myPct=Math.round(100*s.myProj/total);
  const tag = s.stance==="fav" ? ["fav","favorito"]
            : s.stance==="dog" ? ["dog","azarão"]
            : ["even","equilibrado"];
  const diffTxt = s.diff>0 ? `+${s.diff}` : `${s.diff}`;
  return `<div class="scoreSim">
    <span class="simTag ${tag[0]}">${tag[1]} · ${diffTxt} pts</span>
    <div class="simBar">
      <div class="simMe" style="width:${myPct}%">${s.myProj}</div>
      <div class="simOpp" style="width:${100-myPct}%">${s.oppProj}</div>
    </div>
    <div class="simVerdict">${s.strategy||""}</div>
  </div>`;
}

function renderOppLineup(){
  if(!LINEUP.oppLineup || !LINEUP.oppLineup.length) return "";
  const rows=LINEUP.oppLineup.map(p=>{
    const flag = p.flag==="weak" ? '<span class="weak">ponto fraco</span>'
               : p.flag==="strong" ? '<span class="strong">força</span>' : "";
    return `<div class="oppRow">
      <span class="slotTag">${p.slot}</span>
      <span class="pos ${p.pos}">${p.pos}</span>
      <span class="nm">${p.name}</span><span class="tm">${p.team||""}</span>
      ${flag}
    </div>${p.note?`<div class="slotWhy" style="padding:0 15px 10px;margin-top:-2px">${p.note}</div>`:""}`;
  }).join("");
  return `<div class="card">
    <div class="hd"><span>Escalação do adversário</span><span>${(LINEUP.opponent||{}).teamName||""}</span></div>
    ${LINEUP.oppReadout?`<div class="insightsBody" style="border-bottom:1px solid var(--line)">${LINEUP.oppReadout}</div>`:""}
    ${rows}
  </div>`;
}

function renderLineup(){
  const wrap=$("#tabLineup");
  if(!LINEUP.slots.length){
    wrap.innerHTML=`<div class="card">
      <div class="insightsMeta">escalação ainda não calculada</div>
      <div class="insightsBody">
        Essa aba é montada pela rotina diária, cruzando: força da defesa adversária contra cada posição
        (pontos fantasy cedidos, calculado a partir dos dados reais do Sleeper), uso recente de cada jogador
        (snaps, alvos, carries), projeção oficial da semana, histórico da temporada passada, status de lesão e
        o consenso das fontes de análise. Ela roda toda manhã — se estiver vazia, é porque ainda não rodou
        desde que essa aba foi criada.
      </div>
    </div>`;
    return;
  }

  const opp=LINEUP.opponent||{};
  const vs=`<div class="card">
    <div class="hd"><span>Semana ${LINEUP.week}${LINEUP.seasonType==="pre"?" · pré-temporada":""}</span><span>atualizado ${LINEUP.updated}</span></div>
    <div class="vsbar">
      <div class="vsside">
        <div>
          <div class="vsname me">First Down Syndrome</div>
          <div class="vsproj">projeção ${LINEUP.myProjected!=null?`<b>${LINEUP.myProjected}</b>`:"—"}</div>
        </div>
      </div>
      <div class="vsvs">versus</div>
      <div class="vsside">
        <div style="text-align:right">
          <div class="vsname">${opp.teamName||"—"}</div>
          <div class="vsproj">projeção ${opp.projected!=null?`<b>${opp.projected}</b>`:"—"}</div>
        </div>
      </div>
    </div>
    ${renderScoreSim()}
    ${LINEUP.summary?`<div class="insightsBody" style="border-top:1px solid var(--line)">${LINEUP.summary}</div>`:""}
  </div>`;

  const slots=LINEUP.slots.map(s=>{
    const metrics=(s.metrics||[]).map(m=>
      `<span class="metric ${m.tone||""}">${m.label} <b>${m.value}</b></span>`).join("");
    const verdictCls = s.verdict==="risky" ? "risky" : s.verdict==="sit" ? "sit" : "start";
    const verdictTxt = s.verdict==="risky" ? "com ressalva" : s.verdict==="sit" ? "evitar" : "escalar";
    return `<div class="slotRow">
      <div class="slotHd">
        <span class="slotTag">${s.slot}</span>
        ${imgTag(headshotUrl(s.id),"headshot sm",s.pos)}
        <span class="pos ${s.pos}">${s.pos}</span>
        <span class="nm">${s.name}</span><span class="tm">${s.team||""}</span>
        <span class="verdict ${verdictCls}">${verdictTxt}</span>
      </div>
      ${metrics?`<div class="slotMeta">${metrics}</div>`:""}
      <div class="slotWhy">${s.why||""}</div>
      ${s.alt?`<div class="benchNote">no banco nessa vaga: <b>${s.alt.name}</b> — ${s.alt.why}</div>`:""}
    </div>`;
  }).join("");

  const bench=(LINEUP.benchNotes||[]).length
    ? `<div class="card">
        <div class="hd"><span>Banco · quem monitorar</span></div>
        ${LINEUP.benchNotes.map(b=>`<div class="slotRow"><div class="slotHd"><span class="nm">${b.name}</span></div><div class="slotWhy">${b.note}</div></div>`).join("")}
      </div>`
    : "";

  wrap.innerHTML = vs
    + `<div class="card"><div class="hd"><span>Escalação recomendada</span><span>${LINEUP.slots.length} vagas</span></div>${slots}</div>`
    + renderOppLineup()
    + bench
    + renderTrackRecord();
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
          <li><b>Malik Washington (banco)</b> — no jogo de abertura da pré-temporada, ele e Caleb Douglas foram
            claramente a dupla titular de wide receivers do Miami, já com distância dos outros nomes da posição.
            Bom sinal pra quem já tem ele no elenco.</li>
          <li>Nenhuma notícia negativa nova achada pros seus outros titulares além do que já está na aba
            Lesões (Waddle, Metcalf, Monangai — todos com prognóstico ok).</li>
        </ul>

        <h3>Disputas de posição pra ficar de olho</h3>
        <ul>
          <li><b>49ers:</b> Jordan James está ganhando mais trabalho que o rookie de 3ª rodada Jaboree Black
            como RB2 atrás de McCaffrey.</li>
          <li><b>Ravens:</b> com Rashod Bateman fora de 2 treinos, o rookie de 3ª rodada Ja'Kobi Lane ganhou
            espaço pra brigar pelo posto de WR2 atrás de Zay Flowers.</li>
          <li><b>Colts:</b> com a saída de Michael Pittman (agora nos Steelers), Alec Pierce vira sleeper — foi
            2º da liga em jardas por recepção (21.3) no ano passado, e algum modelo já projeta ele acima de
            nomes como Nabers/Jefferson.</li>
          <li><b>Steelers:</b> com Michael Pittman machucado (veja aba Lesões), o rookie de 2ª rodada Germie
            Bernard vem mostrando que está pronto pra ser o WR3 do time, superando o outro rookie Roman Wilson
            no camp — veja detalhes na aba Hot Waivers.</li>
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
          <li><a href="https://www.fantasypros.com/2026/08/fantasy-football-20-nfl-preseason-week-1-takeaways-2026/" target="_blank" rel="noopener">FantasyPros — 20 Takeaways da Semana 1 de pré-temporada</a></li>
          <li><a href="https://www.espn.com/fantasy/football/story/_/id/49576653/fantasy-football-draft-targets-picks-fliers-breakouts-matt-bowen-2026" target="_blank" rel="noopener">ESPN (Matt Bowen) — Draft targets e breakouts 2026</a></li>
        </ul>
      </div>
    </div>`;
}
renderInsights();

// Cada pick carrega week/seasonType (quando foi identificado) e status ("available" ou "picked" se
// alguém da liga já adicionou — nesse caso mantém no histórico em vez de apagar).
const HOT_WAIVERS = [
  {
    id:"13274", name:"Germie Bernard", pos:"WR", team:"PIT",
    week:2, seasonType:"pre", status:"available",
    why:`Pick de 2ª rodada dos Steelers (time subiu no draft pra pegar ele). No primeiro jogo da pré-temporada
      já mostrou por que foi escolha alta — está pronto pra ser o WR3 do time, superando o outro rookie Roman
      Wilson no camp, e é o backup direto de Michael Pittman Jr. Como o Pittman está machucado agora (ver aba
      Lesões), Bernard pode ganhar oportunidade real de titular em cima da hora se a lesão persistir. Ainda
      é agente livre nessa liga.`,
    links:[
      {label:"Steelers Depot: pronto pra ser o WR3", url:"https://steelersdepot.com/2026/05/how-quickly-can-wr-germie-bernard-move-up-the-depth-chart/"},
      {label:"SI: rookie encerra a disputa de vaga", url:"https://www.si.com/nfl/steelers/onsi/pittsburgh-steelers-rookie-wr-germie-bernard-ends-debate"},
      {label:"ESPN (Matt Bowen): \"slam dunk\" no best ball", url:"https://www.espn.com/fantasy/football/story/_/id/49576653/fantasy-football-draft-targets-picks-fliers-breakouts-matt-bowen-2026"}
    ]
  }
];
const HOT_WAIVERS_NOTE = `Pesquisei de novo em 17/08/2026, incluindo fontes de análise (FantasyPros, ESPN, hubs
  de fantasy) além de contagem de snaps — vários nomes chamaram atenção (Isaac TeSlaa, Colbie Young, Kimani
  Vidal, Mike Washington), mas na apuração mais funda a maioria ou já está em algum time dessa liga, ou o sinal
  era fraco demais pra recomendar com confiança (ex: TeSlaa jogou com os reservas e errou os 3 alvos que teve).
  Só o Germie Bernard passou no crivo. Ainda é pré-temporada, então isso deve ficar enxuto por enquanto — assim
  que a temporada regular começar, volto a atualizar com mais frequência.`;

function renderHotWaivers(){
  const wrap=$("#tabHotWaivers");
  if(!HOT_WAIVERS.length){
    wrap.innerHTML=`<div class="card">
      <div class="insightsMeta">nenhum pick recomendado agora</div>
      <div class="insightsBody">${HOT_WAIVERS_NOTE}</div>
    </div>`;
    return;
  }
  function weekLabel(p){
    const wk = p.week!=null ? p.week : "?";
    return p.seasonType==="regular" ? `Semana ${wk}` : `Pré-temporada · Semana ${wk}`;
  }
  function weekKey(p){ return `${p.seasonType||"pre"}-${p.week!=null?p.week:0}`; }

  const groups={};
  HOT_WAIVERS.forEach(p=>{
    const k=weekKey(p);
    (groups[k]=groups[k]||{label:weekLabel(p), items:[]}).items.push(p);
  });
  // most recent week first: regular season sorts after preseason, higher week number first within each
  const sortedKeys=Object.keys(groups).sort((a,b)=>{
    const [aType,aWk]=a.split("-"); const [bType,bWk]=b.split("-");
    if(aType!==bType) return aType==="regular" ? -1 : 1;
    return Number(bWk)-Number(aWk);
  });

  const sections=sortedKeys.map(k=>{
    const g=groups[k];
    const cards=g.items.map(p=>`<div class="pickcard">
      <div class="pickhd">
        ${imgTag(headshotUrl(p.id),"headshot sm",p.pos)}
        <span class="pos ${p.pos}">${p.pos}</span>
        <span class="nm">${p.name}</span><span class="tm">${p.team||""}</span>
        ${p.status==="picked"?'<span class="badge add" style="margin-left:auto">já foi adicionado</span>':""}
      </div>
      <div class="why">${p.why}</div>
      <div class="picklinks">${(p.links||[]).map(l=>`<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join("")}</div>
    </div>`).join("");
    return `<div class="divHeader">${g.label}</div>${cards}`;
  }).join("");

  wrap.innerHTML=`<div class="card"><div class="hd"><span>Hot Waivers · picks com motivo</span><span>${HOT_WAIVERS.length} no histórico</span></div>${sections}</div>`;
}
renderHotWaivers();
renderLineup();

document.querySelectorAll(".tabBtn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("on"));
    btn.classList.add("on");
    document.querySelectorAll("main > div").forEach(d=>d.hidden=true);
    const map={lineup:"tabLineup",standings:"tabStandings",time:"tabTime",waivers:"tabWaivers",byes:"tabByes",hotwaivers:"tabHotWaivers",lesoes:"tabLesoes",usage:"tabUsage",insights:"tabInsights"};
    $("#"+map[btn.dataset.tab]).hidden=false;
  });
});

$("#refreshBtn").addEventListener("click", loadAll);

loadAll();
