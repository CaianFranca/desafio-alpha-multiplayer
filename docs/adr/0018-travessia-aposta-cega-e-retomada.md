# ADR-0018: Travessia — Aposta às Cegas, Pouso Obrigatório e Retomada

Status: Aceito
Data: 2026-09-14
Complementa: ADR-0017 (não revoga nada) — motivado pelo review da PR #391 (fixes #377)

## Contexto

A ADR-0017 definiu a Travessia do Escuro sob demanda com mover compulsório
pós-posicionamento, guardado no mover (`moverPeaoDaPartida`) e na Permanência
(`permanecerNaPartida`). Testes manuais na branch da PR #391 (4 abas, 4
jogadores) expuseram quatro furos que as guardas não cobriam: fechar o turno
sem pisar na peça colocada, fechar por CONFIRMAR com peça Monstro, softlock
com a cadeia interrompida (turno sem nenhum botão) e Monstro-fantasma
sobrevivendo ao turno da aposta até o próximo gatilho. As decisões de produto
(B1 da review: auto-cadeia zero cliques, Resgate na Confirmação, vela acesa,
Amedrontado +2) já estão registradas no #377 — esta ADR registra só as regras
de fechamento que faltavam.

## Decisão

1. **Aposta às cegas:** a célula é escolhida ANTES de conhecer a peça
   sorteada; o risco vincula. Conhecer um Monstro depois de escolher não
   desfaz a escolha — o turno segue pelas vias abaixo.
2. **Pouso obrigatório (peça não-Monstro):** `confirmarPosicaoDoPeao` rejeita
   com `MOVIMENTO_INDISPONIVEL` quando `atravessouNoTurno` e o peão não está
   sobre `pecaDaTravessiaId` (`partida.ts: confirmarPosicaoDoPeao`). Fecha a
   alternativa que a ADR-0017 rejeitou (posicionamento grátis no escuro sem
   pagar a exposição do peão).
3. **Exceção Monstro:** o peão nunca pousa em Monstro; o fechamento é por
   Permanência após o posicionamento, com o Ataque incidindo normalmente.
   `CONFIRMAR` é vedado nesse turno (`PECA_JA_TEM_PEAO` em
   `confirmarPosicaoDoPeao`) — fechar por CONFIRMAR entraria no funil completo
   e a Limpeza removeria o Monstro ANTES do Ataque, anulando o risco da aposta.
4. **Ordem do fechamento Monstro:** `permanecerNaPartida` no ramo
   `permanenciaEmMonstro` aplica **Ataque → (Iluminação/Limpeza)** —
   inversão deliberada do funil padrão (Limpeza → Ataque): o Monstro da aposta
   precisa atacar antes de ser varrido; no funil padrão ele seria removido sem
   atacar. A Limpeza é incondicional (a isenção da ADR-0005 vale para o
   permanecer comum, onde o tabuleiro não muda — aqui o encaixe acabou de
   posicionar uma peça fora da Iluminação e sob nenhum peão). O lote emite
   `limpeza_aplicada` entre `ataque_resolvido` e `turno_encerrado`, com poda
   de `peoesNoAlcance` e `pecasEmPeriodoDeGraca` (mesmo padrão de `desistir`).
5. **Retomada da cadeia pós-readmissão (E2a):** o snapshot é a única mensagem
   da retomada — `PartidaPage` deriva do estado autoritativo onde a cadeia
   parou e continua sozinha (peça posicionada + peão fora → auto-MOVER; peão
   sobre a peça → auto-CONFIRMAR → auto-ENCERRAR; Monstro → auto-PERMANECER),
   com as guardas anti-duplo do caminho ao vivo. A pendência travada segue
   pelo auto-ESCOLHA do `useEffect`.
6. **Fase manual de segurança (E2b):** piso de recuperação, não substituto do
   auto — peão sobre `pecaDaTravessiaId` sem confirmar deriva fase
   `'confirmar'` (predicado casado com a guarda do item 2). No caminho feliz o
   auto dispara primeiro e o botão nem aparece; se o auto falhar, o jogador
   clica a mesma ação legal em vez de travar sem botão.
7. **Bot sem travessia fantasma (M4):** a engine aceita `atravessar_o_escuro`
   com Caixa vazia como no-op ("Caixa vazia não é erro", convenção testada) —
   a FSM nem enumera a travessia sem peças (`bot.ts`, ramo d), sem tocar a
   engine.

## Alternativas consideradas

- **CONFIRMAR permitido sobre Monstro com funil padrão** — rejeitada: a
  Limpeza removeria o Monstro antes do Ataque ("Monstro removido não ataca").
- **Limpeza do Monstro só no próximo gatilho** — rejeitada: monstro-fantasma
  ocupa a célula, entra no snapshot do Alcance e pode escapar da remoção se a
  célula for iluminada no interregno.
- **Zero-cliques puro sem piso manual** — rejeitada: qualquer falha do auto
  (socket não pronto, rejeição) volta a ser softlock; o piso executa a ação
  legal idêntica à do auto.

## Referências

- Issues #377 (bug), PR #391 (review do @PedroDLucca: E1–E4, R3, M1–M4, F6)
- `packages/engine/src/partida.ts`: `confirmarPosicaoDoPeao` (guardas E1),
  `permanecerNaPartida` (ramo `permanenciaEmMonstro`, E4),
  `recalcularIluminacaoEAplicarLimpeza` + `desistirDaPartida` (padrão de poda)
- `packages/engine/src/bot.ts`: ramo (d) com gate de Caixa (M4)
- `frontend/web/src/pages/PartidaPage.tsx`: retomada pós-`ESTADO_DA_PARTIDA`
  (E2a), `faseDoTurno` com piso `'confirmar'` (E2b), `encaixouMonstro` via
  `ehPecaDeMonstro` (M2)
- `frontend/web/src/game/tabuleiro/reducao.ts`: `RESGATE_REALIZADO` com
  fallback `??` (E3, janela R2); docs de `atravessouNoTurno` (M1)
- `frontend/web/src/components/partida/AmbienteDeJogo.tsx`: `vagasSet` /
  `vagasPontilhadasSet` unificados + gate de localização (M3)
- `frontend/web/src/game/tabuleiro/interacaoPeoes.ts`:
  `travessiaDoEscuroDisponivel` exportado (M3)
- Testes: `packages/engine/test/partida.test.ts` (E1, E4),
  `packages/engine/test/bot.test.ts` (M4),
  `frontend/tests/sanidade-contrato.test.ts` (E3),
  `frontend/tests/partida-travessia-auto-cadeia.test.tsx` (E2)
- `CONTEXT.md: Baixa Iluminação, Travessia do Escuro, Recebimento`
