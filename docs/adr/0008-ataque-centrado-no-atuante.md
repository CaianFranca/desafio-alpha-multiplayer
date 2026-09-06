# ADR-0008: Ataque dos Monstros Centrado no Atuante

Status: Aceito
Data: 2026-09-05

## Contexto

A ST-15 resolvia o Ataque por delta global: cada Monstro comparava o conjunto
atual de peões dentro do seu Alcance com o snapshot do gatilho anterior
(`peoesNoAlcance`) e atacava quando o conjunto mudasse — por qualquer motivo,
inclusive por ação de TERCEIRO. O efeito colateral ficou registrado no bug
#262: um jogador confirma fora do alcance, o Monstro não o envolve, mas o
conjunto global muda e o peão parado de outro jogador é atingido. Além disso,
a Permanência não avaliava o Alcance (permanecer dentro não disparava) e o
Primeiro Turno só acertava o ataque por efeito do mesmo delta global. A
avaliação centrada no atuante (`resolverAtaquesCentradoNoAtuante`, issue #237)
já existia pura no engine; restava fiá-la aos gatilhos da Partida (issue #236)
e registrar a decisão.

## Decisão

O Ataque é avaliado POR MONSTRO comparando a Peça do início do turno (antes)
com a Peça decidida do peão do Jogador Ativo (depois), no Tabuleiro
PÓS-Limpeza. Os gatilhos são as decisões definitivas do atuante: Confirmação
de Posição com troca de Peça (entrada ou saída), Permanência (antes = depois —
permanecer dentro dispara) e posicionamento do Peão no Primeiro Turno
(antes = null ≡ fora — sempre entrada). Fora→fora é silêncio; entrar, sair e
permanecer disparam com SÓ os Monstros envolvidos atacando. O funil é
inalterado: a Proteção é consumida uma única vez por resolução e nega todos
os ataques simultâneos contra o mesmo Jogador; as penalidades (Baixa
Iluminação do Vulto, perda de Sanidade do Espectro, Amedrontado) seguem
#170; o eco `estadosAplicados` segue #173; a ordem do gatilho permanece
Iluminação → Limpeza → Ataque. A Permanência passa a gerar Ataque, mas NÃO
gera Limpeza (ADR-0005): se o Vulto impor Baixa Iluminação nova, a Iluminação
é recalculada e a Limpeza reaplicada no MESMO gatilho, como nos demais. O
lote da Permanência emite `ataque_resolvido` antes de `turno_encerrado`. A
resolução legada delta-based (`resolverAtaques`) fica exportada como
`@deprecated` para retrocompatibilidade de binários persistidos e testes
puros — a Partida não a consome mais.

## Porquê

- **Justiça do ataque**: um Monstro só ameaça quem se aproxima dele por ação
  própria; o peão parado não é atingido pela jogada alheia — a causa do bug
  #262 desaparece por construção, sem regra adicional.
- **Permanência com risco**: permanecer dentro do Alcance é uma decisão
  definitiva como confirmar; avaliá-la fecha a lacuna em que ficar parado era
  mais seguro do que sair, sem custo extra de Limpeza (a Iluminação não muda
  na permanência).
- **Primeiro Turno como entrada**: o posicionamento inicial do Peão é a
  primeira decisão de posição do jogador; avaliá-la com `antes = fora` dá
  semântica uniforme sem depender do snapshot vazio.
- **Determinismo e compatibilidade**: o funil de Proteção, penalidades e eco
  no wire não muda; o shape do `AtaqueResolvidoWireEvento` é preservado, e o
  snapshot `peoesNoAlcance` segue emitido como observabilidade do Alcance
  atual (deixou de ser insumo da decisão).

## Alternativas consideradas

- **Manter o delta global e corrigir #262 com exceções** — rejeitada: cada
  exceção (ignorar mudanças causadas por Limpeza, por posicionamento de
  terceiro, por encaixe) reproduzia casuística ad hoc; a avaliação centrada
  no atuante elimina a classe do bug.
- **Avaliar o terceiro também (delta global só para monstros que o envolvem)** —
  rejeitada: mantém dois critérios coexistindo e o peão parado continua
  atingível por ação alheia.
- **Permanência dispara Ataque e também Limpeza** — rejeitada: a Permanência
  não muda a Iluminação, então a Limpeza seria vazia ou duplicada; a
  reaplicação só acontece quando a Baixa nova realmente encolhe a luz
  (ADR-0005 preservado).
- **Remover o `resolverAtaques` legado imediatamente** — rejeitada: binários
  persistidos e testes puros o referenciam; `@deprecated` sinaliza o
  caminho sem quebrar o rolling deploy.
