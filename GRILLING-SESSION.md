# Roteiro da Entrevista

Conduza uma conversa única para transformar um item do backlog em decisões de
produto e técnica prontas para virar spec e tickets.

## Resultado esperado

Ao final, o grupo deve ter:

- problema, objetivo e comportamento esperado compreendidos;
- decisões de produto confirmadas pelo PO;
- viabilidade, riscos e dependências técnicas discutidos;
- decisões essenciais resolvidas;
- spec e tickets publicados;
- bloqueios entre tickets registrados.

Se uma decisão essencial continuar aberta, resolva-a antes de criar os tickets
que dependem dela.

## Preparação

### Item

O PO define a prioridade. O Scrum Master verifica se o objetivo está claro,
reúne as pessoas necessárias e conduz um item por vez.

### Formato

- Todos participam da mesma conversa.
- O Scrum Master é o driver recomendado.
- O grupo discute; o driver registra uma resposta consolidada.
- O PO valida decisões de produto durante a entrevista.
- Os devs avaliam riscos e viabilidade técnica.

Não faça uma entrevista separada para cada participante.

### Documentos

O driver consulta antes de começar:

- [`WORKFLOW.md`](WORKFLOW.md);
- `CONTEXT.md`, se existir;
- ADRs relevantes em [`docs/adr/`](docs/adr/);
- o `AGENTS.md` da área técnica envolvida.

Arquivos opcionais ausentes não interrompem a sessão. Registre uma lacuna
somente se ela impedir uma decisão necessária.

## Papéis

### PO

Define o problema, público afetado, comportamento esperado, prioridade,
critério de sucesso e itens fora do escopo. Confirma ou corrige cada decisão de
produto.

### Scrum Master

Conduz a sessão, controla o tempo, organiza a discussão e registra a resposta
consolidada. Também executa as skills de spec e tickets na mesma seção e
registra falhas de publicação.

Não decide sozinho o escopo e não inventa tickets para contornar bloqueios.

### Devs

Avaliam viabilidade, riscos, dependências, restrições, contratos e impactos nos
serviços. Sugerem alternativas e ajudam a definir critérios verificáveis.

A discussão técnica deve apoiar uma decisão, não detalhar cada arquivo ou
antecipar a implementação.

## Condução

Cada round segue este ciclo:

```text
pergunta
  -> discussão do grupo
  -> resposta consolidada pelo driver
  -> confirmação ou correção do PO
  -> próxima pergunta
```

Durante o round:

1. O agente faz a pergunta.
2. O grupo discute.
3. O driver registra uma resposta única e compreensível.
4. O PO confirma ou corrige a decisão de produto.
5. Os devs apontam riscos ou decisões técnicas pendentes.

Só avance quando estiverem claros o comportamento, as fronteiras e as
restrições necessárias para criar a spec. Não é preciso definir arquivos ou
linhas de código.

## Divergências

- O PO decide o resultado de produto.
- Os devs orientam sobre viabilidade técnica.
- O Scrum Master organiza a discussão e registra a decisão.
- Uma decisão essencial em aberto bloqueia os tickets dependentes.

Não force uma resposta para encerrar a sessão. Registre a pendência, envolva as
pessoas certas e resolva-a antes de continuar.

## Da entrevista aos tickets

Com as decisões essenciais confirmadas, o Scrum Master executa na mesma seção:

1. `/transformar-em-spec`
2. `/transformar-em-tickets`

A spec deve incluir problema, solução, histórias de usuário, decisões de
implementação no nível adequado, testes, escopo excluído e restrições.

Antes de publicar, confira se cada ticket:

- entrega um comportamento verificável;
- cabe em uma seção de implementação;
- pertence a uma única área de entrega;
- declara somente bloqueios necessários;
- permite trabalho paralelo quando possível.

Não faça uma nova entrevista entre a conversa, a spec e os tickets.

Decisões duradouras de domínio ou arquitetura podem atualizar `CONTEXT.md` ou
gerar um ADR. A spec e os tickets descrevem o trabalho atual e são publicados
no GitHub Issues.

## Encerramento

- [ ] O item do backlog foi identificado.
- [ ] Problema, objetivo e comportamento foram entendidos.
- [ ] O PO confirmou as decisões de produto.
- [ ] Restrições e dependências técnicas relevantes foram registradas.
- [ ] As decisões essenciais foram resolvidas.
- [ ] A spec foi publicada.
- [ ] Os tickets e seus bloqueios foram publicados.
- [ ] Falhas de publicação foram registradas com pendências explícitas.

Com a checklist concluída, encerre a seção. Para o próximo item, abra uma nova
seção limpa.

## Evite

- entrevistas separadas por participante;
- respostas individuais em vez de uma decisão consolidada;
- PO sem validar decisões de produto;
- implementação prematura;
- Scrum Master decidindo sozinho o produto ou inventando escopo;
- mistura de itens do backlog;
- limpeza de contexto antes da publicação da spec e dos tickets;
- publicação incompleta sem pendência explícita.
