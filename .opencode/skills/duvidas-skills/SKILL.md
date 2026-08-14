---
name: duvidas-skills
description: Resolve dúvidas sobre qual skill ou fluxo se encaixa na sua situação — um roteador sobre as skills deste repo.
disable-model-invocation: true
---

# Dúvidas de Skills

Você não lembra de todas as skills, então pergunte.

Um **fluxo** é um caminho pelas skills. A maioria dos caminhos percorre um **fluxo principal**, com uma **rampa de entrada** que se junta a ele. O resto é referência ou mecânica de sessão.

## O fluxo principal: ideia → pronta para construir

O caminho que a maior parte do trabalho percorre. Você tem uma ideia e quer que ela seja construída.

1. **`/entrevistar-com-docs`** — afie a ideia por entrevista. Comece aqui sempre que estiver **em um diretório de trabalho**: é stateful, retendo o que aprende em `CONTEXT.md` e ADRs — deixa um rastro de papel, o que o torna a escolha certa sempre que houver um repo para guardar isso.
2. **Você consegue resolver todas as perguntas na conversa?** Se sim, siga em frente.
3. **É uma construção de múltiplas sessões?**
   - **Sim** → **`/transformar-em-spec`** (transforma a thread em uma spec), depois **`/transformar-em-tickets`** para dividi-la em tickets tracer-bullet, cada um declarando suas **arestas de bloqueio**. Num tracker local são um arquivo por ticket em `.scratch/<feature>/issues/`, resolvidos na ordem dos bloqueios; num tracker real as arestas viram links nativos de bloqueio, então qualquer ticket cujos bloqueios terminaram pode ser pego.
   - **Não** → **`/transformar-em-spec`** e siga direto para **`/transformar-em-tickets`** quando a conversa afinar — as tickets são o contrato do trabalho que vem depois.
4. **Implementar** → **`/implement`** planeja: explora o repositório, carrega **`/repasse`** e grava um brief compacto em `.scratch/repasse/`. Depois abra uma **nova seção com `/new`** e execute **`/implement <caminho-do-repasse>.md`** na janela vazia — ela valida o brief, implementa (sem TDD), roda typechecking e testes, revisa com **`/code-review`** e commita.

### Higiene de contexto

Mantenha os passos 1–3 em **uma janela de contexto ininterrupta** — não compacte nem limpe até depois de `/transformar-em-tickets` — para que a entrevista, a spec e as tickets se construam sobre o mesmo raciocínio.

O limite disso é a **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)**: a janela (~150k tokens em modelos de ponta) dentro da qual o modelo ainda raciocina com nitidez. Se uma sessão se aproximar disso antes de `/transformar-em-tickets`, não empurre degradado — `/compact` na fronteira de fase mais próxima e siga (veja Phase boundaries).

## Rampa de entrada

Uma situação inicial que gera trabalho e então se junta ao fluxo principal.

- **Bugs e pedidos se acumulando** → **`/triagem`**. Move issues por papéis de triagem e produz issues prontas para agentes, que depois entram no fluxo.

  Triagem é só para issues **que você não criou** — bug reports, pedidos de feature recebidos, qualquer coisa que chega crua. Tickets que `/transformar-em-tickets` produziu já estão prontas para agentes, então **não passe triagem nelas**.

## Fronteiras de fase

Uma **fase** é um pedaço de trabalho dentro de uma sessão — a entrevista, a especificação, as tickets. Na **fronteira** entre duas delas você tem cinco opções, e escolher entre elas é a decisão mais nebulosa de todo este mapa:

- **Continuar** — permaneça. Não custa nada, não perde nada.
- **`/clear`** — esvazie a janela, quando nada daqui importa para o que vem a seguir.
- **`/repasse`** — escreva um arquivo markdown portátil. Estreito: apenas para um **novo harness**, um **novo diretório**, um **colega**, ou bifurcar uma tarefa lateral **no meio da fase**. O que compra é portabilidade. É também o plano que **`/implement`** gera antes de executar.
- **Subagente** — envie uma tarefa bem delimitada para sua própria janela e receba um relatório de volta.
- **`/compact`** — comprima este contexto e semeie uma sessão nova com ele. O **padrão**, no fundo da árvore, não a primeira opção.

Leia [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md) para a árvore ordenada — as cinco perguntas, o raciocínio por trás de cada ramo, e por que o custo de fonte primária torna **Continuar** a opção a descartar primeiro. Tome a decisão **em** uma fronteira; no meio da fase, continue ou divida o restante em subagentes.

## Referência

- **`/documentos-para-agentes`** — referência para escrever documentos que agentes consomem: skills, AGENTS.md, docs apontados.
