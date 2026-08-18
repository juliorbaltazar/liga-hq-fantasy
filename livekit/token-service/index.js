// Dois endpoints, só isso:
//   POST /api/token   -> crachá pra entrar na sala pelo navegador
//   POST /api/ingress -> endereço + chave pra colar no OBS
//
// Existe porque os dois exigem assinar com a API secret, e secret no
// navegador significa qualquer um entrando na sua sala.

import http from "node:http";
import { AccessToken, IngressClient, IngressInput } from "livekit-server-sdk";

const {
  LIVEKIT_API_KEY: KEY,
  LIVEKIT_API_SECRET: SECRET,
  LIVEKIT_HOST: HOST,          // ex: https://sala.seunome.duckdns.org
  ROOM_NAME: ROOM = "sala-principal",
  ALLOWED_ORIGIN: ORIGIN = "*",
} = process.env;

if (!KEY || !SECRET || !HOST) {
  console.error("faltando LIVEKIT_API_KEY, LIVEKIT_API_SECRET ou LIVEKIT_HOST");
  process.exit(1);
}

const ingressClient = new IngressClient(HOST, KEY, SECRET);

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); }
    });
  });
}

const cleanName = (n) =>
  String(n || "").trim().slice(0, 24).replace(/[^\p{L}\p{N} _-]/gu, "") || "anon";

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") return send(res, 405, { error: "use POST" });

  const url = new URL(req.url, "http://x");
  const body = await readBody(req);
  const name = cleanName(body.name);

  try {
    if (url.pathname === "/api/token") {
      const at = new AccessToken(KEY, SECRET, {
        identity: `${name}-${Math.random().toString(36).slice(2, 7)}`,
        name,
      });
      at.addGrant({
        roomJoin: true,
        room: ROOM,
        canPublish: true,
        canSubscribe: true,
      });
      return send(res, 200, { token: await at.toJwt(), room: ROOM });
    }

    if (url.pathname === "/api/ingress") {
      // Reaproveita o ingress da pessoa se já existir. É isso que permite
      // configurar o OBS UMA vez e nunca mais abrir o navegador.
      const existing = (await ingressClient.listIngress({ roomName: ROOM }))
        .find((i) => i.participantIdentity === `obs-${name}`);

      if (existing?.url && existing?.streamKey) {
        return send(res, 200, {
          url: existing.url,
          streamKey: existing.streamKey,
          reused: true,
        });
      }

      const info = await ingressClient.createIngress(IngressInput.WHIP_INPUT, {
        name: `obs-${name}`,
        roomName: ROOM,
        participantIdentity: `obs-${name}`,
        participantName: `${name} (OBS)`,
        // Sem recodificar: o WHIP já chega em WebRTC. Transcodificar aqui
        // derrubaria a VM de 4 cores.
        enableTranscoding: false,
      });

      return send(res, 200, {
        url: info.url,
        streamKey: info.streamKey,
        reused: false,
      });
    }

    return send(res, 404, { error: "rota desconhecida" });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: e.message });
  }
});

server.listen(8090, () => console.log("token-service em :8090, sala:", ROOM));
