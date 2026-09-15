// Hook do chat da Partida (issues #389/#388): unidade dos bloqueantes B1–B3 e
// da ressalva R2 — purga do enfileirado, ordem/dedupe da semente, reset por
// Partida e anúncio só do live. Sem socket: `enviar`/`estaConectado` são stubs.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useChatDaPartida } from '../web/src/hooks/useChatDaPartida'
import type { MensagemDeChatDaPartidaEvento } from '@flicker/shared'

function eventoLive(
  jogadorId: string,
  apelido: string,
  conteudo: string,
  enviadoEm: string,
): MensagemDeChatDaPartidaEvento {
  return { type: 'MENSAGEM_DE_CHAT_DA_PARTIDA', jogadorId, apelido, conteudo, enviadoEm }
}

function montar(partidaId: string | null = 'partida-1') {
  const enviar = vi.fn((): 'enviado' | 'enfileirado' => 'enviado')
  const descartarPendentesPorTipo = vi.fn(() => {})
  const utils = renderHook(
    ({ partida }: { partida: string | null }) =>
      useChatDaPartida({
        partidaId: partida,
        jogadorId: 'eu',
        estaConectado: () => true,
        enviar,
        descartarPendentesPorTipo,
      }),
    { initialProps: { partida: partidaId } },
  )
  return { ...utils, enviar, descartarPendentesPorTipo }
}

describe('useChatDaPartida — B1: enfileirado purga a fila e falha local', () => {
  it('descarta o comando da fila de pendentes e mostra a recusa enxuta', () => {
    // Corrida OPEN→close: o socket diz OPEN no check mas enfileira no envio.
    const enviarChat = vi.fn((): 'enviado' | 'enfileirado' => 'enfileirado')
    const descartarPendentesPorTipo = vi.fn(() => {})
    const { result } = renderHook(() =>
      useChatDaPartida({
        partidaId: 'partida-1',
        jogadorId: 'eu',
        estaConectado: () => true,
        enviar: enviarChat,
        descartarPendentesPorTipo,
      }),
    )
    let aceito = true
    act(() => {
      aceito = result.current.enviar('opa')
    })
    expect(aceito).toBe(false)
    expect(enviarChat).toHaveBeenCalledOnce()
    expect(descartarPendentesPorTipo).toHaveBeenCalledWith('ENVIAR_MENSAGEM_DE_CHAT')
    expect(result.current.recusa).toMatch(/Sem conexão com o servidor/i)
    expect(result.current.mensagens).toHaveLength(0)
  })
})

describe('useChatDaPartida — B2: semente entra antes do live com dedupe', () => {
  it('live antes do snapshot fica depois da semente; eco não duplica', () => {
    const { result } = montar()
    act(() => {
      result.current.aoEventoDeChat(eventoLive('cara', 'Cara', 'cheguei', '2026-09-14T14:02:00Z'))
    })
    act(() => {
      result.current.hidratarHistorico([
        eventoLive('ana', 'Ana', 'oi', '2026-09-14T14:00:00Z'),
        eventoLive('beto', 'Beto', 'bora', '2026-09-14T14:01:00Z'),
        // Eco do servidor do live já recebido: dedupe segura.
        eventoLive('cara', 'Cara', 'cheguei', '2026-09-14T14:02:00Z'),
      ])
    })
    expect(result.current.mensagens.map((m) => m.conteudo)).toEqual(['oi', 'bora', 'cheguei'])
  })
})

describe('useChatDaPartida — B2 (reconexão): snapshot traz o gap em ordem, sem duplicar', () => {
  it('live antes da queda + snapshot com faltantes → merge ordenado por enviadoEm, idempotente', () => {
    const { result } = montar()
    act(() => {
      result.current.hidratarHistorico([
        eventoLive('ana', 'Ana', 'oi', '2026-09-14T14:00:00Z'),
        eventoLive('beto', 'Beto', 'bora', '2026-09-14T14:01:00Z'),
      ])
    })
    act(() => {
      result.current.aoEventoDeChat(eventoLive('cara', 'Cara', 'cheguei', '2026-09-14T14:04:00Z'))
    })
    expect(result.current.mensagens.map((m) => m.conteudo)).toEqual(['oi', 'bora', 'cheguei'])
    const anuncioAposLive = result.current.anuncio?.conteudo
    const naoLidasAposLive = result.current.naoLidas

    // Reconexão: snapshot traz as antigas + gap do período de queda + eco do live.
    act(() => {
      result.current.hidratarHistorico([
        eventoLive('ana', 'Ana', 'oi', '2026-09-14T14:00:00Z'),
        eventoLive('beto', 'Beto', 'bora', '2026-09-14T14:01:00Z'),
        eventoLive('ana', 'Ana', 'gap-1', '2026-09-14T14:02:00Z'),
        eventoLive('beto', 'Beto', 'gap-2', '2026-09-14T14:03:00Z'),
        eventoLive('cara', 'Cara', 'cheguei', '2026-09-14T14:04:00Z'),
      ])
    })
    expect(result.current.mensagens.map((m) => m.conteudo)).toEqual([
      'oi',
      'bora',
      'gap-1',
      'gap-2',
      'cheguei',
    ])
    // Semente nunca anuncia nem conta como não lida.
    expect(result.current.anuncio?.conteudo).toBe(anuncioAposLive)
    expect(result.current.naoLidas).toBe(naoLidasAposLive)

    // Re-hidratação com o mesmo snapshot é idempotente.
    act(() => {
      result.current.hidratarHistorico([
        eventoLive('ana', 'Ana', 'oi', '2026-09-14T14:00:00Z'),
        eventoLive('beto', 'Beto', 'bora', '2026-09-14T14:01:00Z'),
        eventoLive('ana', 'Ana', 'gap-1', '2026-09-14T14:02:00Z'),
        eventoLive('beto', 'Beto', 'gap-2', '2026-09-14T14:03:00Z'),
        eventoLive('cara', 'Cara', 'cheguei', '2026-09-14T14:04:00Z'),
      ])
    })
    expect(result.current.mensagens.map((m) => m.conteudo)).toEqual([
      'oi',
      'bora',
      'gap-1',
      'gap-2',
      'cheguei',
    ])
  })
})

describe('useChatDaPartida — B3: troca de Partida reseta o painel', () => {
  it('feed, não-lidas e anúncio zeram no novo partidaId', () => {
    const { result, rerender } = montar('partida-1')
    act(() => {
      result.current.aoEventoDeChat(eventoLive('ana', 'Ana', 'oi', '2026-09-14T14:00:00Z'))
      result.current.abrir()
    })
    expect(result.current.mensagens).toHaveLength(1)
    expect(result.current.anuncio?.conteudo).toBe('oi')
    rerender({ partida: 'partida-2' })
    expect(result.current.mensagens).toHaveLength(0)
    expect(result.current.naoLidas).toBe(0)
    expect(result.current.anuncio).toBeNull()
    expect(result.current.aberto).toBe(false)
    expect(result.current.recusa).toBeNull()
  })
})

describe('useChatDaPartida — R2: semente não anuncia; só live anuncia', () => {
  it('hidratarHistorico alimenta o feed sem tocar o anúncio', () => {
    const { result } = montar()
    act(() => {
      result.current.hidratarHistorico([
        eventoLive('ana', 'Ana', 'histórico velho', '2026-09-14T14:00:00Z'),
      ])
    })
    expect(result.current.mensagens).toHaveLength(1)
    expect(result.current.anuncio).toBeNull()
    act(() => {
      result.current.aoEventoDeChat(eventoLive('beto', 'Beto', 'nova', '2026-09-14T14:01:00Z'))
    })
    expect(result.current.anuncio?.conteudo).toBe('nova')
  })
})
