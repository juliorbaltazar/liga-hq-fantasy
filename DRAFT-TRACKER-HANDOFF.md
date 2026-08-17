# Draft Tracker 2026 — Handoff para Claude Code

Documento pra você (Claude Code) assumir o projeto. O deliverable é uma ferramenta web
single-file (`draft-tracker.html`) que o dono usa **ao vivo durante o draft de fantasy da NFL**,
no celular. Suba este `.md` **junto com o `draft-tracker.html`** — o HTML é a fonte de verdade
do código e do pool de jogadores.

---

## 1. O que é

Rastreador de draft de fantasy football (NFL, temporada 2026). Roda offline, no navegador do
celular. Serve pra, durante o draft: marcar quem já foi escolhido, saber de quem é a vez,
destacar os alvos do dono e montar o time dele automaticamente quando chega a vez dele.

Prioridades de design, nesta ordem: **funcionar offline**, **ser rápido de tocar no celular**,
**legibilidade em tela pequena**. É ferramenta de uso sob pressão, não site de marketing.

---

## 2. Contexto da liga (fixo no código hoje)

- Liga "Fantasy 26", **12 times**, draft **snake**, **redraft**, **1 QB** (não superflex).
- O dono está na **vaga 8** (pick 8 geral).
- Picks dele (snake, seat 8): **8, 17, 32, 41, 56, 65, 80, 89, 104, 113, 128, 137, 152, 161**.
  - Calculados no código: `round ímpar → (round-1)*12+8`; `round par → round*12-7`.
- Se a vaga/idas mudarem, é só trocar o cálculo de `MYPICKS` e o texto do subtítulo.

---

## 3. Board do dono (alvos) — em ordem de prioridade dele

No código, alvo = `t:1` (aparece com ★ e entra no radar de "alvos restantes").

**QB** (prioridade definida por ele, NÃO por ADP):
1. Josh Allen (BUF)
2. Jaxson Dart (NYG)
3. Caleb Williams (CHI)
4. Tyler Shough (NO)

**RB:**
1. Jonathan Taylor (IND)
2. De'Von Achane (MIA)
3. Kenneth Walker III (KC)
4. Jeremiyah Love (ARI) — novato
5. Cam Skattebo (NYG)

**WR:**
1. Ja'Marr Chase (CIN)
2. Jaxon Smith-Njigba (SEA)
3. Amon-Ra St. Brown (DET)
4. Justin Jefferson (MIN)

**TE:**
1. Trey McBride (ARI)
2. Brock Bowers (LV)
3. Colston Loveland (CHI)
4. Tyler Warren (IND)
5. Harold Fannin Jr. (CLE)
6. Isaiah Likely (NYG)

> Obs: no pool o campo `r` (ADP) ordena a tabela, então Achane/Walker aparecem por ADP, não
> pela preferência dele. A preferência acima é o desempate na hora.

---

## 4. Estratégia que ficou acordada (contexto pra sugestões futuras)

- **Rodadas 1-2: RB-RB.** Pick 8 = Jonathan Taylor se sobrar (senão o melhor WR de elite que
  cair). Pick 17 = Achane ou Kenneth Walker se um deles estiver lá; se o backfield secou,
  pivota pro melhor WR (A.J. Brown / Drake London).
- **Rodada 3+ (pick 32...): WR.** Tier London / Rashee Rice / Tee Higgins / Garrett Wilson /
  McMillan / McConkey é fundo e pinga bem aqui.
- **QB só tarde.** Liga de 1QB, posição fundíssima. Alvos saem: Caleb ~pick 65, Dart ~pick 80.
  Dá pra pegar os dois e deixar brigando. **Não** trocar picks pra subir por QB.
- **TE tarde com stack.** Loveland casa com Caleb (ataque do Ben Johnson); Likely casa com Dart
  (Giants). Não pagar Bowers no pick 17 (custo de oportunidade alto vs RB2/WR1).
- **Trocas:** analisamos trocar a vaga 8 pela vaga 2 (só vale pagando sweetener, porque todo o
  prêmio está no #2 geral) e trocas de posição com o vizinho da vaga 2 — conclusão: ficar na
  vaga 8. Não dar o pick 17 (é o melhor ativo depois do 8).

---

## 5. Estado atual do código

- Arquivo único: **`draft-tracker.html`**. HTML + CSS + JS vanilla, **sem libs externas**
  (tem que rodar offline no meio do draft). Não importar nada de CDN.
- **172 jogadores** no pool: skill players (QB/RB/WR/TE) fundos + 12 defesas (DST) + 10 kickers.
- Tema escuro estilo "placar". Mobile-first, `max-width` centralizado.

### Features que já funcionam
- **Relógio de pick automático.** Cada jogador marcado como escolhido avança o pick geral.
  Quando o pick geral cai numa vaga do dono (`MYSET`), o banner acende "SUA VEZ" e o próximo
  jogador tocado entra no **time dele** automaticamente.
- **Banner de vez:** mostra pick atual (#N), rodada, e "sua próxima: #X (faltam Y)".
- **Radar de alvos:** quantos alvos do dono ainda estão no board, por posição (QB/RB/WR/TE).
- **Tabela** com colunas `# (ADP) · Pos · Jogador · Pick`, agrupada em 3 blocos:
  **Disponíveis**, **Meu time**, **Já saíram**.
- **Coluna Pick** mostra `R{rodada}·{pick}` da liga (ex: `R2·17`).
- **Filtros:** dropdown de posição (Todas/QB/RB/WR/TE/DEF/K) + checkboxes "só alvos ★",
  "só novatos", "esconder quem saiu" + busca por nome.
- **Novatos 2026** com tag `NOVATO` e, quando conhecido, o pick do draft da NFL (ex: `#3 geral`).
- **Botões de resync:** "Pularam uma" (avança sem nomear ninguém) e "Voltar" (desfaz a última).
- **Reset** com confirmação inline (dois botões "sim/cancelar"), **sem** `confirm()`.
- **Persistência** via `window.storage` (chave `drafttracker2026v5`) com fallback em memória.

---

## 6. Modelo de dados

```js
// POOL: array de jogadores
{
  r,    // rank ADP (ordena a tabela). DST usa 200+, K usa 220+ pra caírem no fim
  n,    // nome
  p,    // posição: "QB" | "RB" | "WR" | "TE" | "DST" | "K"
  tm,   // time (sigla)
  t,    // 1 se for alvo do dono (opcional)
  rk,   // 1 se novato 2026 (opcional)
  nd,   // pick no draft da NFL, string, ex "#3 geral" / "R2" (opcional)
  id    // atribuído no load: "p" + índice
}

// state (persistido: order + custom)
{
  order: [],      // ids na ordem em que saíram; índice+1 = pick geral. "__skip__" = pick sem nome
  custom: [],     // jogadores adicionados na mão pelo dono
  pos, onlyTgt, onlyRook, query, hide  // filtros de UI (não persistidos)
}
```

Funções-chave: `pickOf(id)` (pick geral, 0 = disponível), `statusOf(id)`
(`avail` | `mine` se pick ∈ MYSET | `gone`), `currentPick()` (= `order.length+1`),
`rp(pk)` (formata `R{rodada}·{pick}`).

### Interação
- Tocar linha **disponível** → `order.push(id)` (marca escolhido no pick atual).
- Se esse pick ∈ MYSET → vira "mine" automaticamente (time do dono).
- Tocar linha **já escolhida** → `free(id)` (remove do `order`, volta pro board).
- "Pularam uma" → `order.push("__skip__")`. "Voltar" → `order.pop()`.

---

## 7. Pedido atual (fazer primeiro)

A visualização de "quem já saiu" está ruim: enterrada no fim da página única. O dono pediu
**formato mais de planilha, com o histórico de quem saiu fácil de ver.**

Implementar:
1. **Abas** no topo da tabela: **Disponíveis** · **Já saíram** · **Meu time** · **Todos**.
   - "Já saíram" em ordem de pick (histórico do draft: pick 1, 2, 3...), tipo log.
   - Cada aba com contador.
2. Deixar mais **cara de planilha**: linhas de grade visíveis, **coluna de Time separada**
   (hoje o time vem colado no nome), colunas alinhadas e densas.
3. Manter tudo que já funciona (relógio de pick, SUA VEZ, filtros, novatos, persistência).

Sugestão: as abas podem coexistir com o dropdown de posição (aba escolhe o status, dropdown
recorta a posição dentro da aba).

---

## 8. Backlog / melhorias possíveis

- Coluna de bye week por jogador (útil no draft; exige dados de bye 2026).
- Contador de necessidades do elenco (quantos QB/RB/WR/TE/FLEX/DEF/K faltam preencher).
- Marcar "run" de posição (ex: alertar quando muitos RBs saem seguidos).
- Exportar o time montado (copiar/baixar).
- Expandir pool além de 172 e revisar times do tier fundo (ver limitações abaixo).

---

## 9. Restrições técnicas (IMPORTANTE — não quebrar)

- **Não usar** `localStorage`, `sessionStorage`, `confirm()`, `prompt()`, `alert()` — bloqueados
  no ambiente de render. Persistência é só `window.storage` (async) com try/catch → fallback
  em memória. Confirmações destrutivas usam padrão de "revelar dois botões inline".
- **Sem dependências externas / CDN.** Tudo inline, offline.
- Single file. Mobile-first. Testar que o JS parseia (`new Function(script)`).
- Se mudar a chave de storage, o progresso salvo zera — só fazer isso de propósito.

---

## 10. Limitações conhecidas dos dados

- Temporada 2026, dados de agosto/2026 (pré-season).
- Times dos jogadores do tier fundo (ADP ~100+) são o melhor palpite de agosto e podem mudar
  com corte de elenco. Os do topo (que importam pro draft) estão corretos.
- Flags de novato: só os confirmados de 2026. Pick do draft da NFL (`nd`) está preenchido só
  onde havia certeza; vários novatos estão sem `nd`.
- ADP (`r`) é aproximado, baseado em consenso. Achane/Walker são praticamente empate.

---

## 11. Pool atual (referência rápida — a fonte real é o array `POOL` no HTML)

Top do board (ADP 1-30, ★ = alvo do dono):
Chase★, Gibbs, Bijan, Puka Nacua, JSN★, CMC, Amon-Ra★, CeeDee Lamb, Jefferson★,
Jonathan Taylor★, Nico Collins, Malik Nabers, Ashton Jeanty, Omarion Hampton, Saquon,
Kenneth Walker★, Achane★, A.J. Brown, Derrick Henry, Bowers★, Rashee Rice, Drake London,
Jeremiyah Love★(novato), McBride★, Pickens, DeVonta Smith, Breece Hall, Kyren Williams,
Chris Olave, Zay Flowers.

Novatos 2026 marcados no pool: Jeremiyah Love, Jordyn Tyson, Carnell Tate, Makai Lemon,
KC Concepcion, Denzel Boston, Jadarian Price, Kaytron Allen, Carson Beck, Zachariah Branch,
Malachi Fields, Ja'Kobi Lane, Chris Brazzell, Zavion Thomas.

DST (12) e K (10) no fim do pool pra streaming nas últimas rodadas.
