# Labels de Triagem

As skills falam em termos de papéis canônicos de triagem. Este arquivo mapeia esses papéis para as strings reais de labels usadas no tracker deste repo.

| Papel canônico (skills) | Label no tracker | Tipo     | Significado                                  |
| ----------------------- | ---------------- | -------- | -------------------------------------------- |
| `needs-triage`          | `aguardando-triagem` | estado | Mantenedor precisa avaliar esta issue      |
| `needs-info`            | `aguardando-info`   | estado | Aguardando mais informações do reporter    |
| `ready-for-agent`       | `pronto-para-agente` | estado | Totalmente especificada, pronta para um agente |
| `ready-for-human`       | `pronto-para-humano` | estado | Requer implementação humana                 |
| `wontfix`               | `nao-faremos`       | estado | Não será executada                           |
| `bug`                   | `bug`               | categoria | Algo está quebrado                          |
| `enhancement`           | `melhoria`          | categoria | Nova feature ou melhoria                     |

Toda issue triada deve carregar **exatamente um papel de estado e um de categoria**.

Quando uma skill mencionar um papel (ex.: "aplique o label AFK-ready da triagem"), use a string de label correspondente desta tabela.

## Area labels (fora da triagem)

Labels de área **não fazem parte do fluxo de triagem** — são opcionais e servem para filtrar issues por módulo da arquitetura:

| Label            | Área                                                        |
| ---------------- | ----------------------------------------------------------- |
| `frontend`       | React + TypeScript + CSS (telas, tabuleiro, WebSocket client) |
| `backend-lobby`  | Servidor de Lobby (Express, autenticação, salas)            |
| `backend-jogo`   | Servidor de Jogo (WS, validação de jogadas, minigames)      |
| `redis`          | Estado volátil, Pub/Sub, mapeamento de salas                |
| `postgres`       | Persistência, usuários, partidas, ranking                   |
| `infra`          | NGINX, Docker, Docker Compose                               |

Edite a coluna da direita para combinar com o vocabulário que você realmente usa.
