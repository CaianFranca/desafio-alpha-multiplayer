# ADR-0010: Não-Início de Partida Preparada

Status: Aceito
Data: 2026-09-06

## Contexto

Partida `preparada` sem completar a admissão (nenhum dos 2 a 4 admitidos completa o
início, todos desconectam) nunca terminava nem avisava o lobby: `SAIR_DA_SALA`
rejeitado com `SALA_ENCAMINHADA`, `ENTRAR_NA_SALA` com `JOGADOR_JA_ASSOCIADO`,
prendendo Jogadores à Sala encaminhada até expirar (~1h TTL). Ver #222, PR #304.

O termo "não-início" reserva "abandono" para a desistência futura em partida já
em andamento: aqui só existe Partida `preparada` que nunca admitiu o roster.

## Decisão

Game-server detecta o não-início server-side: debounce 10s quando roster todo
`em_reconexao`, teto 90s (`PARTIDA_NAO_INICIO_SEGUNDOS`) pela idade mesmo com
admissão parcial. Ao declarar o não-início: fecha conexões com 4000
`PARTIDA_NAO_INICIADA` via `encerrarPorNaoInicio`, cancela Partida no Redis e
notifica lobby com `resultado: 'nao-inicio'`; lobby revalida e reabre
`encaminhada → aberta` no mesmo caminho do ADR-0006. Timers rearmados após
restart via SCAN `game-server:partida:*` com dispersão (jitter), leitura por
pipeline e guarda de idade inválida. Parcial <90s mantém `SALA_ENCAMINHADA` —
teto é comportamento desejado.

## Porquê

- **Server-side único**: lobby não sabe quando perguntar; cliente-driven espalha transição entre os clientes.
- **Simétrico ao retorno**: reusa callback ADR-0006 com retry/backoff cap 30s.
- **Parcial protegido**: teto evita liberar Sala enquanto admissão ainda pode completar.

## Alternativas consideradas

- **Poll lobby → game-server** — rejeitada: carga contínua para evento pontual.
- **Bypass parcial imediato no lobby** — rejeitada: divergiria do game-server antes do teto.
