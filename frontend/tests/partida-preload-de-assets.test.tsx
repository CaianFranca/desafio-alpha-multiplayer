// Aquecimento de sons + gate da revelação sem sons.
//
// - `aquecerSonsViaFetch` é o mecanismo puro (fetch injetado): sempre
//   resolve, tendo o som baixado ou falhado — falha abre com fallback.
// - `aquecerSons`/`useSonsProntos` somem o fast-path sem rede (jsdom/SSR)
//   e seguem como aquecimento best-effort em paralelo, fora do gate.
// - A sonda replica o latch da `PartidaPage` (`disponivel + cenaPronta`
//   com `cenaPronta = useCenaPronta(...)`, sem `sonsProntos`): os dots
//   seguram só pela cena 3D; sons pendentes/falhados nunca bloqueiam
//   (falha de som = silêncio, nunca dots).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { DefaultLoadingManager } from 'three'
import { SONS_DA_PARTIDA } from '../web/src/game/assets/manifestoDeAssets'
import {
  aquecerSons,
  aquecerSonsViaFetch,
  semRedeDeMidia,
} from '../web/src/game/assets/preloadDeAssets'
import { useSonsProntos } from '../web/src/hooks/useSonsProntos'
import {
  CENA_PRONTA_QUIET_MS,
  useCenaPronta,
} from '../web/src/hooks/useCenaPronta'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function buscarOk() {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
  })) as unknown as typeof fetch
}

function avanca(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('aquecimento de sons da Partida', () => {
  it('sem rede de mídia neste ambiente (fast-path do jsdom documentado)', () => {
    expect(semRedeDeMidia()).toBe(true)
  })

  it('baixa todos os sons e consome o corpo (download completo)', async () => {
    const buscar = buscarOk()
    await expect(aquecerSonsViaFetch(buscar)).resolves.toBeUndefined()
    expect(buscar).toHaveBeenCalledTimes(SONS_DA_PARTIDA.length)
    for (const url of SONS_DA_PARTIDA) {
      expect(buscar).toHaveBeenCalledWith(url)
    }
  })

  it('falha de rede assenta (abre com fallback, nunca trava)', async () => {
    const buscar = vi.fn(async () => {
      throw new Error('rede fora')
    }) as unknown as typeof fetch
    await expect(aquecerSonsViaFetch(buscar)).resolves.toBeUndefined()
  })

  it('resposta não-ok ou sem corpo assenta', async () => {
    const semCorpo = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch
    await expect(aquecerSonsViaFetch(semCorpo)).resolves.toBeUndefined()
    const naoOk = vi.fn(async () => ({
      ok: false,
      arrayBuffer: vi.fn(),
    })) as unknown as typeof fetch
    await expect(aquecerSonsViaFetch(naoOk)).resolves.toBeUndefined()
    expect(naoOk).toHaveBeenCalledTimes(SONS_DA_PARTIDA.length)
  })

  it('sem fetch disponível assenta na hora', async () => {
    await expect(
      aquecerSonsViaFetch(undefined as unknown as typeof fetch),
    ).resolves.toBeUndefined()
  })

  it('aquecerSons em ambiente sem rede não usa fetch e é voo único', async () => {
    const buscar = buscarOk()
    vi.stubGlobal('fetch', buscar)
    const primeira = aquecerSons()
    await expect(primeira).resolves.toBeUndefined()
    expect(buscar).not.toHaveBeenCalled()
    expect(aquecerSons()).toBe(primeira)
  })

  it('useSonsProntos nasce pronto sem rede, sem fetch', () => {
    const buscar = buscarOk()
    vi.stubGlobal('fetch', buscar)
    const { result } = renderHook(() => useSonsProntos())
    expect(result.current).toBe(true)
    expect(buscar).not.toHaveBeenCalled()
  })
})

function SondaComSons({
  conteudo,
  disponivel,
  sonsProntos,
}: {
  conteudo: boolean
  disponivel: boolean
  sonsProntos: boolean
}) {
  // `sonsProntos` recebido mas ignorado de propósito: replica o novo
  // contrato da PartidaPage — áudio fora do gate, só a cena 3D revela.
  void sonsProntos
  const pronta = useCenaPronta(conteudo)
  const [revelada, setRevelada] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- latch mão-única da sonda, replica o da PartidaPage
    if (disponivel && pronta && !revelada) setRevelada(true)
  }, [disponivel, pronta, revelada])
  return <div data-testid="revelacao">{revelada ? 'tabuleiro' : 'dots'}</div>
}

describe('gate da revelação sem sons (contrato da PartidaPage)', () => {
  it('sons pendentes não seguram os dots: só a cena 3D revela', () => {
    vi.useFakeTimers()
    render(
      <SondaComSons conteudo={true} disponivel={true} sonsProntos={false} />,
    )
    act(() => {
      DefaultLoadingManager.onStart?.('peca.jpg', 0, 1)
      DefaultLoadingManager.onLoad?.()
    })
    avanca(CENA_PRONTA_QUIET_MS)
    expect(screen.getByTestId('revelacao')).toHaveTextContent('tabuleiro')
  })

  it('cena 3D pendente segura os dots mesmo com os sons prontos', () => {
    vi.useFakeTimers()
    // Monta indisponível: o latch não pode disparar antes dos loads.
    const { rerender } = render(
      <SondaComSons conteudo={true} disponivel={false} sonsProntos={true} />,
    )
    act(() => {
      DefaultLoadingManager.onStart?.('peca.jpg', 0, 1)
    })
    rerender(
      <SondaComSons conteudo={true} disponivel={true} sonsProntos={true} />,
    )
    avanca(CENA_PRONTA_QUIET_MS)
    expect(screen.getByTestId('revelacao')).toHaveTextContent('dots')

    act(() => {
      DefaultLoadingManager.onLoad?.()
    })
    avanca(CENA_PRONTA_QUIET_MS)
    expect(screen.getByTestId('revelacao')).toHaveTextContent('tabuleiro')
  })
})
