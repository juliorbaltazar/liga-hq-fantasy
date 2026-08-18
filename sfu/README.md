# SFU grátis via Cloudflare Realtime

Tira o peso da sua máquina: hoje você roda **um encoder por espectador** e seu
upload cresce com o número de amigos. Com SFU você encoda **uma vez** e o
servidor replica — que é exatamente como o Go Live do Discord funciona.

| com 4 espectadores | malha (hoje) | SFU |
|---|---|---|
| encoders na sua máquina | 4 | **1** |
| seu upload | 4 Mbps rateado | ~4 Mbps, fixo |
| qualidade que cada um recebe | 1 Mbps | **4 Mbps** |
| entra o 5º | tudo piora | não muda nada |

**Custo: R$ 0.** Cloudflare Realtime dá 1.000 GB/mês grátis. O consumo de vocês
é ~7,2 GB por hora com 4 espectadores, ou seja ~138 horas/mês. Workers dá
100.000 requisições/dia e cada pessoa gasta um punhado ao entrar.

---

## Passo 1 — Criar o app de SFU

1. Painel da Cloudflare → **Realtime** → **SFU** → *Create App*
2. Guarde o **App ID** e o **App Token**

## Passo 2 — Publicar o Worker

```bash
npm install -g wrangler
wrangler login

cd sfu
# cole o App ID em wrangler.toml (não é segredo)
wrangler secret put SFU_APP_TOKEN     # cola o token quando pedir
wrangler secret put ROOM_KEY          # opcional: uma senha qualquer
wrangler deploy
```

No fim ele imprime a URL, algo como `https://tela-sfu.SEU-SUBDOMINIO.workers.dev`.

> O Worker existe só pra guardar o App Token. Se o token fosse pro navegador,
> qualquer um que abrisse o DevTools poderia torrar sua cota de 1 TB.

## Passo 3 — Testar antes de mexer no app

Abra `sfu-test.html`, cole a URL do Worker (e o ROOM_KEY, se criou) e clique em
**rodar teste**.

Ele cria duas sessões separadas, publica um vídeo numa e puxa na outra pelo SFU.
Se o vídeo da direita aparecer e o log disser `✅ FUNCIONOU`, a base está de pé
e dá pra migrar o app com segurança.

### Se der erro

| mensagem | causa provável |
|---|---|
| `401: chave inválida` | ROOM_KEY do campo não bate com o do `wrangler secret` |
| `403: rota não permitida` | URL do Worker digitada errada |
| `500: SFU_APP_ID... não configurados` | faltou o App ID no `wrangler.toml` ou o `secret put` |
| conectou mas 0 frames | rede bloqueando UDP — teste em outra rede; pode precisar de TURN |

## Passo 4 — Migrar o app

Só depois que o teste passar. O que muda em `discord-screenshare.html`:

- **Sai:** a malha de mídia (`myPeer.call`), o rateio de banda por espectador e
  o reporte de resolução — com um encoder só, nada disso faz sentido.
- **Fica:** toda a UI, e o PeerJS passa a carregar **só sinalização** (quem está
  na sala, quem está publicando). Isso é texto, não vídeo — não pesa.
- **Entra:** uma `RTCPeerConnection` única pro Cloudflare, que publica sua tela e
  puxa a de todo mundo.

Depois disso dá pra ativar **simulcast**: você encoda 2–3 camadas de qualidade
uma vez só e o SFU entrega pra cada pessoa a que couber na tela e na banda dela.
Aí fica igual ao Discord de verdade.
