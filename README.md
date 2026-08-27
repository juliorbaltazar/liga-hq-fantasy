# VSCODE — projetos

Uma pasta por projeto.

| Pasta | O que é | Repo |
|---|---|---|
| [`liga-hq/`](liga-hq/) | Painel da liga de fantasy (Sleeper): escalação, byes, waivers, lesões. Alimentado pelo snapshot diário do GitHub Actions. | este |
| [`draft-tracker/`](draft-tracker/) | Rastreador de draft single-file, offline, usado no celular ao vivo durante o draft. | este |
| [`tela-compartilhada/`](tela-compartilhada/) | Só os stubs de redirecionamento. O app foi pra [repositório próprio](https://juliorbaltazar.github.io/tela-compartilhada/). | próprio |
| [`baixador-videos/`](baixador-videos/) | App de desktop em Python pra baixar vídeo. | próprio (ignorado aqui) |

`.github/workflows/sleeper-snapshot.yml` roda todo dia às 07:00 (BRT) e commita
`liga-hq/sleeper-snapshot.json`. O caminho está fixo no workflow.
