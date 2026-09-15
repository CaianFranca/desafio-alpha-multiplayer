// Entry server-side de @flicker/shared — helpers de runtime ligados a Redis.
// Mantido fora do `index.ts` (entry raiz) para que o bundle do browser não
// importe ioredis/@flicker/config. Ver comment da fronteira no índice.
export * from './redis/gameServers.js';
export * from './segurancaWs.js';
export * from './securityLogger.js';
export * from './requestId.js';