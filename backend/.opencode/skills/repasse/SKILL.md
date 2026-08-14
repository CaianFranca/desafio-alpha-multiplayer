---
name: repasse
description: Compila a conversa atual em um documento de repasse (brief compacto) para outra sessão executar.
argument-hint: "Para que a próxima sessão será usada?"
disable-model-invocation: true
---

Escreva um **brief de repasse** compacto com o trabalho a executar, para um agente novo numa sessão com janela de contexto vazia. Não altere código.

Salve em `.scratch/repasse/repasse-YYYYMMDD-HHMM.md` no diretório de trabalho atual — `.scratch/` está no `.gitignore`, então o arquivo fica local. Ao final, informe o caminho completo e oriente o usuário:

- abrir uma nova seção com `/new`;
- executar `/implement <caminho-completo>` nessa seção vazia.

## Template

```markdown
# Repasse: <título>

## Objetivo

Uma ou duas frases: o que deve estar pronto ao final.

## Decisões e limites

- Decisões que não podem ser reinterpretadas.
- O que está fora do escopo.
- Pendências: questões em aberto que bloqueiam a execução, se houver.

## Execução

1. Passo concreto.
2. Passo concreto.
3. Passo concreto.

## Verificação

- Critério de aceitação.
- Comando ou teste de validação.

## Skills sugeridas

- Apenas as skills realmente necessárias para este trabalho.

## Referências

- Caminhos, issues, ADRs e artefatos relevantes — por referência, não copiados.
```

## Regras

- **Compacto**: cada seção carrega só o necessário para executar ou verificar. Não duplique conteúdo já capturado em specs, issues, ADRs, commits ou diffs — referencie por caminho ou URL.
- **Pendências bloqueadoras** (escopo, comportamento, contrato ou arquitetura) vão para o brief; o executor deve parar e perguntar antes de editar.
- Inclua caminhos de arquivos apenas quando descobertos na exploração e relevantes para orientar a execução.
- Omita informações sensíveis: chaves de API, senhas, dados pessoais.
- Se o usuário passou argumentos, trate-os como o foco da próxima sessão e adapte o documento.
