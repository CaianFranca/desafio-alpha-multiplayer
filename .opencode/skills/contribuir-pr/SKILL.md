---
name: contribuir-pr
description: Assume uma PR de outro dev com request changes enquanto o autor está ocupado — implementa o bloqueante, devolve os commits à PR original e assina a contribuição.
disable-model-invocation: true
---

# Contribuir para PR de outro autor

Use esta skill quando uma PR recebeu *request changes* e o autor não pode
responder agora. Você pega a branch dele localmente, implementa os ajustes
do review e devolve os commits à PR original — sem PR nova e sem merge —
assinando cada artefato da contribuição.

Fontes de convenção: `docs/agents/pull-request.md` (títulos e commits) e
`AGENTS.md`.

## Passo 0: pré-voo

1. Confirme `gh auth status` — precisa dizer "Logged in". Sem autenticação, pare.
2. Confirme `git status` limpo — nada não commitado. Com mudanças pendentes,
   pare e devolva ao usuário.
3. Capture a identidade do dev:
   - Assinatura na PR: `gh api user --jq .login`
   - Trailer nos commits: `git config user.name` e `git config user.email`
4. Se o número da PR não foi informado, pergunte de forma inequívoca.

Critério: autenticado, repo limpo, login + nome + email capturados, número da
PR em mãos.

## Passo 1: ler a PR e classificar o review

1. `gh pr view <N> --json author,headRefName,reviewDecision,reviews,title,url,state`
2. Se `state` não é `OPEN` ou `reviewDecision` não é `CHANGES_REQUESTED`,
   devolva ao usuário antes de seguir.
3. Classifique os itens dos reviews na hierarquia:
   - **Bloqueante** — sem isso a PR não mergeia (build, teste, typecheck quebrados).
   - **Deve fazer agora** — o review pediu; não bloqueia o merge.
   - **Opcional** — melhoria sugerida, pode ficar para depois.
4. Regra: o bloqueante primeiro. Um commit pequeno por item — misturar tudo
   num commit gigante dificulta o re-review.

## Passo 2: plano de assunção (gate 1)

Apresente exatamente um plano com: autor, branch, título da PR, classificação
dos itens e o texto do comentário de etiqueta (passo 3) assinado
`— @<login do dev>`. Pergunte de forma inequívoca: `Aprova assumir esta PR e
postar o comentário de etiqueta?`

Sem aprovação explícita, nenhuma mutação no GitHub acontece.

## Passo 3: etiqueta

1. Poste o comentário aprovado: `gh pr comment <N> --body "<texto aprovado>"`.
2. Adicione o dev como assignee: `gh pr edit <N> --add-assignee @me`.

## Passo 4: checkout

`gh pr checkout <N>` — cria a branch local trackeando a branch do autor.
Confirme com `git status` e `git log --oneline -5`.

Critério: na branch do autor, com tracking apontando para o origin — é isso
que faz o `git push` simples devolver os commits à PR original.

## Passo 5: reproduzir os erros do review

Nada de consertar às cegas. Para cada item bloqueante:

1. Monte a evidência vermelha: crie ou execute testes que a evidenciem —
   inclua `test`, `lint` e `typecheck` quando se aplicarem ao item; sondas
   ad-hoc servem quando a suíte não cobre o erro apontado.
2. Se nada falhar, o autor já corrigiu depois do review — pule para o passo 7
   e feche o ciclo.

Critério: cada item bloqueante com falha reproduzida e identificada, ou a
confirmação de que o fix já existe.

## Passo 6: implementar o bloqueante

1. Um commit pequeno por item, mensagem no padrão do repo:
   `fix(escopo): descrição no imperativo`.
2. Cada commit com trailer de assinatura do dev:

   ```text
   Co-authored-by: <user.name> <user.email>
   ```

3. Testes de reprodução legítimos (regression tests) entram no commit do fix;
   sondas ad-hoc são descartadas.

## Passo 7: validar

Rode o fluxo de validação do repo descoberto no passo 5 mais os testes de
reprodução. Tudo verde antes de qualquer push — commit quebrado na branch de
outra pessoa é pior do que não ajudar.

## Passo 8: devolver e fechar (gate 2)

1. Apresente o preview: commits gerados, resultado da validação e o rascunho
   do comentário de fechamento — o que foi feito, próximos itens, assinado
   `— @<login do dev>`.
2. Pergunte de forma inequívoca: `Aprova o push e o comentário de fechamento?`
3. Só após aprovação explícita: `git push` e
   `gh pr comment <N> --body "<texto aprovado>"` — o texto aprovado, sem
   alterações.

## Regras

- Nunca mergeie a PR.
- Não abra segunda PR para branch que já tem PR aberta.
- Se o push for recusado, pare e devolva o erro ao usuário — não improvise
  caminho alternativo.
- Um gate com aprovação explícita antes de cada mutação no GitHub (passos 2,
  3 e 8).
