# ADR-0013: Desistência em Partida em Andamento

Status: Aceito
Data: 2026-09-10

## Contexto

O roster da Partida era imutável do início ao fim (ADR-0009 fixou N = 2–4
sem remoção — "isso pertence à #287"). A spec #287 pede que o jogo continue
sem o ausente: qualquer Jogador pode desistir da Partida em andamento, com
Passagem de Vez imediata se era o Jogador Ativo, Iluminação recalculada e
Limpeza no ato, vitória re-avaliada em N−1 e derrota quando sobra 1. A
issue #289 recorta o núcleo puro dessa mudança (só `packages/engine` + docs
de domínio), com a ADR-0010 reservando "abandono" para este ato (o
não-início é o cancelamento da Partida preparada).

## Decisão

Novo comando de domínio `desistir_da_partida` em `packages/engine`, com
efeito atômico e irreversível:

- **fora do `FORA_DA_VEZ`**: qualquer Jogador do roster desiste no próprio
  turno ou fora dele, com rota própria no dispatch; só o próprio
  (`ator === desistente`) é aceito;
- **recusas**: `PARTIDA_TERMINADA` se `resultado !== null` (antes de tudo,
  como os demais comandos); código novo e fechado
  `JOGADOR_NAO_NA_PARTIDA` para ator fora do roster (inclui quem já saiu);
- **efeito**: remoção do peão (libera a célula), remoção do Jogador do
  roster/ordem, limpeza da seleção/manipulação/recebidas do turno abortado
  (só quando o desistente era o Ativo — fora do turno, vez, rodada e
  pendências do Ativo vigente são preservadas), `calcularIluminacao` +
  `aplicarLimpeza` no ato com o roster pós-remoção (conquistas não
  revogadas), poda do snapshot `peoesNoAlcance` e das graças órfãs;
- **Passagem imediata** se o desistente era o Ativo — lote com
  `desistencia_registrada`, `celulas_iluminadas`/`limpeza_aplicada`,
  `turno_encerrado` (+ `manipulacao_finalizada` se havia janela aberta) e
  `turno_iniciado` — ancorada no índice removido (o seguinte na ordem
  assume, com salto silencioso de amedrontados e rodada nova no wrap, na
  semântica de `avancarVez`);
- **término em N−1** pelo funil (`avaliarTerminoDaPartida`): a vitória segue
  N peões no mesmo Portão + 3 Geradores + Cartão (`equipeVenceu` já usa
  `jogadores.length`; teto via `tetoDoPortao`); o **quórum mínimo** — um
  Jogador restante — encerra em derrota com o motivo novo `desistencia`,
  que **precede a vitória** (N=2→1 termina em derrota mesmo com os
  objetivos completos);
- **evento novo** `desistencia_registrada` (abre o lote, com `jogadorId` e
  `peaoId`).

Queda de conexão sem desistência segue voltável, sem expiração (issue C).

## Porquê

- **Rota própria mínima**: um branch no dispatch antes do guard do Ativo
  preserva todo o resto do domínio intacto; o funil de término existente
  consome o estado pós-remoção sem novo caminho de avaliação.
- **Quórum precede vitória**: sem a precedência, a desistência do parceiro
  fora do Portão converteria em vitória solo um jogo cooperativo — o solo
  restante não escapa sozinho.
- **Limpeza no ato com o roster novo**: reutilizar
  `recalcularIluminacaoEAplicarLimpeza` mantém um único ponto definitivo e
  faz as peças que só o desistente iluminava caírem pela regra normal.

## Alternativas consideradas

- **Desistência só no próprio turno (via `FORA_DA_VEZ`)** — rejeitada: o
  destravamento do jogo exige sair fora da vez (o softlock é um parceiro
  parado sem agir); a spec pede o ato a qualquer momento.
- **Quórum como derrota comum após a vitória** — rejeitada: permitiria a
  vitória solo descrita acima, contra o critério "N=2→1 termina em
  derrota".
- **Revogar conquistas do desistente na Limpeza** — rejeitada: conquistas
  são da equipe e sobrevivem à Limpeza por regra (issue #176); a
  desistência não as revoga.
- **Fiação wire/cliente nesta entrega** — fora do escopo por decisão da
  #289 (game-server, `packages/shared`, modal do SAIR e anúncios de leitor
  de tela ficam para issues próprias); idem bots, penalidades/ranking,
  expulsão e Partida Órfã (#222).
