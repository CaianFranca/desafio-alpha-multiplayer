# ADR-0014: Reconexão da Partida em Andamento com Expiração

Status: Aceito
Data: 2026-09-12

## Contexto

A queda em Partida `em_andamento` só marcava `em_reconexao` e persistia sem
expiração (ADR-0013: "sem expiração"); a volta reassumia via snapshot +
`anunciarTurnoAtual`, mas o turno do Jogador Ativo caído travava para sempre.
A spec #292 (Janela de reconexão da Partida) pede expiração no padrão do
lobby, convertida em desistência com efeito idêntico ao de B (#289/#288).
A `preparada` já tem o não-início (ADR-0010, 10s/90s) e permanece inalterada.

## Decisão

- **Janela por partida+jogador** no Redis
  (`game-server:reconexao:<partidaId>:<jogadorId>`, EX TTL configurável
  `PARTIDA_RECONEXAO_EM_ANDAMENTO_SEGUNDOS`, default 60, clamp ≥1s) +
  **timer em memória com `unref`** que executa a conversão (mesmo padrão do
  lobby `lobby-server/src/salas/reconexao.ts` e do não-início
  `game-server/src/partidas/nao-inicio.ts`): Redis é persistência, timer é o
  executor (só-preguiçoso não destravaria o Ativo sozinho).
- **Ciclo de vida**: grava ao marcar `em_reconexao` em `em_andamento`
  (`ws.ts` close); limpa na re-admissão com sucesso; nunca agenda/limpa na
  `preparada`.
- **Conversão = despacho interno do efeito de B**: dentro da mutação
  serializada por `partidaId` em `PartidaHandlers`
  (`converterExpiracaoEmDesistencia`), lê estado, aplica
  `desistir_da_partida` com ator = ausente, salva, traduz com
  `causa:'expiracao'`, broadcast do lote integral + callbacks
  `notificarDesistencia`/`notificarRetorno` e retenção/término idênticos ao
  fluxo explícito; idempotente (jogador já fora / partida terminada /
  readmitido → aborta sem mutar).
- **Causa compatível**: `DesistenciaRegistradaEvento` (engine) e
  `DesistenciaRegistradaWireEvento` (shared) ganham `causa?:
  'desistencia' | 'expiracao'` opcional — ausente = `desistencia` implícita
  para compat com payloads/binários antigos; `traduzirEventos` 1:1. A
  partir daqui o servidor sempre envia a causa: o fluxo explícito anexa
  `causa:'desistencia'` antes de traduzir (a conversão já anexava
  `causa:'expiracao'`).
- **Anúncios de presença (spec #292 história 2, seam da #294)**:
  `JOGADOR_EM_RECONEXAO` / `JOGADOR_RECONECTADO` (`{ jogadorId }`, sem par
  no engine e sem espelho no snapshot) entram na união
  `PartidaEventoDoServidor` — broadcast só em `em_andamento`: a entrada ao
  marcar + armar no `close`, a volta na re-admissão com
  `mudou && !iniciou` (exclui as N admissões iniciais, que anunciam
  `PARTIDA_INICIADA`); a `preparada` nunca emite.
- **Callback informativo ao lobby**: `AvisoDeDesistencia` ganha `causa?`
  opcional, enviada no payload de cada origem (`desistencia` no explícito,
  `expiracao` na conversão, inclusive no detach pré-retorno do término
  2→1); a rota do lobby aceita e valida (`desistencia|expiracao`, resto é
  400) sem mudar o detach.
- **Rearme pós-restart** via SCAN com jitter/pipeline (como lobby/não-início);
  **corrida admissão-vs-timer** mitigada com verificação de presença vigente
  dentro da mutação + cancelamento na re-admissão.
- **TTL autoritativo**: `verificarExpiracaoSeNecessario` consulta o TTL da
  chave antes dos guards — janela ainda aberta (`ttl > 0`, fire precoce)
  aborta sem mutar e sem limpar; chave sem EX (`ttl == -1`, misconfig)
  aborta com warn; só a janela vencida (`0/-2`) prossegue para os guards de
  presença/engine.

## Porquê

- Reaproveitar integralmente o caminho de B evita duplicar regra: a expiração
  não tem semântica nova, só um gatilho temporal para o mesmo ato.
- Redis + timer espelho segue o padrão já operado no lobby e no não-início
  (recuperação + destravamento autônomo do Ativo).
- Causa opcional preserva compatibilidade wire/binária e distingue o motivo
  sem novo evento.

## Alternativas consideradas

- **Só-preguiçoso (converter na próxima Ação)** — rejeitada: o Ativo caído
  travaria o jogo até alguém agir; a conversão precisa ser autônoma.
- **Nova semântica de saída (penalidade, bot, AFK)** — fora do escopo (#295):
  só timer + conversão.
- **Evento wire novo de roster** — rejeitado: `DESISTENCIA_REGISTRADA` com
  causa já é o anúncio aos restantes, como em B. (Os anúncios de presença
  `JOGADOR_EM_RECONEXAO`/`JOGADOR_RECONECTADO` da #295 suprem a história 2
  da #292 sem evento de roster genérico: só `{ jogadorId }` no canal de
  Partida.)
