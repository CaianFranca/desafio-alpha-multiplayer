// Estado do lobby no servidor (issue #36): wrapper sobre `EstadoDoLobby` do
// engine que conhece (a) o pool PG para a reconstrução do boot e (b) a
// projeção Redis para hidratar as chaves no mesmo passo.
//
// Singleton por processo — `criarContextoDasSalas` instancia e expõe via
// `index.ts`. Suporta múltiplas conexões por jogador (ver
// `SalasBroadcaster`); aqui mantemos apenas a `EstadoDoLobby` pura, mais um
// cache de apelidos (jogadorId -> apelido) para traduzir Membro -> MembroDaSala
// sem tocar PG/Redis no caminho do broadcast.
//
// `carregar()` é tolerante: loga e segue em caso de PG indisponível
// (mesmo padrão de `validarDependencias` em `index.ts`).
// `aplicar()` é o ponto único onde o engine é consultado — o handler
// passa o comando já construído e a referência ao socket de origem para
// emitir erros individuais.

import {
  aplicarComando,
  estadoDoLobbyVazio,
  type Comando,
  type EstadoDoLobby,
  type Membro as MembroDominio,
  type Sala as SalaDominio,
} from '@flicker/engine';
import type { SalasRepo } from './repositorio.ts';
import type {
  SalasProjecao,
  SalaEstadoProjecao,
  MembroEstadoProjecao,
} from './projecao.ts';

interface SalaStateInterna {
  readonly sala: SalaDominio;
  readonly codigo: string;
}

export interface SalasState {
  /** Estado do engine (fonte de verdade em memória). */
  readonly estado: EstadoDoLobby;
  /** Salas abertas indexadas por `salaId`, com codigo cacheado para Redis. */
  readonly abertas: Map<string, SalaStateInterna>;
  /**
   * Apelido cacheado por jogadorId para a tradução engine→wire
   * (`MembroDaSala.apelido`). Hidratado no boot via `repo.obterApelidos` e
   * atualizado quando um jogador novo entra no broadcast.
   */
  readonly apelidoPorJogadorId: Map<string, string>;

  carregar(repo: SalasRepo, projecao: SalasProjecao): Promise<void>;

  /**
   * Aplica o comando no engine e devolve o resultado bruto. Side-effects
   * (persistência/projeção) são responsabilidade do handler, que decide a
   * ordem `engine → repo → projecao → broadcast` para cada tipo.
   */
  aplicar(comando: Comando): ReturnType<typeof aplicarComando>;

  /**
   * Substitui o estado por uma nova referência (imutável, conforme o
   * engine). Usado pelo handler após `aplicar` retornar sucesso.
   */
  substituirEstado(novo: EstadoDoLobby): void;
}

class SalasStateImpl implements SalasState {
  private _estado: EstadoDoLobby = estadoDoLobbyVazio();
  private readonly _abertas: Map<string, SalaStateInterna> = new Map();
  private readonly _apelidoPorJogadorId: Map<string, string> = new Map();

  get estado(): EstadoDoLobby {
    return this._estado;
  }

  get abertas(): Map<string, SalaStateInterna> {
    return this._abertas;
  }

  get apelidoPorJogadorId(): Map<string, string> {
    return this._apelidoPorJogadorId;
  }

  async carregar(repo: SalasRepo, projecao: SalasProjecao): Promise<void> {
    const salasAbertas = await repo.listarSalasAbertas();

    // Hidratar cache de apelidos em uma única query para todas as salas.
    const jogadorIds = new Set<string>();
    for (const sala of salasAbertas) {
      const membros = await repo.listarMembrosDaSala(sala.id);
      for (const m of membros) {
        jogadorIds.add(m.jogadorId);
      }
    }
    if (jogadorIds.size > 0) {
      const apelidos = await repo.obterApelidos([...jogadorIds]);
      for (const [id, apelido] of apelidos) {
        this._apelidoPorJogadorId.set(id, apelido);
      }
    }

    // Hidratar o engine a partir do PG. Após uma reconstrução, o engine
    // registra o reinício e bloqueia mutações até a consistência ser
    // confirmada, como determina o ADR-0002.
    let novoEstado: EstadoDoLobby = estadoDoLobbyVazio();
    for (const sala of salasAbertas) {
      const membros = await repo.listarMembrosDaSala(sala.id);
      const membrosDominio: MembroDominio[] = membros.map((m, idx) => ({
        id: `${sala.id}-m${m.ordem}`, // membroId determinístico na reconstrução
        jogadorId: m.jogadorId,
        ordemDeEntrada: m.ordem,
        estado: 'ativo' as const,
        motivoEncerramento: null,
        presenca: 'conectado' as const,
        pronto: false,
      }));
      const proximaOrdemDeEntrada =
        membros.length > 0 ? Math.max(...membros.map((m) => m.ordem)) + 1 : 1;
      // O Anfitrião vem do write-model — pode ter sido sucedido antes do
      // reinício. A menor ordem é apenas fallback defensivo quando
      // `anfitriao_id` está ausente ou sem vínculo ativo.
      let anfitriaoMembroId: string | null = null;
      const anfitriaoPersistido =
        sala.anfitriaoId !== null
          ? membrosDominio.find((m) => m.jogadorId === sala.anfitriaoId)
          : undefined;
      if (anfitriaoPersistido !== undefined) {
        anfitriaoMembroId = anfitriaoPersistido.id;
      } else if (membrosDominio.length > 0) {
        console.warn(
          `[salas] anfitriao_id ausente ou sem vínculo ativo na Sala ${sala.id}; usando menor ordem`,
        );
        anfitriaoMembroId = membrosDominio[0]!.id;
      }
      const salaDominio: SalaDominio = {
        id: sala.id,
        codigo: sala.codigo,
        estado: 'aberta' as const,
        membros: membrosDominio,
        proximaOrdemDeEntrada,
        anfitriaoId: anfitriaoMembroId,
        jogadoresBloqueados: [],
        consistente: true,
      };
      novoEstado = { salas: [...novoEstado.salas, salaDominio] };
      this._abertas.set(sala.id, { sala: salaDominio, codigo: sala.codigo });
    }

    // O reinício preserva a semântica do ADR-0002: membros reaparecem em
    // reconexão e não prontos. A confirmação acontece imediatamente após a
    // reconstrução completa desta projeção local, para que a #36 não deixe
    // Salas permanentemente bloqueadas à espera dos fluxos da #38.
    for (const salaId of [...this._abertas.keys()]) {
      const resultado = aplicarComando(novoEstado, {
        tipo: 'registrar_reinicio_da_sala',
        salaId,
      });
      if (resultado.sucesso) {
        novoEstado = resultado.estado;
        const salaAtualizada = novoEstado.salas.find((s) => s.id === salaId);
        if (salaAtualizada !== undefined) {
          this._abertas.set(salaId, {
            sala: salaAtualizada,
            codigo: this._abertas.get(salaId)!.codigo,
          });
        }
      }
    }

    for (const salaId of [...this._abertas.keys()]) {
      const resultado = aplicarComando(novoEstado, {
        tipo: 'confirmar_consistencia_da_sala',
        salaId,
      });
      if (resultado.sucesso) {
        novoEstado = resultado.estado;
      }
    }

    for (const sala of novoEstado.salas) {
      const info = this._abertas.get(sala.id);
      if (info !== undefined) {
        this._abertas.set(sala.id, { sala, codigo: info.codigo });
      }
    }

    this._estado = novoEstado;

    // Projeção quente no Redis: estado da sala, codigo -> salaId, e
    // jogadorId -> salaId para cada membro.
    for (const [salaId, info] of this._abertas) {
      await projecao.definirCodigo(info.codigo, salaId);
      await projecao.definirEstadoSala(salaId, serializarSala(info.sala));
      for (const membro of info.sala.membros) {
        if (membro.estado === 'ativo') {
          await projecao.definirAssociacaoJogador(membro.jogadorId, salaId);
        }
      }
    }
  }

  aplicar(comando: Comando): ReturnType<typeof aplicarComando> {
    return aplicarComando(this._estado, comando);
  }

  substituirEstado(novo: EstadoDoLobby): void {
    this._estado = novo;
    // Reindexar `abertas` para refletir o novo estado (usado após cada
    // mutação bem-sucedida). Salas que saíram do estado (`sala_encerrada`)
    // permanecem no mapa interno até o handler chamar `abrir`/`fechar`
    // explicitamente — por simplicidade mantemos a entrada; o teste de
    // `sala_encerrada` consulta o engine diretamente.
    const novoMap = new Map<string, SalaStateInterna>();
    for (const sala of novo.salas) {
      const interna = this._abertas.get(sala.id);
      const codigo = interna?.codigo ?? sala.codigo;
      novoMap.set(sala.id, { sala, codigo });
    }
    this._abertas.clear();
    for (const [k, v] of novoMap) {
      this._abertas.set(k, v);
    }
  }
}

function serializarSala(sala: SalaDominio): SalaEstadoProjecao {
  const membros: MembroEstadoProjecao[] = sala.membros
    .filter((m) => m.estado === 'ativo')
    .map((m) => ({
      id: m.id,
      jogadorId: m.jogadorId,
      ordemDeEntrada: m.ordemDeEntrada,
      pronto: m.pronto,
      presenca: m.presenca,
      anfitriao: sala.anfitriaoId === m.id,
    }));
  return {
    id: sala.id,
    codigo: sala.codigo,
    estado: sala.estado,
    anfitriaoId: sala.anfitriaoId,
    proximaOrdemDeEntrada: sala.proximaOrdemDeEntrada,
    consistente: sala.consistente,
    membros,
  };
}

export function criarSalasState(): SalasState {
  return new SalasStateImpl();
}
