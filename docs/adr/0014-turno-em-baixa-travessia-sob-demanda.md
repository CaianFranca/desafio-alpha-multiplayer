# ADR-0014: Turno em Baixa Iluminação — Travessia Sob Demanda

Status: Aceito
Data: 2026-09-12
Revoga: ADR-0013 (puxar-1 no `turno_iniciado`) — motivado pelo bug #377

## Contexto

A ADR-0013 ("Puxar Primeiro") resolveu o travamento da #354 sorteando 1 peça
automaticamente no `turno_iniciado` de quem está em Baixa Iluminação. O bug
#377 mostrou o efeito colateral: o turno em Baixa **saca peça
automaticamente no início e trava o movimento do peão** — a pendência
recém-nascida bloqueia `MOVER_PEAO`/`PERMANECER` (pendência não resolvida) e
o jogador é forçado ao fluxo puxar→colocar mesmo quando queria só mover por
caminho iluminado ou permanecer.

A regra correta (relator, #377) tem três opções no turno em Baixa, sem sorteio
no início:

- **(A)** mover para caminho iluminado, sem saque;
- **(B)** atravessar o escuro (`ATRAVESSAR_O_ESCURO` saca 1 peça sob demanda,
  após a escolha da célula escura) e mover compulsoriamente para a peça colocada;
- **(C)** permanecer.

## Decisão

1. **Sem sorteio no `turno_iniciado`:** `avancarVez` nunca gera Recebimento —
   o turno em Baixa abre com zero pendências (`partida.ts: avancarVez`).
2. **Travessia canônica sob demanda:** `ATRAVESSAR_O_ESCURO` volta a ser o
   fluxo canônico do saque em Baixa (desfaz o `@deprecated` da ADR-0013 em
   `shared/partida.ts` e `shared/peoes.ts`) — sorteio de 1 peça com a
   célula-alvo pré-fixada na célula escura escolhida, iluminação fresca
   unificada com `posicionarPeao`.
3. **Mover compulsório pós-travessia:** após `atravessouNoTurno`, a
   Permanência é vedada (`MOVIMENTO_INDISPONIVEL` em `permanecerNaPartida`)
   até o peão mover — a flag só cai na Confirmação ou no avanço da vez. O
   frontend auto-encadeia o `MOVER_PEAO` para a peça colocada no
   `PECA_POSICIONADA` (decisão aprovada: FE auto-encadeia + guarda na engine)
   e, no `PEAO_MOVIDO` correspondente, auto-confirma a posição; no
   `POSICAO_CONFIRMADA` dessa auto-confirmação, auto-encerra o turno
   (`ENCERRAR_TURNO`, uma vez por turno) — fechamento de zero cliques. O
   `ATRAVESSOU_O_ESCURO` precisa alcançar o modelo: o canal do frontend o
   roteia (`usePartidaWebSocket`); sem esse evento, `atravessouNoTurno` fica
   `false` e o auto-mover nunca dispara.
4. **Bot atravessa:** a FSM do bot (`bot.ts`, ramo d) enumera
   `atravessar_o_escuro` (uma ação por vaga escura, iluminação fresca
   unificada) em Baixa; pós-travessia, sem nova travessia nem permanência.
   O driver WS (`jogador-bot.ts`) converte o comando para o wire.
5. **Cliente:** clique em vaga escura com o peão em Baixa selecionado →
   `ATRAVESSAR_O_ESCURO` (canal de Partida, `jogadorId` injetado na página);
   recebida travada com pull automático + destaque; `atravessouNoTurno` no
   modelo (reseta em `TURNO_INICIADO`/`TURNO_ENCERRADO`); fase sem botão
   Permanecer pós-travessia (exceto Monstro — item 6); lote da travessia no
   batch atômico.
6. **Uma travessia por turno — inclusive Monstro:** o encaixe da pendência
   da travessia registra `pecaDaTravessiaId` para **qualquer** peça colocada
   (Monstro incluso). O Monstro não aceita peão, então o mover compulsório é
   impossível e o turno travado fecha por **Permanência**: `permanecerNaPartida`
   reabre a via só quando a peça da travessia é Monstro. O FE auto-permanece
   no `PECA_POSICIONADA` de Monstro (cadeia `SELECIONAR+PERMANECER`).
7. **Arrependimento na Opção (A):** a opção (A) é ida-e-volta livre até a
   Confirmação/Permanência. Depois de mover para o caminho iluminado e voltar
   para a Peça do início do turno, a **Permanência volta a valer** (a engine
   só exige o peão na Peça do início do turno; sem guarda de
   `movimentouNoTurno`) — o botão Permanecer reaparece e as **vagas escuras
   seguem disponíveis** (sem `atravessouNoTurno`), deixando o jogador
   permanecer ou atravessar sob as regras de (B).
8. **Uma casa por turno — origem da travessia:** portar para a Peça
   iluminada de outro jogador e atravessar dali era fura (bug #377-report):
   a travessia só vale da **Peça do início do turno** (`pecaDoInicioDoTurnoId`).
   A engine rejeita `ATRAVESSAR_O_ESCURO` se o peão não está sobre ela
   (`MOVIMENTO_INDISPONIVEL`, "uma casa por turno" — espelho do fechamento da
   Opção (B)); o FE espelha **só por localização**: mover e voltar à origem
   mantém a vaga escura disponível (o `movimentouNoTurno` não faz parte da
   condição — ida-e-volta não revoga o gesto). O gate por localização cobre o
   arrependimento; a origem cobre a ida-e-volta (o destino escuro reabre ao
   voltar à origem).
9. **Re-admissão no meio da travessia (Bug 2):** o `ESTADO_DA_PARTIDA`
   (reconexão/reload/HMR) agora **carrega a fase no wire**: `atravessouNoTurno`
   e `pecaDaTravessiaId` integram `EstadoDaPartidaSnapshot` e a projeção FE as
   lê (antes forçava `false`/`null`, órfã a fase — os marcadores reapareciam e
   o auto-mover nunca disparava). A pendência travada chega no snapshot como
   `RecebidaNoSnapshot` (vaga nula, célula-alvo fixada): o auto-ESCOLHA
   encadeia no cliente re-admitido e a auto-cadeia (MOVER → CONFIRMAR /
   PERMANECER no Monstro → ENCERRAR) roda até o fim — o jogador reconectado
   tem o turno encerrado sem clique, sem perder a Jogada. (Testes de integração em
   `frontend/tests/partida-travessia-auto-cadeia.test.tsx`.)
10. **Resgate comprometido na Confirmação (ADR-0005):** o `mover_peao` não
   cura — mover para a peça do afetado apenas posiciona o salvador. O Resgate
   materializa-se em `confirmar_posicao_do_peao`, sobre o roster pré-gatilho e
   antes da Iluminação/Limpeza/Ataque do gatilho: aliados afetados que
   co-ocupam a peça confirmada são curados — o Amedrontado sai sempre
   (Sanidade +2, teto 3), mas a Baixa Iluminação só apaga com o salvador de
   vela acesa (fora da Baixa); um `resgate_realizado` por resgatado entra no
   lote após o Recebimento e a peça entra em período de graça. O evento
   carrega o estado resultante do resgatado (`emBaixaIluminacao`/`sanidade`)
   para o cliente aplicar a cura parcial exatamente, sem adivinhar. Abandonar sem
   confirmar (sair da peça antes da Confirmação) não salva. A tolerância de
   ocupação (+1 com afetado) continua avaliada no mover; a graça continua
   bloqueando a Permanência até a saída de um peão.

Consequências:

- `CONFIRMAR_POSICAO` em Baixa segue sem sortear (`recebidas: []`) — como na
  ADR-0013; o que muda é só a origem do saque (travessia sob demanda).
- A regra "sem vaga escura, sem puxada" (#343) segue valendo dentro da
  travessia (sorteio com 0 vagas → 0 peças, sem pendência irresolúvel).
- `gerarRecebidas` com filtro de vagas escuras segue inalterado (usado pela
  travessia e pelo Primeiro Turno).
- `resgate_realizado` sai no lote da Confirmação (após Recebimento, antes de
  Iluminação/Ataque); o redutor do cliente já o tratava — a cura visual passa
  a ocorrer só após a confirmação.
- Cobertura: `packages/engine/test/resgate.test.ts` (cura/abandono/graça na
  Confirmação) e `frontend/tests/partida-travessia-auto-cadeia.test.tsx`
  (cadeia viva até o auto-ENCERRAR + ida-e-volta).

## Alternativas consideradas

- **Manter o puxar-1 no início do turno** — rejeitada: é o próprio bug #377
  (saque automático trava o movimento).
- **Auto-move no engine pós-posicionamento** — rejeitada (decisão aprovada):
  o encadeamento vive no frontend, com a engine como guarda autoritativa.
- **Travessia sem mover compulsório** — rejeitada: permitiria fechar o turno
  sem pisar na peça colocada, quebrando a Limpeza do caminho escuro.

## Referências

- Issues #377 (bug), #354 (ADR-0013), #343, #264, #272
- `packages/engine/src/partida.ts`: `avancarVez` (sem sorteio),
  `atravessarOEscuroDaPartida` (canônica, gate da Peça do início do turno),
  `permanecerNaPartida` (guarda `atravessouNoTurno`), `resgatarNaPeca` +
  `confirmarPosicaoDoPeao` (Resgate comprometido na Confirmação; graça);
  `packages/engine/test/resgate.test.ts` (cura/abandono/graça)
- `packages/engine/src/bot.ts`: ramo (d) com travessia
- `packages/shared/src/partida.ts`: `AtravessarOEscuroPartidaComando` (sem
  `@deprecated`); `EstadoDaPartidaSnapshot` com `atravessouNoTurno` e
  `pecaDaTravessiaId`; `packages/shared/src/peoes.ts`: `AtravessouOEscuroEvento`
- `frontend/web/src/game/tabuleiro/interacaoPeoes.ts`: `mapearTravessiaDoEscuro`,
  `celulasDaTravessiaDoEscuro` e `travessiaDoEscuroDisponivel` (gate só por origem)
- `frontend/web/src/game/tabuleiro/monstros.ts` + `MonstroAvatar.tsx`: modelo
  3D sobre a base da peça de Monstro (clique único com a peça)
- `frontend/web/src/hooks/usePartidaWebSocket.ts`: roteia `ATRAVESSOU_O_ESCURO`
  ao modelo (sem ele, o auto-mover nunca dispara)
- `frontend/web/src/pages/PartidaPage.tsx`: auto-cadeia
  (ESCOLHA → MOVER → CONFIRMAR / PERMANECER no Monstro → ENCERRAR)
- `frontend/tests/partida-travessia-auto-cadeia.test.tsx`: integração da
  cadeia viva (até o auto-ENCERRAR) e da ida-e-volta
- `CONTEXT.md: Baixa Iluminação, Travessia do Escuro, Recebimento`
