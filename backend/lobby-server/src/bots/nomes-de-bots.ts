// Nomes temáticos dos bots efêmeros (#352, follow-up da review #365).
//
// Troca o hash `b-xxxx-xxxxxx` por leitura humana na Sala/Partida e em
// `BOT_FALHOU` ("Bot Coelho Sabido não entrou: ...").
//
// Regras:
//   - ASCII, 3–17 chars cada (reserva para o sufixo " 99" dentro do teto de
//     20 do contrato `CadastroRequest.apelido` — ver `routes/auth.ts`).
//   - Unicidade por Sala: a rota monta os ocupados (membros via PG — a
//     projeção/engine não carregam Apelido — + in-flight via `estado.ts`)
//     e o sorteio exclui; sufixo numérico só quando o pool esgota.
//   - `UNIQUE` global do PG continua como árbitro final (outra Sala pode
//     reutilizar a base); colisão vira retry no `bot-runner.ts`.

import { randomInt } from 'node:crypto';

/** Teto do contrato de Apelido (OpenAPI `CadastroRequest.apelido` 3–20). */
export const APELIDO_MAX = 20;

/** Base temática do Sanatório — ASCII, sem acento, 3–17 chars. */
export const NOMES_DE_BOTS: readonly string[] = [
  'Coelho Sabido',
  'Raposa Astuta',
  'Corvo Insone',
  'Lobo Cansado',
  'Vulto Calmo',
  'Espectro Manso',
  'Paciente Zero',
  'Guarda Noturno',
  'Rato do Porao',
  'Medico de Plantao',
  'Enfermeira Insone',
  'Vigia Sonolento',
  'Doutor Sombrio',
  'Irma do Turno',
  'Faxineiro Zero',
  'Porteiro Calmo',
  'Coveiro Manso',
  'Sentinela Fria',
  'Eco do Corredor',
  'Sombra Amiga',
];

/** Comparação de ocupação: ignora caixa e espaços (evita "X" vs "x " na Sala). */
export function normalizarApelido(apelido: string): string {
  return apelido.trim().toLowerCase();
}

/** Sufixo só em colisão: 1ª tentativa sem sufixo, depois " 2", " 3"... (cabe em 20). */
export function apelidoComSufixo(base: string, n: number): string {
  if (n <= 1) return base.slice(0, APELIDO_MAX);
  const sufixo = ` ${n}`;
  return `${base.slice(0, APELIDO_MAX - sufixo.length)}${sufixo}`;
}

/**
 * Sorteia um Apelido livre na Sala.
 * `ocupados` usa comparação normalizada (case-insensitive).
 * `indiceAleatorio` existe para testes determinísticos.
 */
export function sortearApelidoDeBot(
  ocupados: readonly string[] = [],
  indiceAleatorio: (limite: number) => number = (limite) => randomInt(limite),
): string {
  const ocupadosSet = new Set(ocupados.map(normalizarApelido));
  const livres = NOMES_DE_BOTS.filter((nome) => !ocupadosSet.has(normalizarApelido(nome)));
  if (livres.length > 0) {
    return livres[indiceAleatorio(livres.length)]!;
  }
  // Pool esgotado na Sala: reaproveita base com o menor sufixo livre.
  for (let n = 2; n <= 99; n++) {
    const base = NOMES_DE_BOTS[indiceAleatorio(NOMES_DE_BOTS.length)]!;
    const candidato = apelidoComSufixo(base, n);
    if (!ocupadosSet.has(normalizarApelido(candidato))) return candidato;
  }
  // Praticamente inalcançável (teto da Sala é 4); último recurso com sufixo alto.
  const base = NOMES_DE_BOTS[indiceAleatorio(NOMES_DE_BOTS.length)]!;
  return apelidoComSufixo(base, 99);
}
