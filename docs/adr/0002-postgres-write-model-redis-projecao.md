# ADR-0002: PostgreSQL como Write-Model e Redis como Projeção do Lobby

Status: Aceito
Data: 2026-08-17

## Contexto

O lobby precisa de dados que sobrevivam a restarts (contas, salas, ordem de
entrada, anfitrião) e de dados de alta frequência que morrem com o fluxo
(prontidão, conexão, janelas de reconexão). A ST-03 listava ambos os
conjuntos sem definir qual armazenamento é a fonte da verdade, e um leitor
do código poderia assumir o oposto do que foi decidido (salas vivendo só
no Redis enquanto abertas).

## Decisão

O PostgreSQL é o write-model e a fonte da verdade: salas e membros são
inseridos no momento da criação/entrada, e o Redis é apenas projeção
quente, reconstruível, com TTL. Dados puramente transitórios (prontidão,
estado de conexão, janela de reconexão, sessões de refresh token) existem
somente no Redis e não são persistidos no PostgreSQL, exceto o `status` da
sala, espelhado apenas em transições relevantes (`aberta → encaminhada`,
`encerrada`, `expirada`).

Após a reconstrução da projeção, os membros reaparecem desconectados e não
prontos, e as mutações da sala aguardam a reconstrução. A janela de
reconexão sobrevive a reinício do lobby enquanto a projeção Redis for
preservada, mas não exige sobrevivência à perda do Redis.

## Porquê

- **Sobrevivência**: ordem de entrada e anfitrião resistem a crash/restart
  do Redis ou dos serviços; o lobby reconstrói a projeção a partir do
  PostgreSQL.
- **Consistência**: uma única fonte da verdade elimina sincronização
  bidirecional; o Redis nunca é gravado de forma independente.
- **Custo**: no volume de um lobby de 4 jogadores, a escrita extra no
  PostgreSQL é irrelevante frente ao risco de perder estado de sala.

## Alternativas consideradas

- **Sala só no Redis enquanto aberta, PostgreSQL apenas no fim da
  partida** — rejeitada: perde ordem de entrada e anfitrião em crash, e
  a transferência de propriedade exigiria escrita retroativa no Postgres.
- **Espelhar prontidão e conexão linha a linha no PostgreSQL** —
  rejeitada: gravar cada toggle de prontidão viola a separação
  permanente/temporário da ST-03 sem benefício de consulta.
