export const hero = {
  eyebrow: 'Sanatório Flicker of Sanity',
  title: 'Prepare-se para a partida',
  copy: 'Explore corredores consumidos pela escuridão, esquive-se de ameaças sobrenaturais e trabalhe em equipe para resgatar recursos vitais e escapar com vida.',
  ctaSignup: 'Criar conta',
  ctaLogin: 'Entrar',
} as const

export type Trailer = {
  titulo: string
  descricao: string
  capa?: string
  src?: string
}

export const trailers = {
  id: 'trailers' as const,
  title: 'TRAILERS',
  items: [
    {
      titulo: 'Trailer de Anúncio',
      descricao:
        'Sinta o clima opressivo e o mistério que cercam as ruínas abandonadas do Sanatório Flicker of Sanity.',
    },
    {
      titulo: 'Gameplay em Grupo',
      descricao:
        'Confira a ação em tempo real: exploração do tabuleiro, ataques imprevistos, conquistas de objetivos e a corrida pela fuga.',
    },
  ] as Trailer[],
  labels: {
    play: 'Reproduzir',
    pause: 'Pausar',
    som: 'Ativar som',
    mudo: 'Silenciar',
  },
  mensagens: {
    carregando: 'Carregando trailer…',
    falha: 'Não foi possível carregar o vídeo agora. Enquanto isso, confira a capa do trailer.',
    indisponivel: 'Este trailer ainda não está disponível. Volte em breve para conferir.',
  },
} as const

export const history = {
  id: 'historia' as const,
  title: 'A História',
  paragraphs: [
    'O Sanatório Flicker of Sanity já foi motivo de orgulho: uma instituição moderna, com uma ala nova em construção e um livro de ocorrências preenchido com capricho, dia após dia. A última página desse livro, porém, termina no meio de uma frase — "a sombra deste lugar devora" — e depois dela não há mais nenhum registro, nenhuma assinatura, nenhuma explicação. Só páginas em branco.',
    'Você acorda no chão frio de uma ala abandonada do Sanatório Flicker of Sanity, sem qualquer memória de como chegou ali ou do motivo de a antiga instituição estar mergulhada em escuridão. Ao seu lado, repousam apenas uma vela acesa e uma carta queimada com um aviso perturbador: a sombra deste lugar devora a própria realidade. Sem compreender as forças sobrenaturais que tomaram os corredores, cada passo revela o desconhecido apenas até onde o brilho do fogo alcança — sabendo que a chama não durará para sempre e que o menor descuido pode significar ser consumido pelas sombras.',
  ],
  imageAlt: 'Corredor sombrio do Sanatório Flicker of Sanity com luzes crepitantes',
} as const

export const features = {
  id: 'caracteristicas' as const,
  title: 'Características do Jogo',
  items: [
    {
      title: 'Cooperação',
      description:
        'Junte um grupo de até 4 Jogadores em uma partida multiplayer em tempo real. A comunicação constante é a única garantia de que a equipe continuará unida e que aliados incapacitados serão resgatados a tempo.',
      imageAlt: 'Equipe de jogadores cooperando em um corredor do sanatório',
    },
    {
      title: 'O tabuleiro vivo',
      description:
        'Um mapa de tabuleiro em constante reconstrução. À medida que o grupo avança, o caminho atrás se apaga e desaparece permanentemente na escuridão, exigindo planejamento tático a cada movimento.',
      imageAlt: 'Sala abandonada com objetos espalhados e pistas visíveis',
    },
    {
      title: 'Iluminação & visibilidade',
      description:
        'A chama da vela determina a sua visão. Aventure-se pelo vazio do sanatório encarando o alcance limitado da luz e lide com a ameaça constante de ter a sua chama enfraquecida pelas sombras.',
      imageAlt: 'Interface de minigame com mecanismos para resolver',
    },
    {
      title: 'Salas estratégicas',
      description:
        'Navegue e explore cômodos específicos do sanatório para garantir recursos decisivos: ligue a energia em salas chave, recupere itens de acesso vitais ou busque abrigo na Sala Médica para obter proteção temporária.',
      imageAlt: 'Criatura sombria emergindo das sombras do sanatório',
    },
    {
      title: 'Ameaças sobrenaturais',
      description:
        'Entidades hostis espreitam nas sombras do sanatório. Evite a linha de visão nos corredores e desvie de investidas que enfraquecem a luz da sua vela e corroem a sua Sanidade.',
      imageAlt: 'Indicador de sanidade em estado crítico com efeitos visuais',
    },
  ],
} as const

export const objectives = {
  id: 'objetivos' as const,
  title: 'Para escapar, você precisa:',
  items: [
    {
      title: 'Energizar o Sanatório',
      description:
        'Explore os corredores para encontrar e ligar os 3 Geradores. A energia reestabelecida é indispensável para alimentar o sistema do Portão de Saída.',
      imageAlt: 'Gerador elétrico em sala de utilidade do sanatório',
      image: '/assets/objetivo-1.jpg',
      icon: 'geradores',
    },
    {
      title: 'Recuperar o Cartão de Acesso',
      description:
        'Infiltre-se na Sala do Diretor para obter o Cartão de Acesso, chave necessária para autorizar a abertura do portão principal.',
      imageAlt: 'Cartão de acesso brilhando sobre uma mesa de metal',
      image: '/assets/objetivo-2.jpg',
      icon: 'cartao',
    },
    {
      title: 'Alcançar o Portão de Saída',
      description:
        'Com os Geradores ligados e o Cartão de Acesso em mãos, reúnam-se todos no portão principal para destravar a tranca e fugir do sanatório.',
      imageAlt: 'Portão de saída metálico com tranca eletrônica',
      image: '/assets/objetivo-3.jpg',
      icon: 'portao',
    },
  ],
} as const

export const finalCta = {
  title: 'Pronto para enfrentar o sanatório?',
  copy: 'Reúna seus amigos para uma experiência onde a coragem e o trabalho em equipe serão testados para escapar da escuridão e dos perigos que os aguardam.',
  ctaSignup: 'Criar conta',
  ctaLogin: 'Entrar',
} as const

export const footer = {
  brand: 'Flicker of Sanity',
  tagline: 'Um jogo de terror cooperativo online.',
  copyright: `© ${new Date().getFullYear()} Flicker of Sanity. Todos os direitos reservados.`,
  logos: [
    {
      src: '/assets/Logo_Ginga_Branco.png',
      alt: 'Ginga',
    },
    {
      src: '/assets/alpha_edtech_logo_color_unofficial.svg',
      alt: 'Alpha EdTech',
      href: 'https://www.alphaedtech.org.br/',
    },
    {
      src: '/assets/Logo_Cummis.png',
      alt: 'Cummins',
      href: 'https://www.cummins.com/pt-br',
    },
  ],
} as const

export const stubs = {
  cadastro: {
    title: 'Cadastro',
    message: 'Esta página está em construção.',
  },
  login: {
    title: 'Entrar',
    message: 'Esta página está em construção.',
  },
  salasCriar: {
    title: 'Criar Sala',
    message: 'Esta página está em construção.',
  },
} as const
