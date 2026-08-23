export type EstadoDaSala = 'aberta' | 'encaminhada' | 'encerrada' | 'expirada';
export type EstadoDoVinculo = 'ativo' | 'encerrado';
export type Presenca = 'conectado' | 'em_reconexao';

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
  readonly presenca: Presenca;
  readonly pronto: boolean;
}

export interface Sala {
  readonly id: string;
  readonly codigo: string;
  readonly estado: EstadoDaSala;
  readonly membros: readonly Membro[];
  readonly proximaOrdemDeEntrada: number;
  readonly anfitriaoId: string | null;
  readonly jogadoresBloqueados: readonly string[];
  // Projeção reconstruída pós-reinício (ADR-0002); mutações bloqueadas até
  // a consistência ser confirmada.
  readonly consistente: boolean;
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

export interface DesconectarJogadorComando {
  readonly tipo: 'desconectar_jogador';
  readonly salaId: string;
  readonly jogadorId: string;
}

export interface ReconectarJogadorComando {
  readonly tipo: 'reconectar_jogador';
  readonly salaId: string;
  readonly jogadorId: string;
}

export interface ExpirarReconexaoComando {
  readonly tipo: 'expirar_reconexao';
  readonly salaId: string;
  readonly membroId: string;
}

export interface ConfirmarConsistenciaDaSalaComando {
  readonly tipo: 'confirmar_consistencia_da_sala';
  readonly salaId: string;
}

export interface RegistrarReinicioDaSalaComando {
  readonly tipo: 'registrar_reinicio_da_sala';
  readonly salaId: string;
}

export interface AlternarProntidaoComando {
  readonly tipo: 'alternar_prontidao';
  readonly salaId: string;
  readonly jogadorId: string;
}

export interface EncaminharSalaComando {
  readonly tipo: 'encaminhar_sala';
  readonly salaId: string;
  readonly anfitriaoMembroId: string;
}

export interface AceitarEncaminhamentoComando {
  readonly tipo: 'aceitar_encaminhamento';
  readonly salaId: string;
}

export interface RecusarEncaminhamentoComando {
  readonly tipo: 'recusar_encaminhamento';
  readonly salaId: string;
}

export interface RegistrarFalhaDoEncaminhamentoComando {
  readonly tipo: 'registrar_falha_do_encaminhamento';
  readonly salaId: string;
}

export interface EncerrarSalaComando {
  readonly tipo: 'encerrar_sala';
  readonly salaId: string;
  readonly anfitriaoMembroId: string;
}

export type Comando =
  | CriarSalaComando
  | EntrarNaSalaComando
  | SairDaSalaComando
  | ExpulsarMembroComando
  | AutorizarRetornoComando
  | DesconectarJogadorComando
  | ReconectarJogadorComando
  | ExpirarReconexaoComando
  | ConfirmarConsistenciaDaSalaComando
  | RegistrarReinicioDaSalaComando
  | AlternarProntidaoComando
  | EncaminharSalaComando
  | AceitarEncaminhamentoComando
  | RecusarEncaminhamentoComando
  | RegistrarFalhaDoEncaminhamentoComando
  | EncerrarSalaComando;

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
  readonly motivo: 'saida' | 'encerramento';
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

// Campos compartilhados pelos eventos que observam um vínculo específico
// entre Jogador e Sala.
export interface EventoDeVinculo {
  readonly salaId: string;
  readonly membroId: string;
  readonly jogadorId: string;
  readonly ordemDeEntrada: number;
}

export interface MembroDesconectadoEvento extends EventoDeVinculo {
  readonly tipo: 'membro_desconectado';
}

export interface MembroReconectadoEvento extends EventoDeVinculo {
  readonly tipo: 'membro_reconectado';
}

export interface VinculoExpiradoEvento extends EventoDeVinculo {
  readonly tipo: 'vinculo_expirado';
}

export interface SalaExpiradaEvento {
  readonly tipo: 'sala_expirada';
  readonly salaId: string;
}

export interface ConsistenciaConfirmadaEvento {
  readonly tipo: 'consistencia_confirmada';
  readonly salaId: string;
}

export interface ReinicioRegistradoEvento {
  readonly tipo: 'reinicio_registrado';
  readonly salaId: string;
}

export interface ProntidaoAlteradaEvento extends EventoDeVinculo {
  readonly tipo: 'prontidao_alterada';
  readonly pronto: boolean;
}

export interface EncaminhamentoIniciadoEvento {
  readonly tipo: 'encaminhamento_iniciado';
  readonly salaId: string;
}

export interface SalaEncaminhadaEvento {
  readonly tipo: 'sala_encaminhada';
  readonly salaId: string;
}

export interface EncaminhamentoRecusadoEvento {
  readonly tipo: 'encaminhamento_recusado';
  readonly salaId: string;
}

export interface EncaminhamentoFalhouEvento {
  readonly tipo: 'encaminhamento_falhou';
  readonly salaId: string;
}

export type EventoDeDominio =
  | SalaCriadaEvento
  | MembroAdmitidoEvento
  | MembroSaiuEvento
  | SalaEncerradaEvento
  | MembroExpulsoEvento
  | AnfitriaoSucedidoEvento
  | RetornoAutorizadoEvento
  | MembroDesconectadoEvento
  | MembroReconectadoEvento
  | VinculoExpiradoEvento
  | SalaExpiradaEvento
  | ConsistenciaConfirmadaEvento
  | ReinicioRegistradoEvento
  | ProntidaoAlteradaEvento
  | EncaminhamentoIniciadoEvento
  | SalaEncaminhadaEvento
  | EncaminhamentoRecusadoEvento
  | EncaminhamentoFalhouEvento;

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
  | 'MEMBRO_NAO_EM_RECONEXAO'
  | 'APENAS_ANFITRIAO'
  | 'JOGADOR_EXPULSO'
  | 'JOGADOR_NAO_BLOQUEADO'
  | 'SALA_INCONSISTENTE'
  | 'SALA_ENCAMINHADA'
  | 'ENCAMINHAMENTO_INVALIDO';

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
    case 'desconectar_jogador':
      return desconectarJogador(estado, comando);
    case 'reconectar_jogador':
      return reconectarJogador(estado, comando);
    case 'expirar_reconexao':
      return expirarReconexao(estado, comando);
    case 'confirmar_consistencia_da_sala':
      return confirmarConsistenciaDaSala(estado, comando);
    case 'registrar_reinicio_da_sala':
      return registrarReinicioDaSala(estado, comando);
    case 'alternar_prontidao':
      return alternarProntidao(estado, comando);
    case 'encaminhar_sala':
      return encaminharSala(estado, comando);
    case 'aceitar_encaminhamento':
      return aceitarEncaminhamento(estado, comando);
    case 'recusar_encaminhamento':
      return recusarEncaminhamento(estado, comando);
    case 'registrar_falha_do_encaminhamento':
      return registrarFalhaDoEncaminhamento(estado, comando);
    case 'encerrar_sala':
      return encerrarSala(estado, comando);
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
    consistente: true,
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
  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  const dadosInvalidos = validarTexto(
    comando.salaId,
    comando.membroId,
    comando.jogadorId,
  );
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
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

  const salaIndisponivel = exigirSalaAberta(sala);
  if (salaIndisponivel) {
    return salaIndisponivel;
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

  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaCongelada = exigirSalaNaoEncaminhada(sala);
  if (salaCongelada) {
    return salaCongelada;
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

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaCongelada = exigirSalaNaoEncaminhada(sala);
  if (salaCongelada) {
    return salaCongelada;
  }

  const contextoDoAlvo = exigirMembroAtivo(sala, { membroId: comando.membroAlvoId });
  if (!('membro' in contextoDoAlvo)) {
    return contextoDoAlvo;
  }
  const alvo = contextoDoAlvo.membro;

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

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaCongelada = exigirSalaNaoEncaminhada(sala);
  if (salaCongelada) {
    return salaCongelada;
  }

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

export function desconectarJogador(
  estado: EstadoDoLobby,
  comando: DesconectarJogadorComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId, comando.jogadorId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaCongelada = exigirSalaNaoEncaminhada(sala);
  if (salaCongelada) {
    return salaCongelada;
  }

  const contexto = exigirMembroAtivo(sala, { jogadorId: comando.jogadorId });
  if (!('membro' in contexto)) {
    return contexto;
  }
  const { membro } = contexto;

  if (membro.presenca === 'em_reconexao') {
    return sucesso(estado, []);
  }

  const novaSala: Sala = {
    ...sala,
    membros: sala.membros.map((item) =>
      item.id === membro.id
        ? { ...item, presenca: 'em_reconexao' as const }
        : item,
    ),
  };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'membro_desconectado',
      salaId: sala.id,
      membroId: membro.id,
      jogadorId: membro.jogadorId,
      ordemDeEntrada: membro.ordemDeEntrada,
    },
  ]);
}

export function reconectarJogador(
  estado: EstadoDoLobby,
  comando: ReconectarJogadorComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId, comando.jogadorId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaCongelada = exigirSalaNaoEncaminhada(sala);
  if (salaCongelada) {
    return salaCongelada;
  }

  const contexto = exigirMembroAtivo(sala, { jogadorId: comando.jogadorId });
  if (!('membro' in contexto)) {
    return contexto;
  }
  const { membro } = contexto;

  if (membro.presenca === 'conectado') {
    return sucesso(estado, []);
  }

  const novaSala: Sala = {
    ...sala,
    membros: sala.membros.map((item) =>
      item.id === membro.id
        ? { ...item, presenca: 'conectado' as const }
        : item,
    ),
  };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'membro_reconectado',
      salaId: sala.id,
      membroId: membro.id,
      jogadorId: membro.jogadorId,
      ordemDeEntrada: membro.ordemDeEntrada,
    },
  ]);
}

export function expirarReconexao(
  estado: EstadoDoLobby,
  comando: ExpirarReconexaoComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId, comando.membroId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaCongelada = exigirSalaNaoEncaminhada(sala);
  if (salaCongelada) {
    return salaCongelada;
  }

  const contexto = exigirMembroAtivo(sala, { membroId: comando.membroId });
  if (!('membro' in contexto)) {
    return contexto;
  }
  const { membro } = contexto;

  if (membro.presenca !== 'em_reconexao') {
    return rejeitar(
      'MEMBRO_NAO_EM_RECONEXAO',
      'O Membro não está em janela de reconexão.',
      { salaId: sala.id, membroId: comando.membroId },
    );
  }

  // O reset de presenca/pronto no vínculo encerrado é deliberado: um vínculo
  // encerrado não tem presença — preservar 'em_reconexao' implicaria uma
  // janela de reconexão ainda aberta num tipo de dois valores
  // (conectado | em_reconexao).
  const membros = sala.membros.map((item) =>
    item.id === membro.id
      ? {
          ...item,
          estado: 'encerrado' as const,
          motivoEncerramento: 'expiracao' as const,
          presenca: 'conectado' as const,
          pronto: false,
        }
      : item,
  );
  const aindaHaMembrosAtivos = membros.some((item) => item.estado === 'ativo');
  const anfitriaoExpirou = sala.anfitriaoId === membro.id;
  const anfitriaoNovoId = aindaHaMembrosAtivos
    ? (anfitriaoExpirou ? sucederAnfitriao(membros, membro) : sala.anfitriaoId)
    : null;
  const novaSala: Sala = {
    ...sala,
    membros,
    estado: aindaHaMembrosAtivos ? sala.estado : 'expirada',
    anfitriaoId: anfitriaoNovoId,
  };

  const eventos: EventoDeDominio[] = [
    {
      tipo: 'vinculo_expirado',
      salaId: sala.id,
      membroId: membro.id,
      jogadorId: membro.jogadorId,
      ordemDeEntrada: membro.ordemDeEntrada,
    },
  ];
  if (anfitriaoExpirou && anfitriaoNovoId !== null) {
    eventos.push({
      tipo: 'anfitriao_sucedido',
      salaId: sala.id,
      anfitriaoAnteriorId: membro.id,
      anfitriaoNovoId,
    });
  }
  if (!aindaHaMembrosAtivos) {
    eventos.push({ tipo: 'sala_expirada', salaId: sala.id });
  }

  return sucesso(substituirSala(estado, novaSala), eventos);
}

export function confirmarConsistenciaDaSala(
  estado: EstadoDoLobby,
  comando: ConfirmarConsistenciaDaSalaComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  if (sala.consistente) {
    return sucesso(estado, []);
  }

  const novaSala: Sala = { ...sala, consistente: true };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'consistencia_confirmada',
      salaId: sala.id,
    },
  ]);
}

export function registrarReinicioDaSala(
  estado: EstadoDoLobby,
  comando: RegistrarReinicioDaSalaComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaOuErro = exigirSala(estado, comando.salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  if (!sala.consistente) {
    return sucesso(estado, []);
  }

  // O reinício do servidor é tratado como uma desconexão em massa: todos os
  // membros ativos entram na janela de reconexão — a Presença é binária
  // (conectado | em_reconexao), então eles reaparecem desconectados e não
  // prontos, conforme o ADR-0002 ("membros reaparecem desconectados e não
  // prontos"). A Sala fica inconsistente até a projeção ser reconstruída e
  // confirmada; por isso este comando NÃO passa pelo gate de consistência.
  const novaSala: Sala = {
    ...sala,
    consistente: false,
    membros: sala.membros.map((membro) =>
      membro.estado === 'ativo'
        ? { ...membro, presenca: 'em_reconexao', pronto: false }
        : membro,
    ),
  };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'reinicio_registrado',
      salaId: sala.id,
    },
  ]);
}

export function alternarProntidao(
  estado: EstadoDoLobby,
  comando: AlternarProntidaoComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId, comando.jogadorId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const salaContexto = exigirSalaAbertaPorId(estado, comando.salaId);
  if (!('sala' in salaContexto)) {
    return salaContexto;
  }
  const { sala } = salaContexto;

  const contexto = exigirMembroAtivo(sala, { jogadorId: comando.jogadorId });
  if (!('membro' in contexto)) {
    return contexto;
  }
  const { membro } = contexto;

  // Prontidão é declaração do Jogador; Presença é conectividade. Por isso o
  // membro em janela de reconexão pode alternar a prontidão — a exigência de
  // presença 'conectado' vive apenas no encaminhamento da Sala.
  const pronto = !membro.pronto;
  const novaSala: Sala = {
    ...sala,
    membros: sala.membros.map((item) =>
      item.id === membro.id ? { ...item, pronto } : item,
    ),
  };

  return sucesso(substituirSala(estado, novaSala), [
    {
      tipo: 'prontidao_alterada',
      salaId: sala.id,
      membroId: membro.id,
      jogadorId: membro.jogadorId,
      ordemDeEntrada: membro.ordemDeEntrada,
      pronto,
    },
  ]);
}

export function encaminharSala(
  estado: EstadoDoLobby,
  comando: EncaminharSalaComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId, comando.anfitriaoMembroId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const contexto = exigirAnfitriaoEmSalaAberta(
    estado,
    comando.salaId,
    comando.anfitriaoMembroId,
    'encaminhar a Sala à Partida',
  );
  if (!('sala' in contexto)) {
    return contexto;
  }
  const { sala } = contexto;

  const composicaoInvalida = validarComposicaoParaEncaminhamento(sala);
  if (composicaoInvalida) {
    return composicaoInvalida;
  }

  // A oferta não congela a Sala: o estado permanece 'aberta' e mutável
  // durante a negociação com o game-server. O congelamento acontece apenas
  // no aceite (aceitarEncaminhamento).
  return sucesso(estado, [
    { tipo: 'encaminhamento_iniciado', salaId: sala.id },
  ]);
}

export function aceitarEncaminhamento(
  estado: EstadoDoLobby,
  comando: AceitarEncaminhamentoComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const contexto = exigirSalaAbertaPorId(estado, comando.salaId);
  if (!('sala' in contexto)) {
    return contexto;
  }
  const { sala } = contexto;

  // Revalidação no commit (ADR-0003): a composição pode ter mudado entre a
  // oferta e o aceite — a Sala permanece 'aberta' e a aplicação cancela a
  // partida em andamento (fora do engine).
  const composicaoInvalida = validarComposicaoParaEncaminhamento(sala);
  if (composicaoInvalida) {
    return composicaoInvalida;
  }

  const novaSala: Sala = { ...sala, estado: 'encaminhada' };

  return sucesso(substituirSala(estado, novaSala), [
    { tipo: 'sala_encaminhada', salaId: sala.id },
  ]);
}

export function recusarEncaminhamento(
  estado: EstadoDoLobby,
  comando: RecusarEncaminhamentoComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  // A recusa (ou timeout) não afeta a Sala: ela permanece 'aberta', sem
  // perder membros nem congelar a composição.
  return registrarResultadoDoEncaminhamento(
    estado,
    comando.salaId,
    'encaminhamento_recusado',
  );
}

export function registrarFalhaDoEncaminhamento(
  estado: EstadoDoLobby,
  comando: RegistrarFalhaDoEncaminhamentoComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  // A falha de rede/erro não afeta a Sala: ela permanece 'aberta', sem
  // perder membros nem congelar a composição.
  return registrarResultadoDoEncaminhamento(
    estado,
    comando.salaId,
    'encaminhamento_falhou',
  );
}

export function encerrarSala(
  estado: EstadoDoLobby,
  comando: EncerrarSalaComando,
): Resultado {
  const dadosInvalidos = validarTexto(comando.salaId, comando.anfitriaoMembroId);
  if (dadosInvalidos) {
    return dadosInvalidos;
  }

  const contexto = exigirAnfitriaoEmSalaAberta(
    estado,
    comando.salaId,
    comando.anfitriaoMembroId,
    'encerrar a Sala',
  );
  if (!('sala' in contexto)) {
    return contexto;
  }
  const { sala } = contexto;

  // O reset de presenca/pronto no vínculo encerrado é deliberado: um vínculo
  // encerrado não tem presença — preservar 'em_reconexao' implicaria uma
  // janela de reconexão ainda aberta num tipo de dois valores
  // (conectado | em_reconexao).
  const membros = sala.membros.map((membro) =>
    membro.estado === 'ativo'
      ? {
          ...membro,
          estado: 'encerrado' as const,
          motivoEncerramento: 'encerramento' as const,
          presenca: 'conectado' as const,
          pronto: false,
        }
      : membro,
  );
  const novaSala: Sala = {
    ...sala,
    membros,
    estado: 'encerrada',
    anfitriaoId: null,
  };

  return sucesso(substituirSala(estado, novaSala), [
    { tipo: 'sala_encerrada', salaId: sala.id, motivo: 'encerramento' },
  ]);
}

function membroAtivo(id: string, jogadorId: string, ordemDeEntrada: number): Membro {
  return {
    id,
    jogadorId,
    ordemDeEntrada,
    estado: 'ativo',
    motivoEncerramento: null,
    presenca: 'conectado',
    pronto: false,
  };
}

function exigirSala(
  estado: EstadoDoLobby,
  salaId: string,
): { sala: Sala } | OperacaoRejeitada {
  const sala = estado.salas.find((item) => item.id === salaId);
  if (!sala) {
    return rejeitar('SALA_NAO_ENCONTRADA', 'A Sala não foi encontrada.', {
      salaId,
    });
  }
  return { sala };
}

function exigirSalaConsistente(
  sala: Sala,
): OperacaoRejeitada | undefined {
  if (sala.consistente) {
    return undefined;
  }
  return rejeitar(
    'SALA_INCONSISTENTE',
    'A Sala está inconsistente e não aceita mutações até a consistência ser confirmada.',
    { salaId: sala.id },
  );
}

function exigirSalaAbertaPorId(
  estado: EstadoDoLobby,
  salaId: string,
): { sala: Sala } | OperacaoRejeitada {
  const salaOuErro = exigirSala(estado, salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaIndisponivel = exigirSalaAberta(sala);
  if (salaIndisponivel) {
    return salaIndisponivel;
  }

  return { sala };
}

// Gate de congelamento: uma Sala encaminhada teve a composição congelada
// para o Encaminhamento à Partida — nenhuma mutação de vínculo ou participação é
// aceita.
function exigirSalaNaoEncaminhada(
  sala: Sala,
): OperacaoRejeitada | undefined {
  if (sala.estado !== 'encaminhada') {
    return undefined;
  }
  return rejeitar(
    'SALA_ENCAMINHADA',
    'A Sala está encaminhada e sua composição está congelada.',
    { salaId: sala.id },
  );
}

// Gate de estado das operações de prontidão/encaminhamento/encerramento:
// 'encaminhada' congela a composição e qualquer estado terminal rejeita a
// operação.
function exigirSalaAberta(
  sala: Sala,
): OperacaoRejeitada | undefined {
  const congelada = exigirSalaNaoEncaminhada(sala);
  if (congelada) {
    return congelada;
  }
  if (sala.estado !== 'aberta') {
    return rejeitar(
      'SALA_ENCERRADA',
      sala.estado === 'expirada'
        ? 'A Sala expirou.'
        : 'A Sala está encerrada.',
      { salaId: sala.id },
    );
  }
  return undefined;
}

// Condições de encaminhamento (ST-03): exatamente LIMITE_DE_MEMBROS vínculos
// ativos, todos conectados e prontos.
function validarComposicaoParaEncaminhamento(
  sala: Sala,
): OperacaoRejeitada | undefined {
  const ativos = sala.membros.filter((membro) => membro.estado === 'ativo');
  if (ativos.length !== LIMITE_DE_MEMBROS) {
    return rejeitar(
      'ENCAMINHAMENTO_INVALIDO',
      `O encaminhamento exige exatamente ${LIMITE_DE_MEMBROS} Membros ativos; a Sala possui ${ativos.length}.`,
      { salaId: sala.id },
    );
  }
  const emReconexao = ativos.find((membro) => membro.presenca !== 'conectado');
  if (emReconexao) {
    return rejeitar(
      'ENCAMINHAMENTO_INVALIDO',
      'O encaminhamento exige todos os Membros conectados; há Membro em janela de reconexão.',
      { salaId: sala.id, membroId: emReconexao.id },
    );
  }
  const naoPronto = ativos.find((membro) => !membro.pronto);
  if (naoPronto) {
    return rejeitar(
      'ENCAMINHAMENTO_INVALIDO',
      'O encaminhamento exige todos os Membros prontos.',
      { salaId: sala.id, membroId: naoPronto.id },
    );
  }
  return undefined;
}

// Localiza o vínculo ativo por chave (jogadorId ou membroId) e diferencia
// "vínculo encerrado" (MEMBRO_NAO_ATIVO) de "não pertence à Sala"
// (MEMBRO_NAO_ENCONTRADO).
function exigirMembroAtivo(
  sala: Sala,
  chave: { readonly jogadorId: string } | { readonly membroId: string },
): { membro: Membro } | OperacaoRejeitada {
  const corresponde = (item: Membro) =>
    'jogadorId' in chave
      ? item.jogadorId === chave.jogadorId
      : item.id === chave.membroId;

  const membro = sala.membros.find(
    (item) => item.estado === 'ativo' && corresponde(item),
  );
  if (membro) {
    return { membro };
  }

  const vinculo = sala.membros.find(corresponde);
  return rejeitar(
    vinculo ? 'MEMBRO_NAO_ATIVO' : 'MEMBRO_NAO_ENCONTRADO',
    vinculo
      ? 'O vínculo do Membro já está encerrado.'
      : 'O Membro não pertence à Sala.',
    'jogadorId' in chave
      ? { salaId: sala.id, jogadorId: chave.jogadorId }
      : { salaId: sala.id, membroId: chave.membroId },
  );
}

function exigirAnfitriaoAtual(
  estado: EstadoDoLobby,
  salaId: string,
  anfitriaoMembroId: string,
  acao: string,
): { sala: Sala; anfitriao: Membro } | OperacaoRejeitada {
  const salaOuErro = exigirSala(estado, salaId);
  if (!('sala' in salaOuErro)) {
    return salaOuErro;
  }
  const { sala } = salaOuErro;

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

function exigirAnfitriaoEmSalaAberta(
  estado: EstadoDoLobby,
  salaId: string,
  anfitriaoMembroId: string,
  acao: string,
): { sala: Sala; anfitriao: Membro } | OperacaoRejeitada {
  const contexto = exigirAnfitriaoAtual(
    estado,
    salaId,
    anfitriaoMembroId,
    acao,
  );
  if (!('sala' in contexto)) {
    return contexto;
  }
  const { sala } = contexto;

  const salaInconsistente = exigirSalaConsistente(sala);
  if (salaInconsistente) {
    return salaInconsistente;
  }

  const salaIndisponivel = exigirSalaAberta(sala);
  if (salaIndisponivel) {
    return salaIndisponivel;
  }

  return contexto;
}

function registrarResultadoDoEncaminhamento(
  estado: EstadoDoLobby,
  salaId: string,
  tipo: 'encaminhamento_recusado' | 'encaminhamento_falhou',
): Resultado {
  const contexto = exigirSalaAbertaPorId(estado, salaId);
  if (!('sala' in contexto)) {
    return contexto;
  }

  return sucesso(estado, [{ tipo, salaId: contexto.sala.id }]);
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
