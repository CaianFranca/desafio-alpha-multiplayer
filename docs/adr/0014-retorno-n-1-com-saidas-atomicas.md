# ADR-0014: Retorno à Sala N-1 com Saídas Atômicas

Status: Aceito
Data: 2026-09-12
Supersede parcial: ADR-0006 (mesmos Membros) para o caso com Desistências; CONTEXT.md Retorno à Sala atualizado.

## Contexto

A ADR-0006 fixou o Retorno à Sala com os mesmos Membros. Com a Desistência em Partida (ADR-0013), o desistente vira fantasma no roster: o game-server envia N e o lobby exigia igualdade exata, travando a sala em `encaminhada` (follow-up #371 da PR #366, spec #288/#287).

## Decisão (caminho b da #371)

Relaxar o retorno para subconjunto N-1 com motivo explícito:

- Novo comando `reabrir_sala_com_saidas` (`packages/engine/src/lobby.ts`): subset `1 ≤ |payload| ≤ |ativos|`, sem duplicatas, sala `encaminhada`+consistente, ao menos 1 Membro restante; cada Desistência mapeia para Saída `saida` (sem campo genérico neste comando; expulsao/expiracao/encerramento usam seus comandos).
- Sucessão de Anfitrião no engine (`sucederAnfitriao` retorna membro.id); o caller compara membro-id com membro-id e converte para jogadorId no PG (`anfitriao_id` guarda `usuarios.id`); `null` = `SET NULL` explícito, nunca `COALESCE`.
- Transação atômica `reabrirSalaComSaidasAtomico`: `UPDATE salas_historico` + `DELETE membros` + `INSERT membros_historico (saida)` + marker `sala_reaberta_markers` em BEGIN/COMMIT.
- Convergência memória × PG definida pelo roster ativo ordenado por ordem de entrada: memória filtra `estado==='ativo'`, PG filtra `bloqueado=false` por `ordem_de_entrada` — mesma lista e ordem; desistentes ficam `encerrado` na memória (auditoria) e só no histórico no PG (par do fluxo canônico `sairMembroAtomico`).
- Projeção/broadcast pelo caller em `retorno.ts`: snapshot `definirEstadoSala(serializarSala)` + `SALA_ATUALIZADA` + markers PG/Redis (idempotência); eventos `membro_saiu` (um por Desistência) + `sala_reaberta` emitidos pelo engine.
- Payload vazio = `400 DADOS_INVALIDOS` (erro do cliente); subset inválido em sala encaminhada = `409`.

## Porquê

- Elimina a janela de crash entre detach e retorno e a toxicidade do caminho (a) com serviceToken extra.
- Mantém a ordem/"mesmos Membros" da #287 como roster ativo ordenado, sem quebrar o padrão canônico de saída.

## Alternativas consideradas

- Caminho (a): endpoint serviceToken para remover o desistente antes — rejeitado pela toxicidade e janela de crash.
- DELETE nos dois modelos ou `encerrado` nos dois — rejeitado: quebraria auditoria/ordem (engine) ou boot Ativos/fonte Ativos (PG); a convergência pelo roster ativo preserva ambos.
