/**
 * Coletor global de depuração (issue #340, "Modo Desenvolvedor").
 *
 * Singleton framework-agnostic instalado em `main.tsx` ANTES de qualquer
 * render: hijackia `console.log/warn/error`, captura `window.onerror` e
 * `unhandledrejection`, e expõe `coletar` para as fontes instrumentadas
 * (boundaries, tráfego WS, linhas espelhadas do backend). Tudo deságua num
 * buffer anelado (~500 entradas, descarta as mais antigas) com a fase
 * vigente estampada em cada entrada — os marcadores de fase são fundos
 * históricos: cada linha guarda o fundo do instante em que foi registrada.
 *
 * Estado do Modo Desenvolvedor também vive aqui (`ativarModo`/`estaModoAtivo`,
 * `desativarModo` — persistido em `sessionStorage`, o modo sobrevive a reload,
 * o histórico não, por spec). Os hooks de WS assinam `aoAtivarModo`/
 * `aoDesativarModo` para enviar `ATIVAR_DEBUG`/`DESATIVAR_DEBUG` nos sockets
 * já abertos no instante da transição.
 *
 * Formatação: objetos capturados (console, payload WS) viram JSON indentado
 * (2 espaços) via `formatarValor` — legível no painel e na cópia, sem o
 * achatamento "[object Object]" dos valores serializáveis (só ciclos caem
 * no fallback String()).
 *
 * Truncagem: linhas a ~2000 chars (payload de WS, console, JSON indentado);
 * o painel mostra com wrap (`whitespace-pre-wrap`).
 */

export type FonteDoDepurador = 'console' | 'erro' | 'boundary' | 'ws→' | 'ws←' | 'backend' | 'fase'

export type NivelDoDepurador = 'info' | 'warn' | 'error'

/** Fases dos marcadores: login, registro, sala e turno por posição (2–4 jogadores → turno-1..4). */
export type FaseDoDepurador = 'login' | 'registro' | 'sala' | `turno-${number}`

export interface EntradaDeDepuracao {
  id: number
  /** Epoch ms do registro (o painel formata HH:mm:ss.mmm). */
  registradoEm: number
  fonte: FonteDoDepurador
  nivel: NivelDoDepurador
  /** Sala/partida/componente; null quando a fonte não carrega contexto. */
  contexto: string | null
  mensagem: string
  /** Fase vigente no instante do registro (fundo histórico da linha). */
  fase: FaseDoDepurador | null
}

/** Cap do buffer anelado (issue #340): ~500 entradas, descarta as mais antigas. */
export const CAPACIDADE_DO_BUFFER = 500

/** Truncagem de linha (issue #340): ~2000 chars — teto alto o bastante para
 * manter JSON indentado legível sem inflar o buffer. */
export const TAMANHO_MAXIMO_DA_LINHA = 2000

/** Chave do sessionStorage que sobrevive a reload (o histórico não sobrevive). */
const CHAVE_SESSAO_DO_MODO = 'flicker:modo-desenvolvedor'

const buffer: EntradaDeDepuracao[] = []
const assinantes = new Set<(entrada: EntradaDeDepuracao) => void>()
const manipuladoresDeAtivacao = new Set<() => void>()
const manipuladoresDeDesativacao = new Set<() => void>()

let proximoId = 1
let faseAtual: FaseDoDepurador | null = null
let instalado = false
let consoleOriginal: Pick<Console, 'log' | 'warn' | 'error'> | null = null

// Modo: lê o sessionStorage uma única vez no boot do módulo (main.tsx importa
// antes do render). Guardado para SSR/testes sem storage.
function lerModoSessao(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_SESSAO_DO_MODO) === '1'
  } catch {
    return false
  }
}

let modoAtivo = false
try {
  modoAtivo = typeof window !== 'undefined' && lerModoSessao()
} catch {
  modoAtivo = false
}

export function estaModoAtivo(): boolean {
  return modoAtivo
}

/** Ativa o Modo Desenvolvedor. Idempotente: ativação repetida não renotifica. */
export function ativarModoDoDesenvolvedor(): void {
  if (modoAtivo) return
  modoAtivo = true
  try {
    window.sessionStorage.setItem(CHAVE_SESSAO_DO_MODO, '1')
  } catch {
    // Storage indisponível (privacidade/iframe): o modo vive só nesta página.
  }
  for (const manipulador of [...manipuladoresDeAtivacao]) {
    try {
      manipulador()
    } catch {
      // Assinante com falha não bloqueia os demais.
    }
  }
}

/** Assina o instante da ativação (hooks de WS enviam ATIVAR_DEBUG aqui). Devolve o unsubscribe. */
export function aoAtivarModo(manipulador: () => void): () => void {
  manipuladoresDeAtivacao.add(manipulador)
  return () => {
    manipuladoresDeAtivacao.delete(manipulador)
  }
}

/** Desativa o Modo Desenvolvedor. Idempotente: desativação repetida não renotifica. */
export function desativarModoDoDesenvolvedor(): void {
  if (!modoAtivo) return
  modoAtivo = false
  try {
    window.sessionStorage.removeItem(CHAVE_SESSAO_DO_MODO)
  } catch {
    // Storage indisponível (privacidade/iframe): o modo vive só nesta página.
  }
  for (const manipulador of [...manipuladoresDeDesativacao]) {
    try {
      manipulador()
    } catch {
      // Assinante com falha não bloqueia os demais.
    }
  }
}

/** Assina o instante da desativação (hooks de WS enviam DESATIVAR_DEBUG aqui). Devolve o unsubscribe. */
export function aoDesativarModo(manipulador: () => void): () => void {
  manipuladoresDeDesativacao.add(manipulador)
  return () => {
    manipuladoresDeDesativacao.delete(manipulador)
  }
}

/** Trunca o texto a ~2000 chars (payload de WS, linhas longas de console,
 * JSON indentado) — o painel renderiza com wrap, não em linha única. */
export function truncarTexto(texto: string, limite: number = TAMANHO_MAXIMO_DA_LINHA): string {
  return texto.length <= limite ? texto : `${texto.slice(0, limite)}…`
}

/**
 * Formata um valor capturado como texto legível (issue #340): string passa
 * como está; Error vira "Nome: mensagem"; demais valores (objetos, arrays,
 * primitivos) via JSON.stringify(…, null, 2) — indentação e espaçamento.
 * Ciclos e serialização impossível (incluindo `undefined` retornado pelo
 * stringify) caem em String(): nunca explode e nunca vira "[object Object]"
 * silenciosamente achatado.
 */
export function formatarValor(valor: unknown): string {
  if (typeof valor === 'string') return valor
  if (valor instanceof Error) return `${valor.name}: ${valor.message}`
  try {
    return JSON.stringify(valor, null, 2) ?? String(valor)
  } catch {
    return String(valor)
  }
}

/** Serializa o payload de WS para o painel (objetos em JSON indentado, truncada). */
export function resumirPayload(payload: unknown): string {
  return truncarTexto(typeof payload === 'string' ? payload : formatarValor(payload))
}

function registrar(
  fonte: FonteDoDepurador,
  nivel: NivelDoDepurador,
  mensagem: string,
  contexto: string | null = null,
): EntradaDeDepuracao {
  const entrada: EntradaDeDepuracao = {
    id: proximoId++,
    registradoEm: Date.now(),
    fonte,
    nivel,
    contexto,
    mensagem: truncarTexto(mensagem),
    fase: faseAtual,
  }
  buffer.push(entrada)
  // Anel: acima do cap, descarta as mais antigas.
  if (buffer.length > CAPACIDADE_DO_BUFFER) {
    buffer.splice(0, buffer.length - CAPACIDADE_DO_BUFFER)
  }
  for (const assinante of [...assinantes]) {
    try {
      assinante(entrada)
    } catch {
      // Assinante com falha não bloqueia os demais.
    }
  }
  return entrada
}

/**
 * Ponto de entrada das fontes instrumentadas (boundaries, hooks de WS,
 * linhas espelhadas do backend). `console` e erros globais são capturados
 * pelo instalador; o resto chama esta função.
 */
export function coletar(
  fonte: FonteDoDepurador,
  nivel: NivelDoDepurador,
  mensagem: string,
  contexto?: string,
): void {
  registrar(fonte, nivel, mensagem, contexto ?? null)
}

/**
 * Define a fase vigente e enxerta o registro "fase mudou para X" no stream
 * (issue #340). As entradas seguintes recebem a nova fase como fundo.
 */
export function definirFase(fase: FaseDoDepurador): void {
  if (faseAtual === fase) return
  faseAtual = fase
  registrar('fase', 'info', `fase mudou para ${fase}`)
}

export function faseVigente(): FaseDoDepurador | null {
  return faseAtual
}

/** Cópia do buffer (mais antiga → mais nova). */
export function entradas(): readonly EntradaDeDepuracao[] {
  return [...buffer]
}

/** Últimas N entradas; N <= 0 devolve tudo. */
export function ultimas(n: number): readonly EntradaDeDepuracao[] {
  if (n <= 0) return entradas()
  return buffer.slice(Math.max(0, buffer.length - n))
}

/** Limpa o buffer (botão Limpar do painel). IDs seguem monotônicos. */
export function limpar(): void {
  buffer.length = 0
}

/** Assina novas entradas (o painel vive disto). Devolve o unsubscribe. */
export function subscrever(assinante: (entrada: EntradaDeDepuracao) => void): () => void {
  assinantes.add(assinante)
  return () => {
    assinantes.delete(assinante)
  }
}

/** Formata o instante da entrada como HH:mm:ss.mmm (relógio do navegador). */
export function formatarTimestamp(registradoEm: number): string {
  const data = new Date(registradoEm)
  const dois = (valor: number) => String(valor).padStart(2, '0')
  const tres = (valor: number) => String(valor).padStart(3, '0')
  return `${dois(data.getHours())}:${dois(data.getMinutes())}:${dois(data.getSeconds())}.${tres(data.getMilliseconds())}`
}

/** Linha pronta do painel/cópia: `[HH:mm:ss.mmm] [fonte] [contexto] mensagem`. */
export function formatarLinha(entrada: EntradaDeDepuracao): string {
  const contexto = entrada.contexto !== null ? ` [${entrada.contexto}]` : ''
  return `[${formatarTimestamp(entrada.registradoEm)}] [${entrada.fonte}]${contexto} ${entrada.mensagem}`
}

/**
 * Instala a captura global (console + erros não capturados). Idempotente e
 * uma única vez por página: chamada em `main.tsx` antes de qualquer render
 * para que nada escape do boot.
 */
export function instalarColetorDeDepuracao(): void {
  if (instalado) return
  instalado = true
  consoleOriginal = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) }

  // Objetos passam por formatarValor: JSON indentado no painel/cópia em vez
  // de "[object Object]" (o console original mantém o valor vivo, como antes).
  console.log = (...args: unknown[]) => {
    consoleOriginal?.log(...args)
    registrar('console', 'info', args.map(formatarValor).join(' '))
  }
  console.warn = (...args: unknown[]) => {
    consoleOriginal?.warn(...args)
    registrar('console', 'warn', args.map(formatarValor).join(' '))
  }
  console.error = (...args: unknown[]) => {
    consoleOriginal?.error(...args)
    registrar('console', 'error', args.map(formatarValor).join(' '))
  }

  window.addEventListener('error', (evento) => {
    registrar('erro', 'error', evento.message || 'erro desconhecido')
  })
  window.addEventListener('unhandledrejection', (evento) => {
    const motivo = evento.reason instanceof Error ? evento.reason.message : String(evento.reason)
    registrar('erro', 'error', `promessa rejeitada sem tratamento: ${motivo}`)
  })
}

/**
 * Restaura o console original — usado apenas nos testes, para o hijack não
 * vazar entre suites (o Vitest usa o console para relatar).
 */
export function desinstalarColetorDeDepuracao(): void {
  if (!instalado || consoleOriginal === null) return
  console.log = consoleOriginal.log
  console.warn = consoleOriginal.warn
  console.error = consoleOriginal.error
  consoleOriginal = null
  instalado = false
}
