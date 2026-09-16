/**
 * Conteúdo do Tutorial da Partida (issue #434): dados puros, sem componentes.
 *
 * Módulo separado do `TutorialDaPartida.tsx` para não misturar valores e
 * componentes no mesmo arquivo (`react-refresh/only-export-components`).
 * As mídias vivem no duto canônico (`frontend/web/media/tutorial/` →
 * `/media/tutorial/`, via `comBase`), cada uma com texto alternativo.
 */

import { comBase } from '../../api/basePath'

/** Mídia de um slide: arquivo do duto `/media/tutorial/` + texto alternativo. */
export interface MidiaDoTutorial {
  readonly src: string
  readonly alt: string
}

/** Slide do carrossel: conceito único com explicação curta e 1+ mídias. */
export interface SlideDoTutorial {
  readonly titulo: string
  readonly texto: string
  readonly midias: readonly MidiaDoTutorial[]
}

function midia(arquivo: string, alt: string): MidiaDoTutorial {
  return { src: comBase(`/media/tutorial/${arquivo}`), alt }
}

/**
 * Slides do carrossel (7: base de 5 da spec + desmembramento autorizado —
 * Especiais em 2 slides e Monstros em Vulto + Espectro, pela legibilidade no
 * modo compacto). Ordem dos tópicos e cobertura inalteradas. Copy curta no
 * glossário canônico (`CONTEXT.md`).
 */
export const SLIDES_DO_TUTORIAL_DA_PARTIDA: readonly SlideDoTutorial[] = [
  {
    titulo: 'Posicione Peças de Caminho',
    texto:
      'No Primeiro Turno, posicione sua Peça Inicial e seu peão. Depois, encaixe uma Peça de Caminho (reta, T ou cruz) por vez numa célula vazia — sempre com Conexão: as bordas abertas precisam mirar as bordas abertas das vizinhas.',
    midias: [
      midia('posicionar_primeira_peca.gif', 'Jogador posicionando a primeira peça do tabuleiro'),
      midia('posicionar_peca_conectada.gif', 'Peça de caminho encaixada com conexão às peças vizinhas'),
    ],
  },
  {
    titulo: 'Mova seu Peão',
    texto:
      'Seu peão anda por Movimentação: clique numa peça vizinha conectada à dele. O peão ilumina a própria célula e as vizinhas — essa Iluminação compartilhada revela o sanatório ao redor da equipe.',
    midias: [
      midia('movimentacao_peao.gif', 'Peão se movendo entre peças conectadas com a Iluminação acendendo ao redor'),
    ],
  },
  {
    titulo: 'Peças Especiais: Gerador e Sala do Diretor',
    texto:
      'O Gerador liga para sempre quando a posição de um peão é confirmada sobre ele — a vitória exige 3 Geradores ligados. A Sala do Diretor concede o Cartão de Acesso quando a posição de um peão é confirmada sobre ela.',
    midias: [
      midia('peca_gerador.png', 'Peça Especial do Gerador'),
      midia('sala_diretor.png', 'Peça Especial da Sala do Diretor'),
    ],
  },
  {
    titulo: 'Peças Especiais: Sala Médica e Portão de Saída',
    texto:
      'A Sala Médica concede Proteção contra o próximo Ataque quando a posição de um peão é confirmada sobre ela. O Portão de Saída é a fuga: a vitória exige os N peões da Partida reunidos nele.',
    midias: [
      midia('peca_sala_medica.png', 'Peça Especial da Sala Médica'),
      midia('ganho_de_protecao_sala_medica.png', 'Peão recebendo Proteção na Sala Médica'),
      midia('peca_portao_saida.png', 'Peça Especial do Portão de Saída'),
    ],
  },
  {
    titulo: 'Monstro: O Vulto',
    texto:
      'O Vulto ataca em linhas retas encadeadas por Conexões, sem limite de distância. Quem é atingido entra em Baixa Iluminação: o peão ilumina só a própria célula e o Recebimento cai para uma peça por turno.',
    midias: [
      midia('ataque_vulto.gif', 'O Vulto atacando um peão em seu alcance'),
      midia('movimento_com_baixa_iluminacao.gif', 'Peão se movendo com Baixa Iluminação, iluminando só a própria célula'),
    ],
  },
  {
    titulo: 'Monstro: O Espectro',
    texto:
      'O Espectro ataca as peças adjacentes conectadas à dele. Quem é atingido perde 1 ponto de Sanidade — com a Sanidade em zero, o Jogador fica Amedrontado e não realiza Ações no turno.',
    midias: [
      midia('ataque_espectro.gif', 'O Espectro atacando um peão adjacente'),
    ],
  },
  {
    titulo: 'Objetivo: vença ou perca em equipe',
    texto:
      'Vitória (Objetivo Global): 3 Geradores ligados + Cartão de Acesso + os N peões reunidos no Portão de Saída. Derrota: a equipe toda Amedrontada, ou a Caixa esgotada sem cumprir os objetivos.',
    midias: [
      midia('sinalizacao_objetivo.png', 'Sinalização do objetivo da partida'),
      midia('sinalizacao_objetivo_feito_gerador.png', 'Sinalização de gerador ligado cumprido'),
      midia('sinalizacao_objetivo_feito_cartao.png', 'Sinalização de Cartão de Acesso obtido'),
      midia('peca_portao_saida.png', 'Peça Especial do Portão de Saída, ponto de fuga da equipe'),
    ],
  },
]

/** Flag "uma vez por aba" (história 15): sessionStorage, sem persistência por usuário. */
export const CHAVE_SESSAO_TUTORIAL_DA_PARTIDA = 'tutorial-da-partida-visto'

/** Nova aba (flag ausente) exibe o Tutorial de novo; aba com Partida aberta já minimiza. */
export function tutorialJaVistoNaAba(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA) !== null
  } catch {
    return false
  }
}

/** Marca a aba como atendida: fechar por X/backdrop/Escape ≡ minimizar (história 9). */
export function marcarTutorialComoVistoNaAba(): void {
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO_TUTORIAL_DA_PARTIDA, '1')
  } catch {
    // Sessão indisponível (privado/restrito): sem a flag, cada Partida
    // auto-abre — degradado progressivo, nunca trava o jogo.
  }
}
