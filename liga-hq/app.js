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

    // snapshot committed daily by the GitHub Action — carries matchups, schedule,
    // defense-vs-position profiles, usage trends, projections and last-season baseline
    try{
      state.snapshot = await fetchJSON(`sleeper-snapshot.json?t=${Date.now()}`);
    }catch(e){ state.snapshot=null; }

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
  week: 2,
  seasonType: "pre",
  opponent: {teamName:"No Gi, No Huddle", owner:"joaoscarioli", projected:null},
  myProjected: null,
  summary: `<b>Leia isso antes:</b> ainda é <b>pré-temporada</b> — sua liga só pontua a partir da semana 1 da
    temporada regular, então esse confronto não vale nada de verdade. Estou usando essa semana como ensaio da
    ferramenta, com os dados reais que já existem. Duas ressalvas honestas sobre a qualidade do sinal agora:
    <b>(1)</b> o ranking de defesas abaixo vem de <b>um único jogo de pré-temporada</b>, com reservas em campo
    dos dois lados — é ruído, não tendência, e por isso eu <b>não</b> deixei ele derrubar nenhum titular de elite;
    <b>(2)</b> as projeções oficiais do Sleeper ainda não saíram pra pré-temporada. A partir da semana 1 regular
    esses dois furos se fecham sozinhos e a análise fica muito mais afiada. O que já é confiável hoje: status de
    lesão, quem enfrenta quem, participação em campo (snaps) e o histórico da temporada passada — e é neles que
    apoiei as decisões.`,
  slots: [
    {
      slot:"QB", id:"4984", name:"Josh Allen", pos:"QB", team:"BUF", verdict:"start",
      metrics:[
        {label:"2025", value:"22.0 pts/jogo", tone:"good"},
        {label:"CAR cede a QB", value:"15.1 (12º)"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`Único QB do elenco, e não é decisão difícil de qualquer forma: 22.0 pontos por jogo na temporada
        passada em 17 jogos completos, sem lesão. Carolina foi só o 12º que mais cedeu a QBs no recorte disponível,
        mas isso é irrelevante num jogador desse patamar — Allen é escalado contra qualquer defesa.`,
      alt:null
    },
    {
      slot:"RB1", id:"6813", name:"Jonathan Taylor", pos:"RB", team:"IND", verdict:"start",
      metrics:[
        {label:"2025", value:"21.3 pts/jogo", tone:"good"},
        {label:"NE cede a RB", value:"6.7 (29º)", tone:"bad"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`Confronto ruim no papel — New England aparece como 29ª defesa que menos cede a corredores. Mas escalar
        mesmo assim, sem pensar duas vezes: 21.3 pontos por jogo em 17 jogos é produção de RB1 absoluto, e o
        recorte de defesa vem de um jogo de pré-temporada (ou seja, quase sem valor preditivo). Nunca sente um RB
        desse nível por matchup — muito menos por matchup medido assim.`,
      alt:null
    },
    {
      slot:"RB2", id:"4866", name:"Saquon Barkley", pos:"RB", team:"PHI", verdict:"start",
      metrics:[
        {label:"2025", value:"14.5 pts/jogo", tone:"good"},
        {label:"BAL cede a RB", value:"5.0 (32º)", tone:"bad"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`Mesmo raciocínio, com o confronto ainda mais feio no papel: Baltimore é a defesa que menos cedeu a RBs
        nesse recorte. De novo — um jogo de pré-temporada não é motivo pra sentar alguém que fez 14.5 pontos por
        jogo. É a sua segunda melhor opção de corrida e entra como titular. Se essa leitura de Baltimore se
        confirmar na temporada regular (aí sim com amostra real), volto a levantar a questão.`,
      alt:null
    },
    {
      slot:"WR1", id:"5872", name:"Deebo Samuel", pos:"WR", team:"SF", verdict:"start",
      metrics:[
        {label:"2025", value:"11.8 pts/jogo", tone:"good"},
        {label:"TEN cede a WR", value:"42.0 (4º)", tone:"good"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`A escolha mais confortável do seu grupo de recebedores nessa semana: é o único dos seus WRs de topo
        que está <b>100% sem status de lesão</b>, e ainda pega o melhor confronto do grupo — Tennessee aparece
        como a 4ª defesa que mais cede a wide receivers (42.0 pontos). Saúde + confronto na mesma direção, sem
        precisar apostar em ninguém se recuperando.`,
      alt:null
    },
    {
      slot:"WR2", id:"5947", name:"Jakobi Meyers", pos:"WR", team:"JAX", verdict:"start",
      metrics:[
        {label:"2025", value:"11.0 pts/jogo"},
        {label:"NO cede a WR", value:"30.2 (13º)"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`Escolhido pelo mesmo critério do Deebo: <b>saúde limpa</b>. Seus outros WRs de nome (Metcalf e Waddle)
        estão os dois como questionable, e nessa vaga não vale correr risco duplo. Meyers entregou 11.0 pontos por
        jogo em 16 jogos no ano passado — piso confiável — e Nova Orleans é confronto neutro (13º que mais cede).
        Não é o teto mais alto do elenco, é a aposta mais segura pro segundo WR.`,
      alt:{name:"DK Metcalf", why:`teto maior e confronto melhor (Green Bay cede 39.1, 7º), mas está questionable
        e fora dos treinos desde 11/08 — prazo de retorno mais longo que o do Waddle. Se ele treinar normal até
        o sábado, vira o titular dessa vaga sem discussão.`}
    },
    {
      slot:"TE", id:"12506", name:"Harold Fannin", pos:"TE", team:"CLE", verdict:"start",
      metrics:[
        {label:"2025", value:"11.7 pts/jogo", tone:"good"},
        {label:"CHI cede a TE", value:"3.2 (30º)", tone:"bad"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`Único TE do elenco, então é escalação obrigatória — mas vale saber o cenário: Chicago aparece como
        30ª defesa contra tight ends (só 3.2 pontos cedidos). Fannin vem de 11.7 pontos por jogo em 16 jogos como
        novato, produção muito boa pra posição. Não dá pra fazer nada diferente essa semana, mas se seu TE virar
        problema recorrente, é a posição mais óbvia pra buscar no waiver.`,
      alt:null
    },
    {
      slot:"FLEX", id:"7526", name:"Jaylen Waddle", pos:"WR", team:"DEN", verdict:"risky",
      metrics:[
        {label:"2025", value:"12.1 pts/jogo", tone:"good"},
        {label:"ATL cede a WR", value:"31.7 (12º)"},
        {label:"lesão", value:"questionable", tone:"bad"}
      ],
      why:`Aqui é onde vale gastar o risco. Waddle tem o melhor prognóstico entre seus três questionable
        (~85% — estiramento leve, técnico Sean Payton já falou em volta em 4-5 dias, e ele treinou por fora sem
        a manga de compressão), e 12.1 pontos por jogo é teto de titular de verdade. Atlanta é confronto neutro
        (12º). <b>Confira o status dele antes do jogo</b> — se for rebaixado, o Allgeier é a troca direta.`,
      alt:{name:"Tyler Allgeier", why:`totalmente saudável e com bom confronto (Las Vegas cede 25.0 a RBs, 6º),
        mas jogou só 9% dos snaps do Arizona na semana 1 — volume baixo demais pra ser titular por escolha. É o
        plano B imediato se o Waddle não jogar.`}
    },
    {
      slot:"K", id:"8155", name:"Cameron Dicker", pos:"K", team:"LAC", verdict:"start",
      metrics:[
        {label:"2025", value:"9.8 pts/jogo"},
        {label:"lesão", value:"nenhuma", tone:"good"}
      ],
      why:`Único kicker do elenco. 9.8 pontos por jogo em 17 jogos no ano passado — é dos kickers mais
        consistentes da liga, não é posição que você precise mexer.`,
      alt:null
    },
    {
      slot:"DEF", id:"HOU", name:"Houston Texans", pos:"DEF", team:"HOU", verdict:"start",
      metrics:[
        {label:"jogo", value:"vs LAC"},
        {label:"lesão", value:"—"}
      ],
      why:`Única defesa do elenco. Enfrenta o Los Angeles Chargers. Defesa é a posição mais volátil do fantasy e
        a mais fácil de rotacionar via waiver semana a semana — se você quiser ganhar pontos de graça durante a
        temporada, é aqui que dá pra caçar confronto (ex: pegar a defesa que enfrenta o pior ataque da semana).`,
      alt:null
    }
  ],
  benchNotes: [
    {name:"DK Metcalf (WR, PIT) — questionable",
     note:`O caso mais importante do seu banco. Confronto excelente (Green Bay cede 39.1 pontos a WRs, 7º maior)
       e 12.5 pontos por jogo no ano passado, mas está fora dos treinos desde 11/08 e o técnico Mike McCarthy
       disse que ele estava "difícil" de voltar, com retorno previsto só pra última semana de agosto. Se ele
       aparecer nos treinos normalmente, ele entra na vaga do Meyers.`},
    {name:"Kyle Monangai (RB, CHI) — questionable",
     note:`Chama atenção porque tem o <b>melhor confronto do elenco inteiro</b>: Cleveland aparece como a defesa
       que MAIS cede a corredores (37.9 pontos, 1º lugar). O problema é o joelho — exames iniciais sem dano
       estrutural, mas ainda aguardando confirmação. Não passou na frente dos seus RBs de elite, mas se o
       Taylor ou o Saquon der problema, ele é o substituto natural com um confronto muito favorável.`},
    {name:"Malik Washington (WR, MIA)",
     note:`Vale monitorar por outro motivo: no jogo de abertura da pré-temporada, ele e Caleb Douglas foram
       claramente a dupla de WRs titulares do Miami, com distância dos outros. Ainda com poucos snaps (22%),
       mas se esse papel se confirmar na temporada regular ele sobe rápido de importância no seu elenco.`},
    {name:"Rashid Shaheed (WR, SEA) e Jalen Coker (WR, CAR)",
     note:`Ambos saudáveis, mas ficam de fora essa semana: Shaheed pega o confronto mais difícil do grupo
       (Dallas cede só 23.7 a WRs, 24º) e Coker jogou apenas 16% dos snaps da Carolina. São profundidade, não
       opções de escalação no momento.`}
  ]
};

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
    + bench;
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
    const map={lineup:"tabLineup",standings:"tabStandings",time:"tabTime",waivers:"tabWaivers",hotwaivers:"tabHotWaivers",lesoes:"tabLesoes",usage:"tabUsage",insights:"tabInsights"};
    $("#"+map[btn.dataset.tab]).hidden=false;
  });
});

$("#refreshBtn").addEventListener("click", loadAll);

loadAll();
