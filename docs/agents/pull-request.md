# Pull Requests

Este projeto abre uma PR somente depois de implementar, testar e executar o
`/code-review`. O subagente `criar-pr` prepara o preview e só publica depois da
aprovação humana do preview completo.

## Título

Use um título técnico, curto e em português brasileiro:

```text
feat(frontend): adiciona sala de espera
fix(backend): corrige reconexão do jogador
chore(db): atualiza migration de partidas
```

Use o escopo `frontend`, `backend`, `db` ou `infra` quando a mudança estiver
concentrada em uma área. Em mudanças multiárea, omita o escopo:
`feat: adiciona fluxo multiplayer completo`.

O tipo descreve a mudança (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`,
`perf`, `build` ou `ci`). Prefira um verbo específico e não use títulos como
`fix bug` ou `phase 1`.

## Corpo

Mantenha o corpo curto e use estas seções, nesta ordem:

```markdown
## O que mudou

<comportamento entregue, sem lista de detalhes de implementação>

## Por que

<problema ou objetivo que motivou a mudança>

## Validação

- <testes, typecheck, code-review ou evidência relevante>

Closes #123
Related to #456
```

`Closes #<número>` vincula a issue principal. Use uma linha `Related to
#<número>` para cada issue relacionada. O vínculo automático depende de a PR
apontar para a branch default do repositório.

Quando a PR atravessar frontend, backend, banco ou infra, acrescente uma matriz
curta de impacto em `Validação` ou logo depois dela. Não crie PRs separadas
apenas para separar áreas que fazem parte do mesmo comportamento entregue.

Inclua evidência visual somente quando a mudança de frontend tornar isso
relevante para a revisão. Não automatize reviewers ou labels nesta etapa.

## Gates

O preview precisa informar título, branch de origem, branch base, issues,
corpo, validações, impactos e as ações de publicação. Branch default, branch
incorreta, mudanças não commitadas, estado inconsistente, testes falhos,
achados relevantes de Spec ou violações documentadas bloqueiam a publicação.
Smells julgamentais do code-review devem ser registrados como riscos, não como
bloqueios automáticos.

O agente não altera código, não faz merge e não cria uma segunda PR para uma
branch que já tenha uma PR aberta.

## Referências

- [Vincular uma PR a uma issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue)
- [Escrever boas descrições de mudanças](https://google.github.io/eng-practices/review/developer/cl-descriptions.html)
- [O que procurar em um code-review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)
