# ADR-0011: Encaixe de Peça Recebida exige Conexão com a Peça sob o Peão

Status: Aceito
Data: 2026-09-09

## Contexto

O encaixe de uma Peça Recebida seguia "com Orientação livre e SEM exigência de
conexão com a Peça geradora" (herança da ST-10). Na prática, isso permitia
encaixar a peça na célula-alvo da vaga com a borda voltada à peça sob o peão
fechada, criando uma ilha desconectada que nem a movimentação do peão alcança
(issue #311). O bug foi confirmado: o encaixe desconectado era aceito e o
erro só aparecia mais tarde, como MOVIMENTO_NAO_CONECTADO na movimentação.

## Decisão

O encaixe de uma Peça Recebida passa a exigir Conexão com a peça sob o peão
(issue #311): a borda da Recebida voltada à peça geradora — o oposto da vaga
escolhida — precisa estar aberta; sem conexão, o encaixe é rejeitado com
MOVIMENTO_NAO_CONECTADO. Especiais e Monstros têm as quatro bordas abertas e
sempre conectam. Três consequências foram tomadas junto:

1. **Escolha de vaga sequencial por encaixe**: com uma Recebida com vaga já
   escolhida e ainda não encaixada, escolher a vaga de outra é rejeitado
   (PENDENCIA_NAO_RESOLVIDA). Sem isso, a pendência com vaga ficaria presa —
   ela não é re-selecionável nem re-elegível de vaga (anti-softlock).
2. **Giro da janela de Manipulação não desconecta**: enquanto o peão está
   sobre a geradora, girar a peça posicionada vizinha de modo a fechar a borda
   voltada a ela é rejeitado (MOVIMENTO_NAO_CONECTADO). Quando o peão sai da
   geradora nos turnos seguintes, a relação a proteger deixa de existir e a
   rotação volta a ser livre.
3. **Bot gira Recebidas**: o bot passou a girar a Recebida selecionada até
   conectar antes de encaixar (expandindo o escopo deliberado do bot, que
   antes nunca girava), para não propor encaixes rejeitados durante os jogos
   automáticos.

## Porquê

- **Mancha conectada**: a movimentação do peão pressupõe Conexão; isentar o
  encaixe criava buracos inalcançáveis no tabuleiro, contradizendo a própria
  Conexão do CONTEXT.md.
- **Custo baixo**: o código de erro já existia no vocabulário fechado e no
  espelho wire — nenhuma mudança de contrato.
- **Consistência do giro**: a guarda 2 preserva a decisão por que a guarda 1
  existe, impedindo que a janela de Manipulação recrie a ilha desconectada.

## Alternativas consideradas

- **DADOS_INVALIDOS ou código novo para o encaixe desconectado** — rejeitado:
  MOVIMENTO_NAO_CONECTADO já comunica a semântica e viaja sem mudança de wire.
- **Permitir re-selecionar/re-vagar a Recebida presa** — rejeitado: muda o
  modelo de seleção; o sequenciamento per-encaixe resolve por construção.
- **Manter o bot sem girar** — rejeitado: o bot passaria a desistir de turnos
  com encaixe desconectado sorteado, quebrando os jogos automáticos.