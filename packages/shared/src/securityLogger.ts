// Logger estruturado de eventos de segurança (issue #411).
// Usa pino JSON com sink injetável para testes; hash de email e redação garantida.

import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import pino, { type Logger, type LoggerOptions } from 'pino';

export const securityEvents = {
  AUTH_LOGIN_SUCCESS: 'auth.login_success',
  AUTH_LOGIN_FAILURE: 'auth.login_failure',
  AUTH_RATE_LIMIT_EXCEEDED: 'auth.rate_limit_exceeded',
  AUTH_REGISTER_SUCCESS: 'auth.register_success',
  AUTH_REGISTER_CONFLICT: 'auth.register_conflict',
  AUTH_SESSION_REUSE: 'auth.session_reuse',
  WS_HANDSHAKE_REJECTED: 'ws.handshake_rejected',
  WS_RATE_LIMIT_EXCEEDED: 'ws.rate_limit_exceeded',
  WS_MESSAGE_REJECTED: 'ws.message_rejected',
  WS_PAYLOAD_TOO_LARGE: 'ws.payload_too_large',
} as const;

export type SecurityEvent = (typeof securityEvents)[keyof typeof securityEvents];

// Chaves sensíveis que nunca devem aparecer em claro.
const SENSITIVE_KEYS = new Set([
  'senha',
  'password',
  'token',
  'cookie',
  'authorization',
  'jwt',
  'secret',
  'refresh_token',
  'access_token',
  'refreshToken',
  'accessToken',
]);

const REDACTED = '[REDACTED]';

/**
 * Hash determinístico de email para logs: sha256 normalizado, truncado em 16 hex.
 * Nunca logar email em claro (decisão #411).
 */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return REDACTED;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Redação profunda: substitui valores de chaves sensíveis por [REDACTED].
 * Comparação case-insensitive e sem mutar o objeto original.
 */
export function redact<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;
  if (Array.isArray(input)) {
    return (input as unknown[]).map((v) => redact(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = REDACTED;
    } else if (value !== null && typeof value === 'object') {
      out[key] = redact(value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

export interface CreateSecurityLoggerOptions {
  level?: string;
  /**
   * Destino injetável para testes.
   * - Writable: stream pino nativo
   * - unknown[]: array coletor; cada linha JSON é pushada como objeto parseado
   * - undefined: pino.destination() (stdout)
   */
  sink?: Writable | unknown[];
  name?: string;
}

function createArraySink(array: unknown[]): Writable {
  return new Writable({
    write(chunk: Buffer | string, _enc, cb) {
      const line = chunk.toString().trim();
      if (line.length > 0) {
        // pino emite uma linha JSON por log. Tenta parsear; se falhar, guarda string.
        try {
          const obj = JSON.parse(line);
          // Garante redação também no sink de teste caso alguém passe objeto cru.
          const safe = redact(obj);
          array.push(safe);
        } catch {
          array.push(line);
        }
      }
      cb();
    },
  });
}

export function createSecurityLogger(options: CreateSecurityLoggerOptions = {}): Logger {
  const { level = 'info', sink, name = 'security' } = options;

  let destination: Writable | undefined;
  if (Array.isArray(sink)) {
    destination = createArraySink(sink);
  } else if (sink !== undefined) {
    destination = sink as Writable;
  }

  const pinoOptions: LoggerOptions = {
    name,
    level,
    // Timestamp ISO legível (pino default é epoch ms)
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    // Formata level como string (info/warn/error) em vez de número
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    // Segurança adicional: pino redact nativo (além do helper) para caminhos aninhados
    redact: {
      paths: [
        '*.senha',
        '*.password',
        '*.token',
        '*.cookie',
        '*.authorization',
        '*.jwt',
        '*.secret',
        '*.refresh_token',
        '*.access_token',
        '*.*.senha',
        '*.*.password',
        '*.*.token',
        '*.*.cookie',
        '*.*.authorization',
        '*.*.jwt',
        '*.*.secret',
        'req.headers.cookie',
        'req.headers.authorization',
        'headers.cookie',
        'headers.authorization',
      ],
      censor: REDACTED,
      remove: false,
    },
    // Base vazio: cada log carrega apenas o que é passado + level/time/name.
    // Evita vazar hostname/pid em alguns ambientes; pino inclui pid/hostname por default — mantemos.
  };

  // Envolve pino para garantir redação do payload antes de emitir.
  const base = destination !== undefined ? pino(pinoOptions, destination) : pino(pinoOptions);

  // Proxy leve que redige objetos antes de delegar ao pino.
  const wrap =
    (method: keyof Logger) =>
    (objOrMsg: unknown, msg?: string) => {
      if (typeof objOrMsg === 'object' && objOrMsg !== null) {
        const safe = redact(objOrMsg as Record<string, unknown>);
        if (msg !== undefined) {
          return (base[method] as unknown as (a: unknown, b: string) => unknown)(safe, msg);
        }
        return (base[method] as unknown as (a: unknown) => unknown)(safe);
      }
      // pino permite logger.info('string msg')
      return (base[method] as unknown as (a: unknown) => unknown)(objOrMsg);
    };

  // Retorna o logger base com métodos envoltos por redação. Preserva demais props.
  const logger = base as unknown as Record<string, unknown>;
  for (const m of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
    const original = base[m].bind(base);
    (logger[m] as unknown) = (objOrMsg: unknown, msg?: string) => {
      if (typeof objOrMsg === 'object' && objOrMsg !== null) {
        const safe = redact(objOrMsg as Record<string, unknown>);
        return msg !== undefined
          ? (original as (a: unknown, b: string) => unknown)(safe, msg)
          : (original as (a: unknown) => unknown)(safe);
      }
      return (original as (a: unknown) => unknown)(objOrMsg);
    };
  }
  // Expõe helpers para testes
  (logger as unknown as { hashEmail: typeof hashEmail }).hashEmail = hashEmail;
  (logger as unknown as { redact: typeof redact }).redact = redact;

  // Evita variável não usada
  void wrap;

  return base;
}

// Logger default singleton (stdout) para uso em produção sem injeção.
export const securityLogger = createSecurityLogger();
