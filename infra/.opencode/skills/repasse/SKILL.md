---
name: repasse
description: Compila a conversa atual em um documento de repasse para outro agente dar continuidade ao trabalho.
argument-hint: "Para que a próxima sessão será usada?"
disable-model-invocation: true
---

Escreva um documento de repasse resumindo a conversa atual para que um agente novo possa dar continuidade ao trabalho. Salve em `.scratch/repasse/` no diretório de trabalho atual, com nome `repasse-YYYYMMDD-HHMM.md`, e informe o caminho completo ao usuário ao final — o documento fica acessível para o desenvolvedor validar.

Inclua uma seção **skills sugeridas** no documento, indicando as skills que o agente deve invocar.

Não duplique conteúdo já capturado em outros artefatos (specs, planos, ADRs, issues, commits, diffs). Referencie-os por caminho ou URL.

Redija qualquer informação sensível, como chaves de API, senhas ou dados pessoais identificáveis.

Se o usuário passou argumentos, trate-os como uma descrição do foco da próxima sessão e adapte o documento de acordo.
