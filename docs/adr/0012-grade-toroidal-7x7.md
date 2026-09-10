# ADR-0012: Grade 7x7 com Continuidade Toroidal

Status: Aceito
Data: 2026-09-10
Revoga (parcialmente): ADR-0004 (trecho de vizinhança sem wrap)

## Contexto

O ADR-0004 fixou a grade 7x7 com vizinhança ortogonal, e a implementação
descartava as direções que caíam fora da grade (`celulaVizinhaNaBorda` /
`vizinhos` retornavam `null` / filtravam a borda). A issue #260 reportou o
efeito: peças e caminhos na borda não têm continuidade — não iluminam nem
conectam o lado oposto, vagas na borda não atravessam e o peão não cruza de
uma borda à outra.

## Decisão

A grade 7x7 passa a ter **continuidade toroidal**:

- `norte` da linha 0 conecta à linha 6 (e vice-versa);
- `leste` da coluna 6 conecta à coluna 0 (e vice-versa).
- Toda coordenada normaliza com `((coord % 7) + 7) % 7` — não existe "fora":
  iluminação (`vizinhos`), colocação de peça (vagas), movimentação de peões
  e alcance dos monstros atravessam a borda.
- `exigirCelulaNoAlcance` valida apenas inteiros; coordenadas fora de 0–6
  normalizam em vez de rejeitar (`CELULA_NAO_ENCONTRADA` por alcance fica sem
  emissor, mantida no union como legado).
- O raio do Vulto carrega guarda anti-ciclo (visitados por raio): um anel
  toroidal de peças conectadas termina sem duplicadas.
- O espelho do frontend (`contrato.ts`, `interacaoPeoes.ts`) acompanha a
  mesma regra; o servidor segue como autoridade.

## Porquê

- **Coerência de regra**: bordas abertas na borda da grade precisam significar
  o mesmo que no centro — conexão, vaga e movimento.
- **Iluminação sem buracos**: a cruz de iluminação do peão na borda cobre o
  lado oposto, e a limpeza enxerga essa conexão.
- **Determinismo preservado**: o wrap é função pura da coordenada; a ordem
  canônica das direções (norte, leste, sul, oeste) não muda.

## Alternativas consideradas

- **Manter a grade não-toroidal** — rejeitada: é exatamente o bug da #260.
- **Normalizar só no engine, sem o espelho** — rejeitada: highlights de
  destino/vaga divergiriam do servidor na borda.
- **Bordas da grade como paredes (conexão impossível)** — rejeitada: mudaria
  o valor das bordas abertas por posição, criando regra posicional implícita.
