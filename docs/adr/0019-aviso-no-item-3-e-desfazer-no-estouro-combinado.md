# ADR-0019: Aviso no item 3 e desfazer no estouro combinado

Status: Aceito
Data: 2026-09-18

## Contexto

A spec #405 (Apêndice) definia dois tratamentos que, em playtest, geraram
trava percebida como "soft block":

1. **Item 3** — Primeiro Turno com Peça Inicial definitiva e peão colocado,
   mas Recebidas pendentes: queimava + encerrava + 1 falta **sem aviso**.
   O jogador via o turno "pulado" sem entender por quê.
2. **Estado combinado** (turno normal: peão movido sem confirmar + recebidas
   pendentes) — a ordem era indefinida (R3 da #429) e a implementação queimava
   o rascunho, falhava o encerramento (sem Confirmação) e **segurava o turno
   com só a falta**, sem avanço. O jogador ficava parado acumulando faltas
   até a remoção.

Decisão do jogador (sessão de 2026-09-18): aviso antes de remover no item 3;
desfazer + avançar no combinado — mantendo +1 falta por estouro e a flag
única do aviso final.

## Decisão

- **Item 3 entra no fluxo do aviso final** (itens 1–2): primeiro expiry com
  qualquer incompletude do Primeiro Turno emite `aviso_final_do_primeiro_turno`
  (sem falta, sem avanço, sem queima; +30s únicos do relógio, flag única por
  Jogador por Partida); segundo expiry ainda incompleto remove com
  Desistência causa `tempo` (peão removido + Limpeza, efeito padrão).
  Item 4 (tudo pronto sem encerrar) inalterado: encerra + 1 falta + avança.
- **Qualquer pendente desfaz e avança (opção B)**: com `recebidas` pendentes
  no estouro — com ou sem movimento, com ou sem confirmação — recua o peão
  à Peça do início do turno (no-op se parado), descarta as peças
  posicionadas no turno + queima as recebidas (um único `pecas_queimadas`,
  sem retorno à Caixa), reseta `posicaoConfirmada`, restaura os estados do
  início do turno (abaixo), permanece e avança — com +1 falta pela moldura.
  Sem pendências: confirmado encerra + avança; parado permanece (itens 5/8).
  O estouro sempre resolve a vez; só a graça da #171 segura.
- **Recuo audível**: o voltar à origem emite `peao_movido` (de → origem)
  antes da permanência — sem o evento, o cliente mantém o peão na peça nova
  até o reload (soft block visual). Reaproveita o wire existente (tradução
  e projeção intactas); sem célula conhecida da origem (varrida pela
  Limpeza), pula o evento.
- **Restaura estados, mantém conquistas**: retrato
  `{sanidade, emBaixaIluminacao, amedrontado}` por jogador refeito a cada
  avanço (`estadosNoInicioDoTurno`, retrocompatível); o desfazer restaura o
  pré-turno — dano/Baixa do gatilho da confirmação e curas de Resgate do
  turno voltam. Geradores, Cartão e Proteção ficam (monotônicos por
  invariante #145, igual à Limpeza que não revoga).
- **Rastreamento**: `posicionar_peca` anota o pecaId em
  `pecasPosicionadasNoTurno` (opcional retrocompatível, `?? []`; zerado no
  avanço). Só o desfazer consome a lista; a Travessia tem resolução própria.
  Peças já varridas pela Limpeza no turno não entram no evento (só o que
  está no tabuleiro é descartado).
- **Wire inalterado**: nenhum evento novo — `pecas_queimadas` já carrega
  posicionadas (aposta da Travessia) e o cliente já as projeta.

## Porquê

- **Aviso antes de punir**: o item 3 destruía progresso (queima) sem chance
  de reação; o aviso dá os +30s para terminar, e a remoção no 2º expiry
  mantém o anti-stall.
- **Turno sempre conclui ou remove**: o combinado segurado punia sem agir —
  o jogador não tinha jogada que destravasse a vez. Desfazer + avançar
  devolve uma posição jogável (origem + Permanência) com o custo explícito
  (+1 falta, peças fora de circulação).
- **Sem ficha nova no cliente**: a projeção de `PECAS_QUEIMADAS` (posicionadas
  incluídas) já cobre o descarte — zero mudança de frontend/wire/relógio.

## Alternativas consideradas

- **Manter item 3 com queima silenciosa** — rejeitada: era exatamente a
  queixa do playtest (turno "pulado" sem aviso).
- **Desfazer sem falta** — rejeitada por decisão do jogador: todo estouro
  resolvido soma 1 falta; o desfazer não é passe livre.
- **Flag de aviso separada para o item 3** — rejeitada: o +30s é único por
  Partida; segunda chance quebraria o anti-stall do Primeiro Turno.
- **Desfazer só se moveu (opção A)** — rejeitada pelo jogador: o estouro
  sempre resolve a vez (opção B); parado com pendências também desfaz e
  avança em vez de segurar.
- **Reverter conquistas no desfazer** — rejeitado: Geradores/Cartão/Proteção
  são monotônicos por invariante (#145); só os estados voltam.
