# Database — Flicker of Sanity

Padrões de código desta área: [`CODING_STANDARDS.md`](./CODING_STANDARDS.md).

## Docs atuais via Context7

Quando o código depende de uma API de dependência que sua memória pode ter
defasada — assinatura exata, config, comportamento que muda entre versões —
consulte as docs oficiais no MCP `context7` (informando a lib e versão)
antes de escrever. Dispara em: Knex.js (query builder, schema builder,
migrations e seeds), driver do PostgreSQL (`pg` / `node-postgres`) e
bibliotecas de pool/validação de conexão. Consulta pontual: o alvo é a lib/driver,
não SQL ANSI básico.