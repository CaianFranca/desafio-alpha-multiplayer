// Mock WebSocket global compartilhado pelos testes de nível de página
// (sala.test.tsx, sala-chat-controles.test.tsx). Simula o ciclo do socket
// sem rede: abre por microtask (ou sob demanda com forceNoAutoOpen) e grava
// tudo o que foi enviado em sentMessages.

export class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  // Simula o handshake real: o próximo socket nasce CONNECTING e só abre
  // quando o teste chamar simulateOpen(). Exige o teste de retry do Bug 1.
  static forceNoAutoOpen = false
  url: string
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    if (MockWebSocket.forceNoAutoOpen) {
      // Recomeça CONNECTING; simulateOpen() será chamado pelo teste.
      this.readyState = MockWebSocket.CONNECTING
    } else {
      this.readyState = MockWebSocket.OPEN
      queueMicrotask(() => this.onopen?.(new Event('open')))
    }
    MockWebSocket.instances.push(this)
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.(new Event('open'))
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  /**
   * Fecha o socket repassando `code`/`reason` no CloseEvent (issue #329: o
   * cliente distingue o não-início `4000 PARTIDA_NAO_INICIADA` dos demais
   * fechamentos). Sem argumentos, comporta-se como antes (fechamento sem
   * código — cai na reconexão simples do hook).
   */
  close(code?: number, reason?: string) {
    this.simulateClose(code, reason)
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.(
      new CloseEvent('close', { code: code ?? 1005, reason: reason ?? '' }) as CloseEvent,
    )
  }

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }) as MessageEvent)
  }

  static clean() {
    MockWebSocket.instances = []
  }

  static last(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }
}

// @types/node declara o global WebSocket: o mock atribui sem supressão.
global.WebSocket = MockWebSocket as unknown as typeof WebSocket
// garante OPEN no global para o hook comparar
if ((global.WebSocket as unknown as { OPEN?: number }).OPEN === undefined) {
  // @ts-expect-error assign
  global.WebSocket.OPEN = 1
}
// jsdom não tem MessageEvent construtor completo, polyfill simples se necessário
if (typeof MessageEvent === 'undefined') {
  // @ts-expect-error polyfill
  global.MessageEvent = class MessageEvent extends Event {
    data: unknown
    constructor(type: string, init: { data: unknown }) {
      super(type)
      this.data = init.data
    }
  }
}
