// Proxy pro Cloudflare Realtime SFU.
// Existe só porque o App Secret não pode ir pro navegador — quem tivesse o
// secret poderia queimar a cota de 1TB da sua conta. O Worker guarda o segredo
// e repassa as chamadas; o navegador nunca vê o token.
//
// Deploy: veja sfu/README.md

const API = "https://rtc.live.cloudflare.com/v1";

// Endpoints que o cliente pode chamar. Lista fechada de propósito: sem isso o
// Worker vira um proxy aberto pra qualquer rota da API com o seu token.
const ALLOWED = [
  /^\/sessions\/new$/,
  /^\/sessions\/[\w-]+\/tracks\/new$/,
  /^\/sessions\/[\w-]+\/renegotiate$/,
  /^\/sessions\/[\w-]+\/tracks\/close$/,
  /^\/sessions\/[\w-]+$/,
];

function cors(res, origin) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin || "*");
  h.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type,X-Room-Key");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);

    const url = new URL(req.url);
    if (!url.pathname.startsWith("/sfu/")) {
      return cors(new Response("not found", { status: 404 }), origin);
    }
    const path = url.pathname.slice(4); // tira o prefixo /sfu

    if (!ALLOWED.some((re) => re.test(path))) {
      return cors(new Response(JSON.stringify({ error: "rota não permitida" }), { status: 403 }), origin);
    }

    // Trava opcional: só quem sabe a chave da sala usa a sua cota.
    if (env.ROOM_KEY && req.headers.get("X-Room-Key") !== env.ROOM_KEY) {
      return cors(new Response(JSON.stringify({ error: "chave inválida" }), { status: 401 }), origin);
    }

    if (!env.SFU_APP_ID || !env.SFU_APP_TOKEN) {
      return cors(
        new Response(JSON.stringify({ error: "SFU_APP_ID/SFU_APP_TOKEN não configurados" }), { status: 500 }),
        origin
      );
    }

    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.text();

    let upstream;
    try {
      upstream = await fetch(`${API}/apps/${env.SFU_APP_ID}${path}`, {
        method: req.method,
        headers: {
          Authorization: `Bearer ${env.SFU_APP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body,
      });
    } catch (e) {
      return cors(new Response(JSON.stringify({ error: "falha ao falar com o SFU: " + e.message }), { status: 502 }), origin);
    }

    return cors(
      new Response(await upstream.text(), {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      }),
      origin
    );
  },
};
