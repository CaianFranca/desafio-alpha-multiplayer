// Re-export do middleware centralizado em @flicker/shared (issue #411)
// Mantido como wrapper para compatibilidade de import local; fonte única em shared/requestId.ts
export { requestIdMiddleware, getRequestId } from '@flicker/shared/server';
