# Tela Compartilhada — servidor próprio (LiveKit)

Substitui a malha P2P por um SFU. **Você encoda uma vez**, o servidor distribui —
não importa se são 5 ou 20 pessoas. É a mesma arquitetura do Go Live do Discord.

Aceita duas formas de transmitir **na mesma sala**:

| | como transmite | precisa de navegador? |
|---|---|---|
| **Normal** | botão "compartilhar tela" no site | sim |
| **OBS** | OBS empurra por WHIP | **não** (só na configuração, uma vez) |

Pra quem assiste os dois são idênticos: aparecem lado a lado no mosaico.

---

## Por que OBS é melhor pra jogo

- **Game Capture** engancha no jogo em vez de copiar a tela toda pelo compositor
- **NVENC direto**, com controle total — nada de torcer pro navegador pegar hardware
- Sem o compositor do navegador no caminho

Quem joga configura o OBS uma vez e depois nunca mais abre o site.

---

## Passo 1 — VM na Oracle (grátis pra sempre)

Always Free: 4 cores ARM, 24 GB RAM, **10 TB de saída/mês**, região São Paulo.

1. Crie uma instância **VM.Standard.A1.Flex** (4 OCPU / 24 GB), Ubuntu 22.04
2. **Security List** da VCN → libere entrada:

| Porta | Protocolo | Pra quê |
|---|---|---|
| 80, 443 | TCP | HTTPS e certificado |
| 7881 | TCP | WebRTC (fallback) |
| 7882 | UDP | WebRTC (principal) |
| 7885 | UDP | ICE do WHIP (OBS) |

3. **Libere também no firewall interno** — a imagem Ubuntu da Oracle vem com
   iptables fechado e esse é o erro nº 1 de quem monta isso:

```bash
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 7881 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 7882 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 7885 -j ACCEPT
sudo netfilter-persistent save
```

> Se a Oracle recusar criar a instância ARM com "out of capacity", tente outro
> domínio de disponibilidade ou repita mais tarde. É comum e não é erro seu.

## Passo 2 — Domínio grátis

Crie uma conta no [DuckDNS](https://duckdns.org), registre `SEUNOME` e aponte
pro IP público da VM. Subdomínios funcionam automaticamente, então você terá:

- `sala.SEUNOME.duckdns.org` → o SFU e os tokens
- `whip.SEUNOME.duckdns.org` → a entrada do OBS

## Passo 3 — Subir a stack

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
git clone SEU_REPO && cd livekit

# gera o par de chaves
docker run --rm livekit/livekit-server generate-keys

cp .env.example .env
nano .env          # cole as chaves e troque SEUNOME pelos seus domínios

# injeta as chaves nos configs
source .env
sed -i "s/API_KEY_PLACEHOLDER/$LIVEKIT_API_KEY/;s/API_SECRET_PLACEHOLDER/$LIVEKIT_API_SECRET/" livekit.yaml ingress.yaml

docker compose up -d
docker compose logs -f caddy    # veja o certificado sendo emitido
```

## Passo 4 — Conferir

```bash
curl https://sala.SEUNOME.duckdns.org/api/token -X POST \
  -H 'Content-Type: application/json' -d '{"name":"teste"}'
```

Tem que voltar um JSON com `token`. Se voltar, o SFU e o TLS estão de pé.

## Passo 5 — OBS

No site, quem quiser usar OBS clica em **"transmitir pelo OBS"** e recebe:

- **URL**: `https://whip.SEUNOME.duckdns.org/w`
- **Chave**: gerada pra pessoa

No OBS: `Configurações → Transmissão → Serviço: WHIP`, cola os dois, e
`Iniciar Transmissão`.

Como o endereço é reaproveitado, **isso é uma vez só**. Depois é só abrir o OBS.

Ajustes recomendados pra jogo (`Configurações → Saída → Avançado`):

- Encoder: **NVENC H.264** (ou AMD/QuickSync)
- Controle de taxa: **CBR**, 4000–6000 Kbps
- Preset: **P4 / Low-Latency Quality**
- Keyframe: **1s** (importante — quem entra depois só vê imagem no próximo keyframe)

---

## Manutenção

```bash
docker compose pull && docker compose up -d    # atualizar
docker compose logs -f livekit ingress          # investigar
docker stats                                    # ver consumo
```

O certificado o Caddy renova sozinho.

---

## O que não foi testado

Montei esses arquivos a partir da documentação do LiveKit e do OBS, **sem
executar**. O formato do config do Ingress (Redis obrigatório, WHIP na 8080,
UDP 7885) veio da doc oficial, e os YAML/JS estão validados sintaticamente —
mas a integração real só se confirma subindo.

Os pontos com maior chance de precisar de ajuste:

1. **Caminho exato do WHIP** (`/w` vs outro) — confirme no que o `/api/ingress`
   devolver; ele retorna a URL correta, use ela em vez da que está aqui.
2. **`network_mode: host`** nos serviços de mídia — é o que faz o UDP funcionar,
   mas conflita com o mapeamento de portas do compose se você mexer.
3. **`enableTranscoding: false`** — se o OBS mandar num codec que o WebRTC não
   aceita, o ingress recusa. Nesse caso force H.264 no OBS.

Suba, rode o Passo 4, e me mande o que der errado que eu ajusto.
