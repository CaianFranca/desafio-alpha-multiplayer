# ADR-0006: Retorno à Sala via Callback HTTP do Game-Server ao Lobby

Status: Aceito
Data: 2026-09-01

## Contexto

A ST-16 termina a partida em vitória ou derrota e devolve os jogadores à sala
de origem. Lobby e game-server são serviços separados (ADR-0001), e o
Encaminhamento já é mediado por um offer HTTP síncrono lobby→game-server
(ADR-0003). Para o retorno, porém, não existe caminho algum: o game-server
nunca chama o lobby, e o engine da sala não tem transição
`encaminhada → aberta` — a sala ficaria presa no estado `encaminhada` para
sempre.

## Decisão

Ao término da partida, o game-server chama o lobby por HTTP
(request/response), comunicando o resultado e os jogadores da partida. O lobby
revalida e reabre a sala (`encaminhada → aberta`) com os mesmos Membros,
mantendo a ordem de entrada e o Anfitrião e redefinindo a Prontidão. Falhas do
callback são retomadas continuamente com backoff crescente, limitado em 30
segundos, até o lobby aceitar — sem fallback pelo cliente. O retorno dos
jogadores é navegacional e independente: cada um volta pelo botão da tela de
resultado, no seu ritmo, enquanto a transição da sala no servidor já aconteceu.

## Porquê

- **Simétrico ao Encaminhamento**: o offer do ADR-0003 já estabelece HTTP
  request/response entre os dois serviços; o callback é o fluxo inverso do
  mesmo padrão.
- **O lobby permanece o dono da verdade da sala**: a reabertura é decidida e
  executada pelo lobby, com revalidação, sem espalhar transição de estado
  pelos clientes.
- **Recuperação automática**: o estado da sala persiste no Postgres/projeção
  Redis (ADR-0002); um lobby temporariamente fora do ar aceita o callback
  pendente ao voltar, e o retry com backoff garante que a sala não fique
  presa.
- **Desacoplado da navegação**: a partida terminada fica somente-leitura no
  game-server; o jogador que recarrega a página volta a ver o resultado e
  retorna quando quiser, sem coordenação entre clientes.

## Alternativas consideradas

- **Lobby consulta o game-server (poll)** — rejeitada: o lobby não sabe
  quando perguntar; atrasa a reabertura e cria carga contínua para um evento
  único e pontual.
- **Reabertura dirigida pelo cliente** ("voltar à sala" pede revalidação ao
  lobby) — rejeitada: espalha a responsabilidade de transição de estado entre
  os quatro clientes, exige idempotência no lobby e deixa a sala presa se
  ninguém clicar; a transição server-to-server é única e atômica.
- **Redis Pub/Sub para o aviso de término** — rejeitada pelo mesmo motivo do
  ADR-0003: sem resposta direta, exigiria correlação manual e não confirma a
  reabertura.
