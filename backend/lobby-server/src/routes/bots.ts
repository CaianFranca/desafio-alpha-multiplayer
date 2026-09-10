// Rota POST /api/bots/adicionar — aciona um bot efêmero na sala do Anfitrião.
//
// Proteções:
//   - requireSessao: exige autenticação válida.
//   - Verifica que o solicitante é Anfitrião de uma sala aberta.
//   - Verifica que a sala tem vagas (< 4 membros conectados).
//   - Limita a MAX_BOTS_NA_SALA bots simultâneos.
//   - Só disponível quando BOTS_HABILITADOS=true ou NODE_ENV !== 'production'.
//
// Resposta:
//   202 { apelido, email, jogadorId } — bot iniciado em background (fire-and-forget).
//   400 / 403 / 409 — erros de validação.

import { Router, type Request, type Response } from 'express';
import { getConfig } from '@flicker/config';
import { requireSessao } from '../middleware/auth.ts';
import { iniciarBot } from '../bots/bot-runner.ts';
import type { SalasContexto } from '../salas/index.ts';

/** Máximo de membros na sala (contrato do engine: 2..4). */
const MAX_MEMBROS_SALA = 4;

export function criarBotsRouter(contextoSalas: SalasContexto): Router {
  const router = Router();

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

    // 4. Verificar vagas
    const membrosAtivos = estadoSala.membros.filter((m) => m.presenca === 'conectado');
    if (membrosAtivos.length >= MAX_MEMBROS_SALA) {
      res.status(409).json({ mensagem: 'A sala está cheia (máximo 4 membros).' });
      return;
    }

    // 5. Montar URL base do lobby (sempre local: o BotRunner roda no mesmo processo)
    const { lobbyServerPort } = getConfig();
    const baseUrl = `http://127.0.0.1:${lobbyServerPort}`;

    // 6. Iniciar bot (registra + conecta em background)
    try {
      const botInfo = await iniciarBot({
        codigoDeSala: estadoSala.codigo,
        baseUrl,
        log: (...args) => console.log(`[bots-route] sala=${estadoSala.codigo}`, ...args),
      });

      res.status(202).json({
        apelido: botInfo.apelido,
        email: botInfo.email,
        jogadorId: botInfo.jogadorId,
      });
    } catch (err) {
      console.error('[bots-route] falha ao iniciar bot:', (err as Error).message);
      res.status(500).json({ mensagem: 'Falha ao iniciar bot.' });
    }
  });

  return router;
}
