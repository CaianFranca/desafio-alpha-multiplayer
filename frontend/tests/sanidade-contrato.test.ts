import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import {
  criarEstadoInicialDoCliente,
  reduzirEvento,
  reduzirEventos,
} from '../web/src/game/tabuleiro/reducao'
import { aplicarSnapshot } from '../web/src/game/tabuleiro/snapshot'
import { TabuleiroMirrorDOM } from '../web/src/components/partida/TabuleiroMirrorDOM'
import { todasAsCelulas } from '../web/src/game/tabuleiro/contrato'
import type { EstadoDaPartidaSnapshot } from '@flicker/shared'

function snapshotComJogadores(
  jogadores: EstadoDaPartidaSnapshot['jogadores'],
  overrides: Partial<EstadoDaPartidaSnapshot> = {},
): EstadoDaPartidaSnapshot {
  return {
    tabuleiro: {
      posicionadas: [],
      iniciais: [],
      peoes: [],
      recebidas: [],
      pecaSelecionadaId: null,
      pecaEmManipulacaoId: null,
      peaoSelecionadoId: null,
      // Campos de objetivo global (issue #145): neutros para estes testes.
      pecasRestantesNaCaixa: 83,
    },
    jogadores,
    jogadorAtivoId: jogadores[0]?.jogadorId ?? 'j1',
    rodada: 1,
    pecaDoInicioDoTurnoId: null,
    posicaoConfirmada: false,
    celulasIluminadas: [],
    estado: 'em_andamento',
    resultado: null,
    geradoresLigados: [],
    cartaoDeAcessoObtido: false,
    ...overrides,
  }
}

describe('percepção de Sanidade e estados no cliente — tradução dos novos eventos (issue #174)', () => {
  it('estado inicial tem sanidade vazia', () => {
    const inicial = criarEstadoInicialDoCliente()
    expect(inicial.jogadorPorId).toEqual({})
  })

  it('aplicarSnapshot popula sanidade e estados (fonte autoritativa para late-join)', () => {
    const snapshot = snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
      { jogadorId: 'j2', apelido: 'Bob', cor: 'vermelho', ordem: 1, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 1, emBaixaIluminacao: true, amedrontado: false, protegido: false },
      { jogadorId: 'j3', apelido: 'Carol', cor: 'azul', ordem: 2, peaoId: 'peao-azul', primeiroTurnoPendente: false, sanidade: 0, emBaixaIluminacao: false, amedrontado: true, protegido: false },
    ])
    const estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshot)
    expect(estado.jogadorPorId['j1']).toEqual({ apelido: 'Ana', cor: 'branco', sanidade: 3, emBaixaIluminacao: false, amedrontado: false })
    expect(estado.jogadorPorId['j2']).toEqual({ apelido: 'Bob', cor: 'vermelho', sanidade: 1, emBaixaIluminacao: true, amedrontado: false })
    expect(estado.jogadorPorId['j3']).toEqual({ apelido: 'Carol', cor: 'azul', sanidade: 0, emBaixaIluminacao: false, amedrontado: true })
    expect(estado.peaoPorJogador['j2']).toBe('peao-vermelho')
  })

  it('ATAQUE_RESOLVIDO com estadosAplicados atualiza sanidade e Baixa Iluminação', () => {
    let estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    estado = reduzirEvento(estado, {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] }],
      peoesAtingidos: ['peao-branco'],
      protegidos: [],
      estadosAplicados: [{ jogadorId: 'j1', emBaixaIluminacao: true, sanidade: 3, amedrontado: false }],
    })
    expect(estado.jogadorPorId['j1'].emBaixaIluminacao).toBe(true)
    expect(estado.jogadorPorId['j1'].sanidade).toBe(3)
    expect(estado.jogadorPorId['j1'].amedrontado).toBe(false)
  })

  it('ATAQUE_RESOLVIDO do Espectro reduz sanidade e marca Amedrontado quando chega a zero', () => {
    let estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 1, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    estado = reduzirEvento(estado, {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [{ pecaId: 'espectro-1', tipo: 'espectro', peoesNoAlcance: ['peao-branco'] }],
      peoesAtingidos: ['peao-branco'],
      protegidos: [],
      estadosAplicados: [{ jogadorId: 'j1', emBaixaIluminacao: false, sanidade: 0, amedrontado: true }],
    })
    expect(estado.jogadorPorId['j1'].sanidade).toBe(0)
    expect(estado.jogadorPorId['j1'].amedrontado).toBe(true)
  })

  it('ATAQUE_RESOLVIDO vazio (sem estadosAplicados) não altera sanidade mas registra feedback', () => {
    const base = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    const estado = reduzirEvento(base, {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: [] }],
      peoesAtingidos: [],
      protegidos: [],
      estadosAplicados: [],
    })
    expect(estado.jogadorPorId['j1']).toEqual(base.jogadorPorId['j1'])
    // estado permanece igual (referência) quando não há mudança — feedback via flash em PartidaPage
    expect(estado).toBe(base)
  })

  it('RESGATE_REALIZADO remove Baixa Iluminação sem alterar sanidade', () => {
    let estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 2, emBaixaIluminacao: true, amedrontado: false, protegido: false },
      { jogadorId: 'j2', apelido: 'Bob', cor: 'vermelho', ordem: 1, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    estado = reduzirEvento(estado, {
      type: 'RESGATE_REALIZADO',
      pecaId: 'posicionada-1',
      resgatadoJogadorId: 'j1',
      resgatadorJogadorId: 'j2',
      resgatadorPeaoId: 'peao-vermelho',
    })
    expect(estado.jogadorPorId['j1'].emBaixaIluminacao).toBe(false)
    expect(estado.jogadorPorId['j1'].amedrontado).toBe(false)
    expect(estado.jogadorPorId['j1'].sanidade).toBe(2)
  })

  it('RESGATE_REALIZADO de amedrontado restaura sanidade a 1 e limpa estados', () => {
    let estado = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 0, emBaixaIluminacao: false, amedrontado: true, protegido: false },
      { jogadorId: 'j2', apelido: 'Bob', cor: 'vermelho', ordem: 1, peaoId: 'peao-vermelho', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    estado = reduzirEvento(estado, {
      type: 'RESGATE_REALIZADO',
      pecaId: 'posicionada-1',
      resgatadoJogadorId: 'j1',
      resgatadorJogadorId: 'j2',
      resgatadorPeaoId: 'peao-vermelho',
    })
    expect(estado.jogadorPorId['j1'].sanidade).toBe(1)
    expect(estado.jogadorPorId['j1'].amedrontado).toBe(false)
    expect(estado.jogadorPorId['j1'].emBaixaIluminacao).toBe(false)
  })

  it('ATAQUE_RESOLVIDO ignora jogador desconhecido antes do snapshot (evita vazar jogadorId)', () => {
    const inicial = criarEstadoInicialDoCliente()
    const estado = reduzirEvento(inicial, {
      type: 'ATAQUE_RESOLVIDO',
      atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] }],
      peoesAtingidos: ['peao-branco'],
      protegidos: [],
      estadosAplicados: [{ jogadorId: 'desconhecido', emBaixaIluminacao: true, sanidade: 2, amedrontado: false }],
    })
    expect(estado.jogadorPorId['desconhecido']).toBeUndefined()
    expect(estado).toBe(inicial) // sem snapshot não cria entrada — aguarda projeção autoritativa
  })

  it('LIMPEZA_APLICADA remove peças de monstro sem afetar sanidade', () => {
    let estado = criarEstadoInicialDoCliente()
    // Seed com posicionadas incluindo monstros via evento direto (simula snapshot + posicionamento)
    estado = reduzirEvento(estado, {
      type: 'PECA_POSICIONADA',
      pecaId: 'vulto-1',
      celula: { linha: 1, coluna: 1 },
      orientacao: 0,
    } as any)
    // Força posicionada vulto manualmente para teste de limpeza
    const comVulto = {
      ...estado,
      posicionadas: [...estado.posicionadas, { pecaId: 'vulto-1', tipo: 'vulto' as const, orientacao: 0 as const, celula: { linha: 1, coluna: 1 } }],
    }
    let comSanidade = aplicarSnapshot(comVulto, snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 2, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    comSanidade = reduzirEvento(comSanidade, {
      type: 'LIMPEZA_APLICADA',
      pecasRemovidas: ['vulto-1'],
    })
    expect(comSanidade.posicionadas.some((p) => p.pecaId === 'vulto-1')).toBe(false)
    expect(comSanidade.jogadorPorId['j1'].sanidade).toBe(2)
  })

  it('lote ATAQUE + LIMPEZA coexistem sem interferência na sanidade', () => {
    let base = aplicarSnapshot(criarEstadoInicialDoCliente(), snapshotComJogadores([
      { jogadorId: 'j1', apelido: 'Ana', cor: 'branco', ordem: 0, peaoId: 'peao-branco', primeiroTurnoPendente: false, sanidade: 3, emBaixaIluminacao: false, amedrontado: false, protegido: false },
    ]))
    const estado = reduzirEventos(base, [
      {
        type: 'ATAQUE_RESOLVIDO',
        atacantes: [{ pecaId: 'vulto-1', tipo: 'vulto', peoesNoAlcance: ['peao-branco'] }],
        peoesAtingidos: ['peao-branco'],
        protegidos: [],
        estadosAplicados: [{ jogadorId: 'j1', emBaixaIluminacao: true, sanidade: 3, amedrontado: false }],
      },
      { type: 'LIMPEZA_APLICADA', pecasRemovidas: ['alguma-peca'] },
    ])
    expect(estado.jogadorPorId['j1'].emBaixaIluminacao).toBe(true)
  })

  it('espelho DOM expõe sanidade e estados em data-attributes (jsdom)', () => {
    const todas = todasAsCelulas()
    const sanidadePorPeao = {
      'peao-branco': { sanidade: 0, emBaixaIluminacao: false, amedrontado: true },
      'peao-vermelho': { sanidade: 2, emBaixaIluminacao: true, amedrontado: false },
    }
    const { container } = render(
      React.createElement(TabuleiroMirrorDOM, {
        todasCelulas: todas,
        ocupadasSet: new Set<string>(),
        iniciais: [],
        posicionadas: [],
        peoes: [
          { peaoId: 'peao-branco', cor: 'branco', celula: { linha: 3, coluna: 3 } },
          { peaoId: 'peao-vermelho', cor: 'vermelho', celula: { linha: 3, coluna: 4 } },
        ],
        peaoSelecionadoId: null,
        destinosSet: new Set<string>(),
        sanidadePorPeao,
      }),
    )
    const branco = container.querySelector('[data-peao-id="peao-branco"]')
    const vermelho = container.querySelector('[data-peao-id="peao-vermelho"]')
    expect(branco?.getAttribute('data-sanidade')).toBe('0')
    expect(branco?.getAttribute('data-amedrontado')).toBe('true')
    expect(branco?.getAttribute('data-em-baixa')).toBeNull()
    expect(vermelho?.getAttribute('data-sanidade')).toBe('2')
    expect(vermelho?.getAttribute('data-em-baixa')).toBe('true')
    expect(vermelho?.getAttribute('data-amedrontado')).toBeNull()
  })
})
