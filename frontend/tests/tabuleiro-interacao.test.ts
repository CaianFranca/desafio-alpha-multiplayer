import {
  cursorParaCelula,
  cursorParaPecaPosicionada,
  deveSuprimirCliquePorArrasto,
  ehCelulaOcupada,
  mapearCliqueNaCelula,
  mapearCliqueNaPecaPosicionada,
  mapearFinalizarManipulacao,
  mapearGiro,
} from '../web/src/game/tabuleiro/interacao'
import { motivoDeRecusaDoEvento } from '../web/src/components/partida/somDeRecusa'
import { mapearCliqueNaPecaDaMesa } from '../web/src/game/tabuleiro/interacaoPeoes'
import type { EstadoInteracaoTabuleiro } from '../web/src/game/tabuleiro/interacao'
import type { Celula } from '../web/src/game/tabuleiro/contrato'
import type { TabuleiroEventoDoServidor } from '@flicker/shared'

// ── Helpers de estado ──

function estadoVazio(): EstadoInteracaoTabuleiro {
  return {
    iniciais: [{ pecaId: 'inicial-1' }, { pecaId: 'inicial-2' }, { pecaId: 'inicial-3' }],
    posicionadas: [],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: null,
  }
}

function comSelecao(pecaId: string): EstadoInteracaoTabuleiro {
  return { ...estadoVazio(), pecaSelecionadaId: pecaId }
}

function comPosicionada(
  pecaId: string,
  celula: Celula,
  opts?: Partial<EstadoInteracaoTabuleiro>,
): EstadoInteracaoTabuleiro {
  return {
    iniciais: [{ pecaId: 'inicial-2' }, { pecaId: 'inicial-3' }],
    posicionadas: [{ pecaId, celula }],
    pecaSelecionadaId: null,
    pecaEmManipulacaoId: pecaId,
    ...opts,
  }
}

describe('interação do tabuleiro — mapeamento puro (issue #84)', () => {
  // ── Critério: clique em peça da mesa (iniciais, issue #143) ──

  it('clique simples em Peça Inicial da mesa seleciona (emite SELECIONAR_PECA)', () => {
    const estado = estadoVazio()
    expect(mapearCliqueNaPecaDaMesa(null, estado, 'inicial-1')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-1',
    })
  })

  it('clicar em outra troca a seleção (sempre SELECIONAR_PECA com novo id)', () => {
    const estado = comSelecao('inicial-1')
    expect(mapearCliqueNaPecaDaMesa(null, estado, 'inicial-2')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-2',
    })
  })

  it('clicar na peça selecionada desfaz (mesmo comando, servidor emite peca_deselecionada)', () => {
    const estado = comSelecao('inicial-2')
    // Mesmo comando, sem ramo especial no cliente — validação no servidor.
    expect(mapearCliqueNaPecaDaMesa(null, estado, 'inicial-2')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-2',
    })
  })

  it('clique em peça fora das iniciais da mesa não reage (null; roteador puro valida a identidade)', () => {
    const estado = estadoVazio()
    expect(mapearCliqueNaPecaDaMesa(null, estado, 'reta-9')).toBeNull()
  })

  // ── Critério: girar emite rotação 90° nos dois sentidos ──

  it('girar emite GIRAR_PECA horário e anti_horário em passos discretos de 90°', () => {
    expect(mapearGiro('inicial-1', 'horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'inicial-1',
      sentido: 'horario',
    })
    expect(mapearGiro('reta-1', 'anti_horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'reta-1',
      sentido: 'anti_horario',
    })
  })

  it('rotação na mesa e rotação na célula usam o mesmo mapeamento', () => {
    const cmdMesa = mapearGiro('inicial-3', 'horario')
    const estadoManip = comPosicionada('inicial-1', { linha: 3, coluna: 3 })
    const cmdCelula = mapearGiro(estadoManip.pecaEmManipulacaoId!, 'horario')
    expect(cmdMesa.type).toBe('GIRAR_PECA')
    expect(cmdCelula.type).toBe('GIRAR_PECA')
    expect(cmdCelula).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'inicial-1',
      sentido: 'horario',
    })
  })

  // ── Critério: clique em célula vazia emite posicionamento; ocupada não reage ──

  it('clique em célula vazia com seleção emite POSICIONAR_PECA', () => {
    const estado = comSelecao('inicial-1')
    expect(mapearCliqueNaCelula(estado, { linha: 3, coluna: 3 })).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'inicial-1',
      celula: { linha: 3, coluna: 3 },
    })
  })

  it('célula ocupada não reage ao clique (retorna null)', () => {
    const estado: EstadoInteracaoTabuleiro = {
      iniciais: [{ pecaId: 'inicial-2' }],
      posicionadas: [{ pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 } }],
      pecaSelecionadaId: 'inicial-2',
      pecaEmManipulacaoId: null,
    }
    expect(mapearCliqueNaCelula(estado, { linha: 3, coluna: 3 })).toBeNull()
    expect(ehCelulaOcupada(estado.posicionadas, { linha: 3, coluna: 3 })).toBe(true)
  })

  it('célula ocupada não reage ao cursor (default, não pointer)', () => {
    expect(cursorParaCelula(true, 'inicial-1')).toBe('default')
    expect(cursorParaCelula(true, null)).toBe('default')
  })

  it('célula vazia sem seleção não emite comando (null) e cursor é default', () => {
    const estado = estadoVazio()
    expect(mapearCliqueNaCelula(estado, { linha: 3, coluna: 3 })).toBeNull()
    expect(cursorParaCelula(false, null)).toBe('default')
  })

  it('célula vazia com seleção tem cursor pointer', () => {
    expect(cursorParaCelula(false, 'inicial-1')).toBe('pointer')
  })

  it('peça em manipulação tem cursor pointer; fora de manipulação default', () => {
    expect(cursorParaPecaPosicionada('inicial-1', 'inicial-1')).toBe('pointer')
    expect(cursorParaPecaPosicionada('inicial-1', 'reta-2')).toBe('default')
    expect(cursorParaPecaPosicionada(null, 'inicial-1')).toBe('default')
  })

  // ── Critério: rotação na célula até Finalização ──

  it('após o encaixe, girar a peça posicionada continua mapeado (manipulação aberta)', () => {
    const estado = comPosicionada('inicial-1', { linha: 2, coluna: 2 })
    // Giro na célula é o mesmo comando GIRAR_PECA.
    expect(mapearGiro(estado.pecaEmManipulacaoId!, 'horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'inicial-1',
      sentido: 'horario',
    })
    expect(mapearGiro(estado.pecaEmManipulacaoId!, 'anti_horario')).toEqual({
      type: 'GIRAR_PECA',
      pecaId: 'inicial-1',
      sentido: 'anti_horario',
    })
  })

  it('nova seleção encerra a manipulação — mapeado como SELECIONAR_PECA (Finalização)', () => {
    const estado = comPosicionada('inicial-1', { linha: 2, coluna: 2 }, {
      pecaSelecionadaId: null,
    })
    // Nova seleção: emite SELECIONAR_PECA; servidor fecha manipulação anterior.
    expect(mapearCliqueNaPecaDaMesa(null, estado, 'inicial-2')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-2',
    })
  })

  it('novo posicionamento encerra a janela anterior (via POSICIONAR_PECA)', () => {
    // Estado com manipulação de inicial-1 e seleção de inicial-2
    const estado: EstadoInteracaoTabuleiro = {
      iniciais: [{ pecaId: 'inicial-2' }],
      posicionadas: [{ pecaId: 'inicial-1', celula: { linha: 2, coluna: 2 } }],
      pecaSelecionadaId: 'inicial-2',
      pecaEmManipulacaoId: 'inicial-1',
    }
    expect(mapearCliqueNaCelula(estado, { linha: 5, coluna: 5 })).toEqual({
      type: 'POSICIONAR_PECA',
      pecaId: 'inicial-2',
      celula: { linha: 5, coluna: 5 },
    })
  })

  it('clique na própria peça posicionada em manipulação finaliza (SELECIONAR_PECA)', () => {
    const estado = comPosicionada('inicial-1', { linha: 2, coluna: 2 })
    expect(mapearCliqueNaPecaPosicionada(estado, 'inicial-1')).toEqual({
      type: 'SELECIONAR_PECA',
      pecaId: 'inicial-1',
    })
  })

  it('clique em peça posicionada fora de manipulação não emite comando', () => {
    const estado: EstadoInteracaoTabuleiro = {
      iniciais: [{ pecaId: 'inicial-2' }],
      posicionadas: [
        { pecaId: 'inicial-1', celula: { linha: 2, coluna: 2 } },
        { pecaId: 'inicial-2', celula: { linha: 5, coluna: 5 } },
      ],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null, // já finalizada
    }
    expect(mapearCliqueNaPecaPosicionada(estado, 'inicial-1')).toBeNull()
    expect(mapearCliqueNaPecaPosicionada(estado, 'inicial-2')).toBeNull()
  })

  it('comando explícito FINALIZAR_MANIPULACAO disponível', () => {
    expect(mapearFinalizarManipulacao()).toEqual({ type: 'FINALIZAR_MANIPULACAO' })
  })

  // ── Critério: recusas tocam som com motivo; aprovações ficam em silêncio (#228) ──

  it('eventos de sucesso ficam em silêncio (null — o efeito no tabuleiro basta)', () => {
    const eventos: TabuleiroEventoDoServidor[] = [
      { type: 'PECA_SELECIONADA', pecaId: 'inicial-1' },
      { type: 'PECA_DESELECIONADA', pecaId: 'inicial-1' },
      { type: 'PECA_GIRADA', pecaId: 'inicial-1', orientacaoAnterior: 0, orientacao: 90, sentido: 'horario' },
      { type: 'PECA_POSICIONADA', pecaId: 'inicial-1', celula: { linha: 3, coluna: 3 }, orientacao: 0 },
      { type: 'MANIPULACAO_FINALIZADA', pecaId: 'inicial-1' },
    ]
    for (const ev of eventos) {
      expect(motivoDeRecusaDoEvento(ev)).toBeNull()
    }
  })

  it('erros do tabuleiro geram motivo de recusa (genérico por padrão)', () => {
    const erro: TabuleiroEventoDoServidor = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'CELULA_JA_OCUPADA',
      mensagem: 'Célula ocupada',
    }
    expect(motivoDeRecusaDoEvento(erro)).toBe('rejeicao_do_servico')
  })

  it('ação fora da vez tem motivo próprio (distinto do erro de comando)', () => {
    const erro: TabuleiroEventoDoServidor = {
      type: 'ERRO_DO_TABULEIRO',
      codigo: 'FORA_DA_VEZ',
      mensagem: 'Não é a sua vez.',
    }
    const motivo = motivoDeRecusaDoEvento(erro)
    expect(motivo).toBe('fora_da_vez')
    expect(motivo).not.toBe('rejeicao_do_servico')
  })

  // ── Critério: arrasto reservado à câmera ──

  it('arrasto abaixo do limiar não suprime clique; acima suprime', () => {
    // LIMIAR_ARRASTO_PX = 6 (cameraLimites.ts:11)
    expect(deveSuprimirCliquePorArrasto(0, 0)).toBe(false)
    expect(deveSuprimirCliquePorArrasto(5, 0)).toBe(false)
    expect(deveSuprimirCliquePorArrasto(3, 4)).toBe(false) // hypot 5
    expect(deveSuprimirCliquePorArrasto(6, 0)).toBe(true)
    expect(deveSuprimirCliquePorArrasto(0, 6)).toBe(true)
    expect(deveSuprimirCliquePorArrasto(4, 5)).toBe(true) // hypot ~6.4
    expect(deveSuprimirCliquePorArrasto(10, 10)).toBe(true)
  })

  it('clique simples sem arrasto engatado permanece mapeado; arrasto não gera comando', () => {
    // Simula guarda na camada de input: se suprime, não chama mapeadores.
    const dx = 10
    const dy = 0
    const suprime = deveSuprimirCliquePorArrasto(dx, dy)
    expect(suprime).toBe(true)
    // Quando suprime, o caller deve ignorar o clique — nenhum comando é gerado.
    const estado = comSelecao('inicial-1')
    const comandoSeNaoSuprimido = mapearCliqueNaCelula(estado, { linha: 3, coluna: 3 })
    expect(comandoSeNaoSuprimido).not.toBeNull()
    // O fluxo correto com supressão: comando não é emitido.
    const comandoComSupressao = suprime ? null : comandoSeNaoSuprimido
    expect(comandoComSupressao).toBeNull()
  })
})
