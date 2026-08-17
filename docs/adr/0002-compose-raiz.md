# ADR-0002: Compose de Desenvolvimento na Raiz

Status: Aceito
Data: 2026-08-17

## Contexto

O monorepo possui uma configuração de infraestrutura em `infra/compose.yaml`,
mas o Compose orquestra o ambiente local inteiro, não apenas arquivos que
pertencem ao NGINX. Manter a entrada dentro de `infra/` torna o comando inicial
menos evidente e associa a orquestração a uma área específica.

Os serviços de aplicação previstos no ADR-0001 ainda não possuem Dockerfiles,
comandos de inicialização, portas ou contrato de ambiente definidos. Não há
informação suficiente para adicioná-los ao Compose sem inventar comportamento.

## Decisão

Usaremos um único `docker-compose.yml` na raiz como entrada do desenvolvimento
local. O template de ambiente ficará em `.env.example` na raiz; cada pessoa
deve copiá-lo para `.env`, que permanece ignorado pelo Git.

Arquivos específicos de infraestrutura, como a configuração do NGINX,
continuarão em `infra/`. Mover a entrada do Compose não implica mover todos os
artefatos de infraestrutura.

O Compose atual conterá somente PostgreSQL e Redis. Ambos participarão dos
perfis `db`, `backend`, `nginx` e `full`. Os perfis reservados são:

- `db` — trabalho isolado com dados;
- `backend` — dependências dos servidores backend;
- `frontend` — futuro serviço frontend;
- `nginx` — caminho completo atrás do proxy;
- `full` — frontend, backend, NGINX, PostgreSQL e Redis quando todos existirem.

O template define `COMPOSE_PROFILES=full`, fazendo `docker compose up` subir o
ambiente completo disponível. `nginx` é um alias operacional do caminho atrás
do proxy, não um perfil de NGINX isolado.

Serviços futuros serão adicionados somente quando seus Dockerfiles e contratos
de execução existirem. As imagens de aplicação serão construídas localmente.
As dependências backend deverão usar `depends_on` condicionado a healthchecks,
quando forem adicionadas. O `game-server` deverá continuar escalável
horizontalmente com o Compose.

Esta decisão cobre apenas o desenvolvimento local. Deploy de produção não faz
parte dela. O volume nomeado do PostgreSQL é novo e não haverá migração do
volume local anterior.

## Relação com o ADR-0001

O ADR-0001 continua definindo as fronteiras do monorepo e mantém `infra/` fora
dos aplicativos. Este ADR define somente onde fica a entrada da orquestração e
como ela evolui por perfis; a configuração do NGINX continua pertencendo a
`infra/`.

## Consequências

- O comando inicial do ambiente local é descoberto na raiz do repositório.
- Existe uma única fonte de verdade para a orquestração local.
- Perfis permitem iniciar apenas as dependências necessárias.
- A ausência de contratos impede que serviços futuros sejam representados por
  placeholders ou configurações inventadas.
- O volume PostgreSQL anterior não é reutilizado automaticamente.

## Alternativas consideradas

- **Manter `infra/compose.yaml`** — rejeitado: mantém a entrada de todo o
  ambiente associada a uma área específica e favorece comandos duplicados.
- **Adicionar todos os serviços previstos imediatamente** — rejeitado: os
  contratos de execução ainda não existem.
- **Criar Compose separado por área** — rejeitado: fragmenta a orquestração e
  reintroduz múltiplas fontes de verdade.
