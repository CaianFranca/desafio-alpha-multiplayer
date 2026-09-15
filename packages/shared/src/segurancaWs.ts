// Endurecimento do WS (issue #409): helpers de runtime server-side puros,
// sem dependência de Node além de Date.

/**
 * `Origin` de navegador é sempre `scheme://host:port`; clientes não-navegador
 * (testes, bots) não enviam o header, e nesse caso a checagem não bloqueia.
 */
export function origemPermitida(origin: string | undefined, permitidas: readonly string[]): boolean {
  if (origin === undefined || origin.length === 0) {
    return true;
  }
  return permitidas.includes(origin);
}

/**
 * Janela deslizante em memória por conexão. `agora` é injetável para teste
 * determinístico.
 */
export class LimiteDeMensagensPorConexao {
  private readonly registros: number[] = [];

  constructor(
    private readonly maximo: number,
    private readonly janelaMs: number,
    private readonly agora: () => number = Date.now,
  ) {}

  registrar(): boolean {
    const instante = this.agora();
    const limite = instante - this.janelaMs;
    while (this.registros.length > 0 && this.registros[0] <= limite) {
      this.registros.shift();
    }
    if (this.registros.length >= this.maximo) {
      return false;
    }
    this.registros.push(instante);
    return true;
  }
}
