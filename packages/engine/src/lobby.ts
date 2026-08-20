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

export type Comando =
  | CriarSalaComando
  | EntrarNaSalaComando
  | SairDaSalaComando;

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

export type EventoDeDominio =
  | SalaCriadaEvento
  | MembroAdmitidoEvento
  | MembroSaiuEvento
  | SalaEncerradaEvento;

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
  | 'MEMBRO_NAO_ATIVO';

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
  const novaSala: Sala = {
    ...sala,
    membros,
    estado: aindaHaMembrosAtivos ? sala.estado : 'encerrada',
    anfitriaoId: aindaHaMembrosAtivos && sala.anfitriaoId !== membro.id
      ? sala.anfitriaoId
      : null,
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
  if (!aindaHaMembrosAtivos) {
    eventos.push({ tipo: 'sala_encerrada', salaId: sala.id, motivo: 'saida' });
  }

  return sucesso(substituirSala(estado, novaSala), eventos);
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
