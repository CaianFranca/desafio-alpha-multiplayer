# ADR-0005: Limpeza na Confirmação de Posição, Individual por Turno

Status: Aceito
Data: 2026-08-30

## Contexto

A ST-13 introduz a limpeza do tabuleiro — remoção permanente das peças cujas
células ficaram fora da iluminação dos peões — e dizia que ela se aplica
"quando a iluminação muda por posicionamento ou movimentação de peão". A ST-11,
porém, permite desfazer uma movimentação até a Confirmação de Posição: se a
limpeza rodasse na movimentação tentativa, uma jogada desfeita destruiria
peças de forma irreversível. Além disso, não estava registrado se a limpeza é
global ou por turno.

## Decisão

A limpeza é individual: dispara no turno do Jogador Ativo, no máximo uma vez,
exatamente quando a iluminação muda — no posicionamento do peão do Primeiro
Turno (definitivo, sem desfazer) ou na Confirmação de Posição com mudança de
peça. Permanência e Encerramento do Turno não geram limpeza. As peças removidas
são eliminadas definitivamente da partida, sem destino intermediário (não
existe "lixo" como entidade) e sem retorno à caixa. A remoção é comunicada aos
quatro jogadores simultaneamente, em um único evento por aplicação de limpeza.

## Porquê

- **Preserva o desfazer**: a ST-11 garante movimentação desfazível até a
  confirmação; a limpeza só pode agir sobre posições finais.
- **Coerência de turno**: a iluminação só muda em pontos definitivos do turno,
  então "no máximo uma vez por turno" cobre todos os casos sem eventos vazios.
- **Determinismo do feedback**: um único evento por limpeza, transmitido a
  todos simultaneamente, evita remoções parciais percebidas fora de ordem.

## Alternativas consideradas

- **Limpeza na movimentação (literal da spec original)** — rejeitada:
  destruiria peças permanentemente em jogadas ainda desfazíveis.
- **Limpeza no Encerramento do Turno** — rejeitada: adia o efeito além do ponto
  em que a iluminação mudou e força o estado a carregar "peças pendentes de
  remoção".
- **Limpeza global simultânea entre jogadores** — rejeitada: o jogo é por
  turnos; só o Jogador Ativo altera o tabuleiro, então a limpeza por turno é a
  granularidade natural.
