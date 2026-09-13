# ADR-0013: Turno em Baixa Iluminação — Puxar Primeiro

Status: Revogado pela ADR-0014 (bug #377: o saque automático no início travava o movimento do peão)
Data: 2026-09-10
Revoga (parcialmente): desenho de baixa de #264/#272 (ordem mover-antes-de-puxar e `ATRAVESSAR_O_ESCURO` com célula pré-fixada)

## Contexto

O bug #354 travou o turno em Baixa Iluminação com zero pendências: a ordem praticada era `MOVER_PEAO → CONFIRMAR_POSICAO` e só então sortear. Em Baixa, `confirmarPosicaoDoPeao` suprime o sorteio (`partida.ts:1284`), então nada ia para a Bandeja; sem peça para colocar, `PERMANECER` recusava com `PEAO_NAO_SELECIONADO` e `ENCERRAR_TURNO` nem aparecia. `ATRAVESSAR_O_ESCURO` exigia eleger célula escura vazia **antes** de sortear, invertendo o fluxo correto.

O relator confirmou a regra correta e autorizou correção na engine + ADR, inclusive ajustando `#343` (pendência irresolúvel quando todas as vagas estão iluminadas por terceiros).

O glossário já define Baixa: peão ilumina só a própria célula e Recebimento limitado a 1 (`CONTEXT.md: Baixa Iluminação`; `peoes.ts:346`). Faltava registrar **quando** esse 1 é puxado.

## Decisão

Turno normal em Baixa, com zero pendências, segue sempre a mesma ordem — com ou sem vizinho iluminado por outro jogador:

1. **Puxar:** se existe ao menos uma célula adjacente **disponível** (vaga = borda aberta da peça sob o peão com célula vazia — `peoes.ts:307 vagasDisponiveis` — e, em Baixa, **escura**, fora de `celulasIluminadas`), sorteia 1 peça da Caixa para a Bandeja (slot único, `gerarRecebidas` com `limiteBaixa=1`). Sem vaga disponível ou Caixa vazia, **não puxa** (0 peças) — `gerarRecebidas` retorna vazio sem erro.
2. **Colocar:** gesto `Puxar` na Bandeja → `ESCOLHER_VAGA` + `POSICIONAR_PECA` (encaixe conectado à peça sob o peão, ADR-0011).
3. **Mover ou permanecer:** `MOVER_PEAO` para a peça nova ou `PERMANECER` na mesma peça. `PERMANECER` com `peaoSelecionadoId === null` adota o peão do ator (mesmo fallback de `moverPeao`/`confirmar`).
4. **Limpeza + fim:** `CONFIRMAR_POSICAO` (ADR-0005) recalcula Iluminação, aplica Limpeza e resolve Ataque; em Baixa **não sorteia** (o sorteio já ocorreu no início). Depois `ENCERRAR_TURNO`/`avancarVez` (que também gera o Puxar inicial do próximo jogador se ele estiver em Baixa).

Consequências:

- **Sorteio no início, não após mover:** o ponto de sorteio em Baixa migra de `CONFIRMAR_POSICAO` para o início da sequência (`avancarVez` ao abrir o turno do jogador em Baixa, e reaplicado após `PERMANECER`/`CONFIRMAR` quando a vez avança). `CONFIRMAR_POSICAO` em Baixa mantém `recebidas: []`.
- **Regra geral tem prioridade:** "1 peça por vaga" (`N = min(vagas, caixa, 1)`) precede "em Baixa puxa 1". Sem vaga disponível, não há puxada — evita a pendência irresolúvel da #343 (`escolher_vaga` recusaria vaga iluminada).
- **ATRAVESSAR_O_ESCURO legado:** o comando deixa de ser o caminho canônico (fluxo correto é Puxar no início via `avancarVez`). Mantido no código como legado funcional até remoção em issue futura (`ATRAVESSAR_O_ESCURO` com `celulaAlvo` pré-fixada em `partida.ts:888` permanece válido e filtra vagas escuras via `gerarRecebidas(..., celulasIluminadas)`), mas não deve ser usado pelo frontend — a escolha da vaga escura já é validada por `escolherVagaDaPecaRecebidaDaPartida` em Baixa.
- **Iluminação:** grade toroidal (ADR-0012) segue valendo; `vagasDisponiveis` com `celulaVizinhaNaBorda` já faz wrap.

## Porquê

- **Desbloqueia o turno:** com zero pendências o jogador tem peça na Bandeja para cumprir puxar→colocar→mover/permanecer, em vez de ficar sem jogada possível.
- **Coerência com a Caixa:** só puxa quando há vaga escura vazia; sem vaga, não cria pendência que seria recusada por `DADOS_INVALIDOS` ("vaga deve ser célula escura").
- **Determinismo preservado:** o sorteio continua sendo `gerarRecebidas` puro, limitado a 1 e à Caixa; `avancarVez` apenas o antecipa.

## Alternativas consideradas

- **Manter `CONFIRMAR_POSICAO` sorteando em Baixa** — rejeitada: é exatamente o inverso da regra (mover-antes-de-puxar).
- **Manter `ATRAVESSAR_O_ESCURO` elegendo célula antes de sortear** — rejeitada: não existe "mover sem peça" e invertia puxar→colocar.
- **Puxar 1 mesmo sem vaga escura** — rejeitada: cria pendência irresolúvel (#343); a regra do relator ("quando não tem célula disponível, não puxa") prevalece.
- **Permitir mover para célula iluminada sem puxar em Baixa como ramo separado** — rejeitada para este ADR: o fluxo unificado puxar-primeiro já cobre o caso com `0` peças quando não há vaga escura; ramo iluminado sem consumo pode ser reintroduzido se necessário, mas não é o travamento da #354.

## Referências

- Issue #354, #343, #264, #272
- `packages/engine/src/partida.ts:1298` `confirmarPosicaoDoPeao`, `1573 avancarVez`, `1142 permanecerNaPartida`, `888 atravessarOEscuroDaPartida` (legado, @deprecated)
- `packages/engine/src/peoes.ts:346 gerarRecebidas` (overloads Baixa exigem `celulasIluminadas`), `307 vagasDisponiveis`
- `packages/engine/src/tabuleiro.ts:792 calcularIluminacao`
- `packages/shared/src/partida.ts:150` `AtravessarOEscuroPartidaComando` (@deprecated ADR-0013)
- `packages/shared/src/peoes.ts:180` `AtravessouOEscuroEvento` (@deprecated ADR-0013)
- `CONTEXT.md: Baixa Iluminação, Recebimento, Puxar, Bandeja, Limpeza`
