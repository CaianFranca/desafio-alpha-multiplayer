export type EstadoDaSala = 'aberta' | 'encerrada';
export type EstadoDoVinculo = 'ativo' | 'encerrado';

export const MOTIVOS_DE_ENCERRAMENTO = [
  'saida',
  'expulsao',
  'expiracao',
  'encerramento',
] as const;

export type MotivoDeEncerramento = (typeof MOTIVOS_DE_ENCERRAMENTO)[number];

export interface Membro {
  readonly id: string;
  readonly jogadorId: string;
  readonly ordemDeEntrada: number;
  readonly estado: EstadoDoVinculo;
  readonly motivoEncerramento: MotivoDeEncerramento | null;
}

export interface Sala {
  readonly id: string;
  readonly codigo: string;
  readonly estado: EstadoDaSala;
  readonly membros: readonly Membro[];
  readonly proximaOrdemDeEntrada: number;
  readonly anfitriaoId: string | null;
  readonly jogadoresBloqueados: readonly string[];
}

export interface EstadoDoLobby {
  readonly salas: readonly Sala[];
}

export interface CriarSalaComando {
  readonly tipo: 'criar_sala';
  readonly salaId: string;
  readonly codigo: string;
  readonly membroId: string;
  readonly jogadorId: string;
}

export interface EntrarNaSalaComando {
  readonly tipo: 'entrar_na_sala';
  readonly salaId: string;
  readonly membroId: string;
  readonly jogadorId: string;
}

export interface SairDaSalaComando {
  readonly tipo: 'sair_da_sala';
  readonly salaId: string;
  readonly jogadorId: string;
  readonly membroId?: string;
}

export interface ExpulsarMembroComando {
  readonly tipo: 'expulsar_membro';
  readonly salaId: string;
  readonly anfitriaoMembroId: string;
  readonly membroAlvoId: string;
}

export interface AutorizarRetornoComando {
  readonly tipo: 'autorizar_retorno';
  readonly salaId: string;
  readonly anfitriaoMembroId: string;
  readonly jogadorId: string;
}

export type Comando =
  | CriarSalaComando
  | EntrarNaSalaComando
  | SairDaSalaComando
  | ExpulsarMembroComando
  | AutorizarRetornoComando;

export interface SalaCriadaEvento {
  readonly tipo: 'sala_criada';
  readonly salaId: string;
  readonly codigo: string;
  readonly membroId: string;
  readonly jogadorId: string;
  readonly anfitriaoId: string;
}

export interface MembroAdmitidoEvento {
  readonly tipo: 'membro_admitido';
  readonly salaId: string;
  readonly membroId: string;
  readonly jogadorId: string;
  readonly ordemDeEntrada: number;
}

export interface MembroSaiuEvento {
  readonly tipo: 'membro_saiu';
  readonly salaId: string;
  readonly membroId: string;
  readonly jogadorId: string;
  readonly ordemDeEntrada: number;
  readonly motivo: 'saida';
}

export interface SalaEncerradaEvento {
  readonly tipo: 'sala_encerrada';
  readonly salaId: string;
  readonly motivo: 'saida';
}

export interface MembroExpulsoEvento {
  readonly tipo: 'membro_expulsado';
  readonly salaId: string;
  readonly membroId: string;
  readonly jogadorId: string;
  readonly ordemDeEntrada: number;
  readonly motivo: 'expulsao';
}

export interface AnfitriaoSucedidoEvento {
  readonly tipo: 'anfitriao_sucedido';
  readonly salaId: string;
  readonly anfitriaoAnteriorId: string;
  readonly anfitriaoNovoId: string;
}

export interface RetornoAutorizadoEvento {
  readonly tipo: 'retorno_autorizado';
  readonly salaId: string;
  readonly jogadorId: string;
}

export type EventoDeDominio =
  | SalaCriadaEvento
  | MembroAdmitidoEvento
  | MembroSaiuEvento
  | SalaEncerradaEvento
  | MembroExpulsoEvento
  | AnfitriaoSucedidoEvento
  | RetornoAutorizadoEvento;

export type CodigoDeErro =
  | 'DADOS_INVALIDOS'
  | 'SALA_JA_EXISTE'
  | 'CODIGO_SALA_JA_EXISTE'
  | 'MEMBRO_ID_JA_EXISTE'
  | 'SALA_NAO_ENCONTRADA'
  | 'SALA_ENCERRADA'
  | 'SALA_CHEIA'
  | 'JOGADOR_JA_ASSOCIADO'
  | 'MEMBRO_NAO_ENCONTRADO'
  | 'MEMBRO_NAO_ATIVO'
  | 'APENAS_ANFITRIAO'
  | 'JOGADOR_EXPULSO'
  | 'JOGADOR_NAO_BLOQUEADO';

export interface ErroDeDominio {
  readonly tipo: 'erro_de_dominio';
  readonly codigo: CodigoDeErro;
  readonly mensagem: string;
  readonly salaId?: string;
  readonly jogadorId?: string;
  readonly membroId?: string;
}

export interface OperacaoBemSucedida {
  readonly sucesso: true;
  readonly estado: EstadoDoLobby;
  readonly eventos: readonly EventoDeDominio[];
}

export interface OperacaoRejeitada {
  readonly sucesso: false;
  readonly erro: ErroDeDominio;
}

export type Resultado = OperacaoBemSucedida | OperacaoRejeitada;

const LIMITE_DE_MEMBROS = 4;

export function estadoDoLobbyVazio(): EstadoDoLobby {
  return { salas: [] };
}

export function aplicarComando(
  estado: EstadoDoLobby,
  comando: Comando,
): Resultado {
  switch (comando.tipo) {
    case 'criar_sala':
      return criarSala(estado, comando);
    case 'entrar_na_sala':
      return entrarNaSala(estado, comando);
    case 'sair_da_sala':
      return sairDaSala(estado, comando);
    case 'expulsar_membro':
      return expulsarMembro(estado, comando);
    case 'autorizar_retorno':
      return autorizarRetorno(estado, comando);
    default:
      return rejeitar('DADOS_INVALIDOS', 'O comando de domínio é inválido.');
  }
}

export function criarSala(
  estado: EstadoDoLobby,
  comando: CriarSalaComando,
): Resultado {
  const dadosInvalidos = validarTexto(
    comando.salaId,
    comando.codigo,
    comando.membroId,
    comando.jogadorId,
  );
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  if (estado.salas.some((sala) => sala.id === comando.salaId)) {
    return rejeitar('SALA_JA_EXISTE', 'A Sala já existe.', {
      salaId: comando.salaId,
    });
  }

  if (estado.salas.some((sala) => sala.codigo === comando.codigo)) {
    return rejeitar('CODIGO_SALA_JA_EXISTE', 'O Código de Sala já existe.', {
      salaId: comando.salaId,
    });
  }

  if (encontrarMembro(estado, comando.membroId)) {
    return rejeitar('MEMBRO_ID_JA_EXISTE', 'O identificador do Membro já existe.', {
      membroId: comando.membroId,
    });
  }

  if (encontrarAssociacaoAtiva(estado, comando.jogadorId)) {
    return rejeitar(
      'JOGADOR_JA_ASSOCIADO',
      'O Jogador já possui uma associação ativa em outra Sala.',
      { jogadorId: comando.jogadorId },
    );
  }

  const sala: Sala = {
    id: comando.salaId,
    codigo: comando.codigo,
    estado: 'aberta',
    membros: [membroAtivo(comando.membroId, comando.jogadorId, 1)],
    proximaOrdemDeEntrada: 2,
    anfitriaoId: comando.membroId,
    jogadoresBloqueados: [],
  };

  return sucesso(
    { salas: [...estado.salas, sala] },
    [
      {
        tipo: 'sala_criada',
        salaId: sala.id,
        codigo: sala.codigo,
        membroId: comando.membroId,
        jogadorId: comando.jogadorId,
        anfitriaoId: comando.membroId,
      },
    ],
  );
}

export function entrarNaSala(
  estado: EstadoDoLobby,
  comando: EntrarNaSalaComando,
): Resultado {
  const sala = estado.salas.find((item) => item.id === comando.salaId);
  if (!sala) {
    return rejeitar('SALA_NAO_ENCONTRADA', 'A Sala não foi encontrada.', {
      salaId: comando.salaId,
    });
  }

  const dadosInvalidos = validarTexto(
    comando.salaId,
    comando.membroId,
    comando.jogadorId,
  );
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  if (sala.jogadoresBloqueados.includes(comando.jogadorId)) {
    return rejeitar(
      'JOGADOR_EXPULSO',
      'O Jogador foi expulso da Sala e ainda não teve o retorno autorizado pelo Anfitrião.',
      { salaId: sala.id, jogadorId: comando.jogadorId },
    );
  }

  const membroAtivoExistente = sala.membros.find(
    (membro) => membro.estado === 'ativo' && membro.jogadorId === comando.jogadorId,
  );
  if (membroAtivoExistente) {
    return sucesso(estado, []);
  }

  const outraAssociacao = encontrarAssociacaoAtiva(estado, comando.jogadorId);
  if (outraAssociacao && outraAssociacao.salaId !== comando.salaId) {
    return rejeitar(
      'JOGADOR_JA_ASSOCIADO',
      'O Jogador já possui uma associação ativa em outra Sala.',
      { jogadorId: comando.jogadorId, salaId: outraAssociacao.salaId },
    );
  }

  if (sala.estado === 'encerrada') {
    return rejeitar('SALA_ENCERRADA', 'A Sala está encerrada.', {
      salaId: sala.id,
    });
  }

  if (sala.membros.filter((membro) => membro.estado === 'ativo').length >= LIMITE_DE_MEMBROS) {
    return rejeitar('SALA_CHEIA', 'A Sala já possui quatro Membros ativos.', {
      salaId: sala.id,
    });
  }

  if (encontrarMembro(estado, comando.membroId)) {
    return rejeitar('MEMBRO_ID_JA_EXISTE', 'O identificador do Membro já existe.', {
      membroId: comando.membroId,
    });
  }

  const membro = membroAtivo(
    comando.membroId,
    comando.jogadorId,
    sala.proximaOrdemDeEntrada,
  );
  const novaSala: Sala = {
    ...sala,
    membros: [...sala.membros, membro],
    proximaOrdemDeEntrada: sala.proximaOrdemDeEntrada + 1,
  };

  return sucesso(
    substituirSala(estado, novaSala),
    [
      {
        tipo: 'membro_admitido',
        salaId: sala.id,
        membroId: membro.id,
        jogadorId: membro.jogadorId,
        ordemDeEntrada: membro.ordemDeEntrada,
      },
    ],
  );
}

export const admitirMembro = entrarNaSala;

export function sairDaSala(
  estado: EstadoDoLobby,
  comando: SairDaSalaComando,
): Resultado {
  const dadosInvalidos = validarTexto(
    comando.salaId,
    comando.jogadorId,
    ...(comando.membroId === undefined ? [] : [comando.membroId]),
  );
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const sala = estado.salas.find((item) => item.id === comando.salaId);
  if (!sala) {
    return rejeitar('SALA_NAO_ENCONTRADA', 'A Sala não foi encontrada.', {
      salaId: comando.salaId,
    });
  }

  const membro = sala.membros.find(
    (item) =>
      item.estado === 'ativo' &&
      item.jogadorId === comando.jogadorId &&
      (comando.membroId === undefined || item.id === comando.membroId),
  );
  if (!membro) {
    const membroDoJogador = sala.membros.find(
      (item) => item.jogadorId === comando.jogadorId,
    );
    const membroAtivoComOutroId = membroDoJogador?.estado === 'ativo';
    const codigo = membroAtivoComOutroId || !membroDoJogador
      ? 'MEMBRO_NAO_ENCONTRADO'
      : 'MEMBRO_NAO_ATIVO';
    const mensagem = membroAtivoComOutroId || !membroDoJogador
      ? 'O Membro não pertence à Sala.'
      : 'O vínculo do Membro já está encerrado.';
    return rejeitar(
      codigo,
      mensagem,
      {
        salaId: sala.id,
        jogadorId: comando.jogadorId,
        ...(comando.membroId ? { membroId: comando.membroId } : {}),
      },
    );
  }

  const membroEncerrado: Membro = {
    ...membro,
    estado: 'encerrado',
    motivoEncerramento: 'saida',
  };
  const membros = sala.membros.map((item) =>
    item.id === membro.id ? membroEncerrado : item,
  );
  const aindaHaMembrosAtivos = membros.some((item) => item.estado === 'ativo');
  const anfitriaoSaiu = sala.anfitriaoId === membro.id;
  const anfitriaoNovoId = aindaHaMembrosAtivos
    ? (anfitriaoSaiu ? sucederAnfitriao(membros, membro) : sala.anfitriaoId)
    : null;
  const novaSala: Sala = {
    ...sala,
    membros,
    estado: aindaHaMembrosAtivos ? sala.estado : 'encerrada',
    anfitriaoId: anfitriaoNovoId,
  };

  const eventos: EventoDeDominio[] = [
    {
      tipo: 'membro_saiu',
      salaId: sala.id,
      membroId: membro.id,
      jogadorId: membro.jogadorId,
      ordemDeEntrada: membro.ordemDeEntrada,
      motivo: 'saida',
    },
  ];
  if (anfitriaoSaiu && anfitriaoNovoId !== null) {
    eventos.push({
      tipo: 'anfitriao_sucedido',
      salaId: sala.id,
      anfitriaoAnteriorId: membro.id,
      anfitriaoNovoId,
    });
  }
  if (!aindaHaMembrosAtivos) {
    eventos.push({ tipo: 'sala_encerrada', salaId: sala.id, motivo: 'saida' });
  }

  return sucesso(substituirSala(estado, novaSala), eventos);
}

export function expulsarMembro(
  estado: EstadoDoLobby,
  comando: ExpulsarMembroComando,
): Resultado {
  const dadosInvalidos = validarTexto(
    comando.salaId,
    comando.anfitriaoMembroId,
    comando.membroAlvoId,
  );
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const contexto = exigirAnfitriaoAtual(
    estado,
    comando.salaId,
    comando.anfitriaoMembroId,
    'expulsar Membros',
  );
  if (!('sala' in contexto)) {
    return contexto;
  }
  const { sala, anfitriao } = contexto;

  const alvo = sala.membros.find((item) => item.id === comando.membroAlvoId);
  if (!alvo || alvo.estado !== 'ativo') {
    return rejeitar(
      alvo ? 'MEMBRO_NAO_ATIVO' : 'MEMBRO_NAO_ENCONTRADO',
      alvo ? 'O vínculo do Membro já está encerrado.' : 'O Membro não pertence à Sala.',
      { salaId: sala.id, membroId: comando.membroAlvoId },
    );
  }

  if (alvo.id === anfitriao.id) {
    return rejeitar(
      'APENAS_ANFITRIAO',
      'O Anfitrião não pode expulsar a si mesmo; ele deve sair da Sala.',
      { salaId: sala.id, membroId: alvo.id },
    );
  }

  const alvoEncerrado: Membro = {
    ...alvo,
    estado: 'encerrado',
    motivoEncerramento: 'expulsao',
  };
  const novaSala: Sala = {
    ...sala,
    membros: sala.membros.map((item) =>
      item.id === alvo.id ? alvoEncerrado : item,
    ),
    jogadoresBloqueados: [...sala.jogadoresBloqueados, alvo.jogadorId],
  };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'membro_expulsado',
      salaId: sala.id,
      membroId: alvo.id,
      jogadorId: alvo.jogadorId,
      ordemDeEntrada: alvo.ordemDeEntrada,
      motivo: 'expulsao',
    },
  ]);
}

export function autorizarRetorno(
  estado: EstadoDoLobby,
  comando: AutorizarRetornoComando,
): Resultado {
  const dadosInvalidos = validarTexto(
    comando.salaId,
    comando.anfitriaoMembroId,
    comando.jogadorId,
  );
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const contexto = exigirAnfitriaoAtual(
    estado,
    comando.salaId,
    comando.anfitriaoMembroId,
    'autorizar o retorno de Jogadores expulsos',
  );
  if (!('sala' in contexto)) {
    return contexto;
  }
  const { sala } = contexto;

  if (!sala.jogadoresBloqueados.includes(comando.jogadorId)) {
    return rejeitar(
      'JOGADOR_NAO_BLOQUEADO',
      'O Jogador não está bloqueado nesta Sala.',
      { salaId: sala.id, jogadorId: comando.jogadorId },
    );
  }

  const novaSala: Sala = {
    ...sala,
    jogadoresBloqueados: sala.jogadoresBloqueados.filter(
      (jogadorId) => jogadorId !== comando.jogadorId,
    ),
  };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'retorno_autorizado',
      salaId: sala.id,
      jogadorId: comando.jogadorId,
    },
  ]);
}

function membroAtivo(id: string, jogadorId: string, ordemDeEntrada: number): Membro {
  return {
    id,
    jogadorId,
    ordemDeEntrada,
    estado: 'ativo',
    motivoEncerramento: null,
  };
}

function exigirAnfitriaoAtual(
  estado: EstadoDoLobby,
  salaId: string,
  anfitriaoMembroId: string,
  acao: string,
): { sala: Sala; anfitriao: Membro } | OperacaoRejeitada {
  const sala = estado.salas.find((item) => item.id === salaId);
  if (!sala) {
    return rejeitar('SALA_NAO_ENCONTRADA', 'A Sala não foi encontrada.', {
      salaId,
    });
  }

  const anfitriao = sala.membros.find(
    (item) => item.id === anfitriaoMembroId && item.estado === 'ativo',
  );
  if (!anfitriao || sala.anfitriaoId !== anfitriaoMembroId) {
    return rejeitar(
      'APENAS_ANFITRIAO',
      `Apenas o Anfitrião atual da Sala pode ${acao}.`,
      { salaId: sala.id, membroId: anfitriaoMembroId },
    );
  }

  return { sala, anfitriao };
}

function sucederAnfitriao(
  membros: readonly Membro[],
  anfitriaoSaido: Membro,
): string | null {
  const ativos = membros.filter((item) => item.estado === 'ativo');
  if (ativos.length === 0) {
    return null;
  }
  const porOrdem = [...ativos].sort(
    (a, b) => a.ordemDeEntrada - b.ordemDeEntrada,
  );
  const sucessor =
    porOrdem.find((item) => item.ordemDeEntrada > anfitriaoSaido.ordemDeEntrada) ??
    porOrdem[0];
  return sucessor.id;
}

function encontrarMembro(estado: EstadoDoLobby, membroId: string): Membro | undefined {
  for (const sala of estado.salas) {
    const membro = sala.membros.find((item) => item.id === membroId);
    if (membro) {
      return membro;
    }
  }
  return undefined;
}

function encontrarAssociacaoAtiva(
  estado: EstadoDoLobby,
  jogadorId: string,
): { salaId: string; membro: Membro } | undefined {
  for (const sala of estado.salas) {
    const membro = sala.membros.find(
      (item) => item.estado === 'ativo' && item.jogadorId === jogadorId,
    );
    if (membro) {
      return { salaId: sala.id, membro };
    }
  }
  return undefined;
}

function substituirSala(estado: EstadoDoLobby, salaAtualizada: Sala): EstadoDoLobby {
  return {
    salas: estado.salas.map((sala) =>
      sala.id === salaAtualizada.id ? salaAtualizada : sala,
    ),
  };
}

function validarTexto(...valores: readonly string[]): OperacaoRejeitada | undefined {
  if (valores.every((valor) => typeof valor === 'string' && valor.trim().length > 0)) {
    return undefined;
  }
  return rejeitar('DADOS_INVALIDOS', 'Os identificadores e o Código de Sala são obrigatórios.');
}

function sucesso(estado: EstadoDoLobby, eventos: readonly EventoDeDominio[]): OperacaoBemSucedida {
  return { sucesso: true, estado, eventos };
}

function rejeitar(
  codigo: CodigoDeErro,
  mensagem: string,
  detalhes: Omit<ErroDeDominio, 'tipo' | 'codigo' | 'mensagem'> = {},
): OperacaoRejeitada {
  return {
    sucesso: false,
    erro: { tipo: 'erro_de_dominio', codigo, mensagem, ...detalhes },
  };
}
