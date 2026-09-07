# ADR-0009: Roster Variável da Partida (N = 2–4)

Status: Aceito
Data: 2026-09-06

## Contexto

O núcleo da Partida (`packages/engine`) só inicializava com exatamente 4
jogadores: a guarda de `estadoInicialDaPartida` rejeitava qualquer outro
tamanho, a vitória exigia 4 peões no mesmo Portão de Saída e o teto de
ocupação do Portão estava fixo em 4. A spec #281 pede partidas com 2, 3 ou 4
jogadores; a issue #285 recorta o núcleo puro dessa mudança (sem lobby,
servidores, bots ou cliente), com o roster fixo do início ao fim nesta
entrega — sem remoção de peão ou de vez (isso pertence à #287).

## Decisão

O engine aceita roster fixo N = 2–4, definido na inicialização e imutável até
o término. Só o Portão de Saída escala com N:

- inicialização com 2–4 jogadores (1 e 5+ rejeitados com `DADOS_INVALIDOS`);
  N cores fatiadas pela ordem de entrada (`branco`, `vermelho`, `azul`,
  `amarelo`), N Peças Iniciais (`inicial-1..N`) e N peões;
- Rodada de N turnos, incluindo os Primeiros Turnos — a vez circular já era
  genérica sobre o tamanho do roster;
- vitória com N peões reunidos no mesmo Portão de Saída + 3 Geradores ligados
  + Cartão de Acesso obtido (sem vitória sem os N reunidos);
- teto de ocupação do Portão = N, mantido o +1 da exceção de Resgate já
  existente (peça com afetado tolera um peão a mais);
- derrotas por equipe amedrontada e por Caixa esgotada valem com qualquer N,
  sem mudança de regra.

## Invariantes fixos

Nada além do Portão encolhe ou cresce com N menor:

- Caixa de 83 peças (54 de caminho, 17 especiais, 12 monstros), grade 7×7;
- 6 de cada Monstro, 3 Geradores, Cartão de Acesso;
- Recebimento, Iluminação, Limpeza e Ataque inalterados;
- o excedente de Portões na Caixa (4 Portões com N < 4) é aceito por decisão,
  sem rebalancear a composição.

## Porquê

- **Superfície mínima**: um único parâmetro (N) parametriza os pontos que já
  eram quase genéricos; o resto do domínio nem percebe o tamanho do roster.
- **Vitória proporcional**: exigir os N peões no Portão preserva o sentido da
  fuga coletiva sem afrouxar os objetivos (Geradores e Cartão não encolhem).
- **Excedente tolerado**: remover Portões da Caixa por N mudaria sorteio e
  contagem de derrota; aceitar o excedente evita rebalanceamento sem custo de
  regra.

## Alternativas consideradas

- **Escalar Geradores/Cartão com N** — rejeitada: afrouxa o Objetivo Global
  nas partidas menores; a spec fixa 3 Geradores e o Cartão para qualquer N.
- **Rebalancear a Caixa por N (menos Portões)** — rejeitada: altera
  probabilidades de sorteio e a derrota contável por motivo cosmético; o
  excedente é inócuo (só um Portão precisa estar disponível).
- **Reavaliar N dinamicamente mid-partida** — rejeitada nesta entrega:
  pertence à desistência mid-partida (#287); aqui N é fixo do início ao fim.
