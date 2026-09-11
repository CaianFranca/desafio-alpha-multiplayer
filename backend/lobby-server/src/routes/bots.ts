// Rota POST /api/bots/adicionar — aciona um bot efêmero na sala do Anfitrião.
//
// Proteções:
//   - requireSessao: exige autenticação válida.
//   - Verifica que o solicitante é Anfitrião de uma sala aberta.
//   - Verifica que a sala tem vagas: vínculos ativos (engine/projeção) +
//     bots in-flight (202 retornado, WS ainda não entrou) < 4. Conta TODOS os
//     vínculos ativos, não só `conectado`: Membro em reconexão ocupa vaga no
//     engine (`entrarNaSala` barra por estado==='ativo').
//   - Trava por Sala contra corrida: 2 POSTs concorrentes antes de qualquer
//     ENTRAR_NA_SALA recebem 409 no segundo (BOT_EM_ADMISSAO). Sem isso, dois
//     cliques rápidos furam o teto de 4 Membros (#365 item 2).
//   - Só disponível quando BOTS_HABILITADOS=true ou NODE_ENV !== 'production'.
//
// Resposta:
//   202 { apelido, email, jogadorId } — bot iniciado em background (fire-and-forget).
//        Falha posterior vira `BOT_FALHOU` no WS da Sala + `GET /status/:jogadorId`
//        com fase `falhou` + purga do Cadastro órfão (#365 item 3).
//   400 / 403 / 409 — erros de validação.
//   GET /api/bots/disponivel → { habilitado: true } (descoberta; sem isso o
//        botão só descobriria o 404 no clique).
//   GET /api/bots/status/:jogadorId → { fase, ... } | 404.
//
// Justificativa de escopo (review #365 Q2 — manter nesta PR): o TTL de Sessões
// Redis (sessoes.ts), o `profile test` no compose e o bloco nginx `/internal/`
// vieram junto porque o bot precisa deles para operar com segurança — Sessão
// eterna vazava, teste sem profile não subia PG/Redis isolado, e o Bot Token
// exigiu bloquear `/internal/` nos 3 ambientes. Separar agora geraria 3 PRs
// com dependência circular no mesmo fluxo manual do Anfitrião.

import { Router, type Request, type Response } from 'express';
import { getConfig } from '@flicker/config';
import { requireSessao } from '../middleware/auth.ts';
import { iniciarBot } from '../bots/bot-runner.ts';
import {
  contarBotsEmAdmissao,
  marcarBotAtivo,
  marcarBotFalhou,
  obterEstadoDoBot,
} from '../bots/estado.ts';
import type { SalasContexto } from '../salas/index.ts';

/** Máximo de Membros na sala (contrato do engine: 2..4, qualquer mix humanos+bots). */
const MAX_MEMBROS_SALA = 4;

/** Janela da trava de admissão: cobre 202 → MEMBRO_ENTROU em rede local lenta. */
const TRAVA_ADMISSAO_MS = 15_000;

/** Salas com POST /adicionar em voo (check → 202 → MEMBRO_ENTROU ou falha). */
const travasDeAdmissao = new Map<string, NodeJS.Timeout>();

function travarAdmissao(salaId: string): boolean {
  if (travasDeAdmissao.has(salaId)) return false;
  const timer = setTimeout(() => {
    travasDeAdmissao.delete(salaId);
  }, TRAVA_ADMISSAO_MS);
  timer.unref?.();
  travasDeAdmissao.set(salaId, timer);
  return true;
}

function destravarAdmissao(salaId: string): void {
  const timer = travasDeAdmissao.get(salaId);
  if (timer !== undefined) {
    clearTimeout(timer);
    travasDeAdmissao.delete(salaId);
  }
}

/** Uso em testes: limpa travas voláteis entre casos. */
export function limparTravasDeBotsParaTeste(): void {
  for (const timer of travasDeAdmissao.values()) clearTimeout(timer);
  travasDeAdmissao.clear();
}

export function criarBotsRouter(contextoSalas: SalasContexto): Router {
  const router = Router();

  // Descoberta de feature: o botão consulta antes de renderizar.
  router.get('/disponivel', (_req: Request, res: Response): void => {
    res.status(200).json({ habilitado: true });
  });

  // Status pós-202 para polling do frontend (visibilidade de falha).
  router.get('/status/:jogadorId', (req: Request, res: Response): void => {
    const estado = obterEstadoDoBot(req.params.jogadorId as string);
    if (estado === null) {
      res.status(404).json({ mensagem: 'Bot não encontrado.' });
      return;
    }
    res.status(200).json(estado);
  });

  // POST /api/bots/adicionar
  router.post('/adicionar', requireSessao, async (req: Request, res: Response): Promise<void> => {
    const jogador = req.jogador!;

    // 1. Encontrar a sala associada ao anfitrião
    const salaId = await contextoSalas.projecao.obterAssociacaoJogador(jogador.id);
    if (!salaId) {
      res.status(400).json({ mensagem: 'Você não está em nenhuma sala.' });
      return;
    }

    // 2. Carregar o estado da sala
    const estadoSala = await contextoSalas.projecao.obterEstadoSala(salaId);
    if (!estadoSala || estadoSala.estado !== 'aberta') {
      res.status(400).json({ mensagem: 'A sala não está aberta.' });
      return;
    }

    // 3. Verificar se é Anfitrião
    const membroLocal = estadoSala.membros.find((m) => m.jogadorId === jogador.id);
    if (!membroLocal || !membroLocal.anfitriao) {
      res.status(403).json({ mensagem: 'Apenas o Anfitrião pode adicionar bots.' });
      return;
    }

    // 4. Verificar vagas: vínculos ativos + bots in-flight < 4.
    //    `estadoSala.membros` já são só vínculos ativos (projeção filtra
    //    estado==='ativo', igual ao engine). Não filtrar por `conectado`:
    //    Membro em reconexão ocupa vaga.
    const ocupacao = estadoSala.membros.length + contarBotsEmAdmissao(salaId);
    if (ocupacao >= MAX_MEMBROS_SALA) {
      res.status(409).json({ mensagem: 'A sala está cheia (máximo 4 membros).' });
      return;
    }

    // 5. Trava contra corrida (dois cliques / duas abas antes do WS entrar).
    if (!travarAdmissao(salaId)) {
      res.status(409).json({ mensagem: 'Adição de bot já em andamento. Aguarde.' });
      return;
    }

    // 6. Montar URL base do lobby (sempre local: o BotRunner roda no mesmo processo)
    const { lobbyServerPort } = getConfig();
    const baseUrl = `http://127.0.0.1:${lobbyServerPort}`;

    // 7. Iniciar bot (registra + conecta em background)
    try {
      const botInfo = await iniciarBot({
        codigoDeSala: estadoSala.codigo,
        salaId,
        baseUrl,
        log: (...args) => console.log(`[bots-route] sala=${estadoSala.codigo}`, ...args),
        aoAdmitir: ({ jogadorId }) => {
          marcarBotAtivo(jogadorId);
          destravarAdmissao(salaId);
        },
        aoFalhar: ({ jogadorId, apelido, codigo, mensagem }) => {
          marcarBotFalhou(jogadorId, codigo, mensagem);
          destravarAdmissao(salaId);
          // Visibilidade: broadcast para todos os Membros da Sala.
          try {
            contextoSalas.broadcast.enviar(salaId, {
              type: 'BOT_FALHOU',
              jogadorId,
              apelido,
              codigo,
              mensagem,
            });
          } catch (err) {
            console.error('[bots-route] falha ao difundir BOT_FALHOU:', (err as Error).message);
          }
        },
        aoEncerrar: () => {
          destravarAdmissao(salaId);
        },
      });

      // `iniciarBot` já registrou `admitindo` antes de retornar: o próximo
      // POST conta via `contarBotsEmAdmissao` + trava acima até MEMBRO_ENTROU.
      res.status(202).json({
        apelido: botInfo.apelido,
        email: botInfo.email,
        jogadorId: botInfo.jogadorId,
      });
    } catch (err) {
      destravarAdmissao(salaId);
      console.error('[bots-route] falha ao iniciar bot:', (err as Error).message);
      res.status(500).json({ mensagem: 'Falha ao iniciar bot.' });
    }
  });

  return router;
}
