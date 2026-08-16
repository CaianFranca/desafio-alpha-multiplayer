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

## Labels de área (fora da triagem)

Labels de área **não fazem parte do fluxo de triagem** — são opcionais e servem
para filtrar issues pela parte do sistema afetada. Uma issue pai ou spec pode
carregar mais de uma área quando atravessar fronteiras do sistema. Tickets de
implementação derivados dela devem carregar exatamente uma área, para manter
as responsabilidades dos grupos separadas:

| Label             | Área                                                          |
| ----------------- | ------------------------------------------------------------- |
| `frontend`        | React, TypeScript, CSS, telas, tabuleiro e cliente WebSocket  |
| `backend`         | Servidores, APIs, regras de negócio, engine, shared e OpenAPI |
| `infra`           | NGINX, Docker, Docker Compose e configuração de implantação   |
| `banco-de-dados`  | PostgreSQL, Redis, migrations, seeds e persistência de estado |

Redis e PostgreSQL ficam agrupados em `banco-de-dados`. Cada ticket que
atravessar duas áreas deve ser dividido em tickets separados e conectado por
dependências. Esses labels não substituem os dois labels obrigatórios da
triagem: uma categoria e um estado.
