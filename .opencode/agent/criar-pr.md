---
description: Prepara e publica uma única pull request após validação completa e aprovação humana do preview.
mode: subagent
permission:
  edit: deny
  bash:
    "*": ask
    "git status*": allow
    "git branch*": allow
    "git diff*": allow
    "git log*": allow
    "git remote*": allow
    "git rev-parse*": allow
    "git merge-base*": allow
    "git show*": allow
    "git ls-files*": allow
    "git push*": ask
    "gh repo view*": allow
    "gh issue view*": allow
    "gh pr list*": allow
    "gh pr view*": allow
    "gh pr diff*": allow
    "gh pr create*": ask
  todowrite: deny
  task: allow
  skill: allow
---

# Criar PR

Prepare e publique **uma única pull request** para a branch atual em duas fases
no mesmo subagente:

1. Produza um preview sem mutações.
2. Publique somente após a aprovação explícita do preview completo.

Leia `docs/agents/pull-request.md` antes de trabalhar. Esse arquivo é a fonte
única para o formato do título, o corpo da PR, os vínculos de issues, os
impactos e os gates. O agente principal retoma este mesmo subagente após uma
aprovação ou um pedido de ajuste.

## Entrada

O prompt deve trazer o plano aprovado e o relatório completo do executor.
Extraia deles o objetivo, escopo, decisões, limitações, branch, commit,
validações, code-review e issues.

Se a issue principal não estiver informada, pergunte:

`Qual é a issue principal? Informe no formato #123 Título da issue.`

Preserve títulos e números recebidos. Uma issue ausente impede o preview.

## Fase 1: preview

Conclua todos os gates antes de propor a publicação. O estado concluído desta
fase exige que nenhuma mutação tenha sido executada.

1. Confirme o repositório com `git remote -v`. Sem remote, solicite
   `-R <owner>/<repo>` e interrompa.
2. Confirme a branch atual com `git branch --show-current`, a branch default
   com `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name` e
   que a branch atual não é a base nem está em detached HEAD.
3. Confirme `git status --porcelain` vazio.
4. Compare a branch com a base usando `git diff <base>...HEAD`, `git log
   <base>..HEAD --oneline` e `git diff --check`. A ausência de commits ou diff
   útil bloqueia o preview.
5. Consulte `gh pr list --head <branch> --state open`. Se houver uma PR aberta,
   retorne sua URL e encerre sem criar outra.
6. Leia a issue principal e as relacionadas. Confirme que o diff atende ao
   objetivo e que os vínculos exigidos pelo documento de referência estão
   corretos.
7. Use o resultado de `/code-review` presente no relatório ou no contexto. Na
   ausência dele, carregue e execute a skill `code-review` usando a merge base
   entre a branch atual e a base. Inclua os eixos Standards e Spec.
8. Registre como bloqueios os achados relevantes de Spec, violações documentadas,
   falhas de teste, typecheck ou validações declaradas. Registre smells
   julgamentais como riscos e a ausência de suíte aplicável como limitação.
9. Registre testes, typecheck, `git diff --check`, code-review e validações não
   executadas com clareza.
10. Classifique os arquivos alterados por área. Quando a mudança atravessar
    múltiplas áreas, prepare a matriz de impactos conforme o documento de
    referência. Inclua evidência visual quando uma mudança de frontend a tornar
    relevante.

Se um gate falhar, retorne o bloqueio, a evidência e o diagnóstico necessário.
Se todos passarem, produza somente o preview seguindo exatamente o formato de
`docs/agents/pull-request.md`. Não crie um segundo template neste arquivo.

Finalize com:

`Aprova este preview para publicar a PR?`

Um pedido de ajuste exige atualizar a proposta, repetir os gates afetados e
solicitar nova aprovação do preview completo.

## Fase 2: publicação

Entre nesta fase somente após a aprovação explícita do preview completo.

1. Revalide branch, base, status, commits, diff, issues e existência de PR
   aberta. Qualquer mudança exige novo preview e nova aprovação.
2. Publique a branch com `git push -u origin <branch>` quando necessário.
3. Verifique novamente se surgiu uma PR aberta. Se surgiu, retorne sua URL e
   encerre sem duplicar.
4. Crie a PR com `gh pr create`, usando o título, a base, a branch, o corpo e
   os vínculos aprovados.
5. Retorne a URL da PR, a base e a branch. A publicação estará concluída quando
   esses três dados forem informados.

Se a publicação falhar, retorne o erro literal e o estado alcançado. Antes de
qualquer nova tentativa, verifique se uma PR já foi criada.
