// Testes da captura de tráfego WS in/out + envio do controle de debug
// (issue #340) sobre o hook do canal da Sala, com o MockWebSocket do repo.
// Fontes: `ws→` (comandos enviados), `ws←` (eventos recebidos), `backend`
// (DEBUG_LOG espelhado) e o ATIVAR_DEBUG no open/ativação.

import { renderHook, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockWebSocket } from './helpers/mockWebSocket'

let coletor: typeof import('../web/src/utils/coletorDeDepuracao')
let useSalaWebSocket: typeof import('../web/src/hooks/useSalaWebSocket')['useSalaWebSocket']

beforeEach(async () => {
  vi.resetModules()
  window.sessionStorage.clear()
  MockWebSocket.clean()
  MockWebSocket.forceNoAutoOpen = false
  coletor = await import('../web/src/utils/coletorDeDepuracao')
  useSalaWebSocket = (await import('../web/src/hooks/useSalaWebSocket')).useSalaWebSocket
})

afterEach(() => {
  coletor.desinstalarColetorDeDepuracao()
})

describe('captura WS in/out no canal da Sala', () => {
  it('comando enviado vira entrada ws→ e evento recebido vira ws← (payload truncado)', async () => {
    const { result } = renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()?.readyState).toBe(1))

    act(() => result.current.criarSala())
    act(() => MockWebSocket.last()!.simulateMessage({ type: 'SALA_ATUALIZADA', sala: { id: 's-1', codigoDeSala: 'ABC123', membros: [] } }))

    const fontes = coletor.entradas().map((e) => e.fonte)
    expect(fontes).toContain('ws→')
    expect(fontes).toContain('ws←')
    const saida = coletor.entradas().find((e) => e.fonte === 'ws→')
    expect(saida?.contexto).toBe('sala')
    expect(saida?.mensagem).toContain('CRIAR_SALA')
    const entradaWs = coletor.entradas().find((e) => e.fonte === 'ws←')
    expect(entradaWs?.mensagem).toContain('SALA_ATUALIZADA')
  })

  it('payload acima de ~500 chars é truncado', async () => {
    renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()?.readyState).toBe(1))

    act(() => MockWebSocket.last()!.simulateMessage({ type: 'MENSAGEM_DE_CHAT', apelido: 'a', conteudo: 'y'.repeat(800), enviadoEm: 'x' }))

    const entradaWs = coletor.entradas().find((e) => e.fonte === 'ws←')
    expect(entradaWs?.mensagem.length).toBeLessThanOrEqual(501)
  })

  it('DEBUG_LOG vira fonte backend, não ws←', async () => {
    renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()?.readyState).toBe(1))

    act(() => MockWebSocket.last()!.simulateMessage({ type: 'DEBUG_LOG', nivel: 'warn', contexto: 'encaminhamento', mensagem: 'encaminhamento recusado: teste' }))

    const entrada = coletor.entradas().find((e) => e.fonte === 'backend')
    expect(entrada?.nivel).toBe('warn')
    expect(entrada?.contexto).toBe('encaminhamento')
    expect(coletor.entradas().filter((e) => e.fonte === 'ws←')).toHaveLength(0)
  })
})

describe('controle de debug on/off no canal da Sala', () => {
  it('modo ativo no boot: ATIVAR_DEBUG é enviado no open', async () => {
    coletor.ativarModoDoDesenvolvedor()
    renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()?.readyState).toBe(1))

    const enviados = MockWebSocket.last()!.sentMessages.map((m) => JSON.parse(m).type)
    expect(enviados).toContain('ATIVAR_DEBUG')
    expect(enviados).not.toContain('DESATIVAR_DEBUG')
  })

  it('modo desligado: nenhum controle é enviado', async () => {
    renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()?.readyState).toBe(1))

    const enviados = MockWebSocket.last()!.sentMessages.map((m) => JSON.parse(m).type)
    expect(enviados).not.toContain('ATIVAR_DEBUG')
  })

  it('ativação em sessão corrente: ATIVAR_DEBUG sai no instante da ativação', async () => {
    renderHook(() => useSalaWebSocket('jogador-1'))
    await waitFor(() => expect(MockWebSocket.last()?.readyState).toBe(1))
    expect(MockWebSocket.last()!.sentMessages.filter((m) => m.includes('ATIVAR_DEBUG'))).toHaveLength(0)

    act(() => coletor.ativarModoDoDesenvolvedor())

    expect(MockWebSocket.last()!.sentMessages.map((m) => JSON.parse(m).type)).toContain('ATIVAR_DEBUG')
  })
})
