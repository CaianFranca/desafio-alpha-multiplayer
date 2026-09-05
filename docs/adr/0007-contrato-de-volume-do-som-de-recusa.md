# ADR-0007: Contrato de Volume do Som de Recusa

Status: Aceito
Data: 2026-09-05

## Contexto

A spec #228 pedia o som de Recusa da Partida "sempre cheio" (volume máximo).
Durante a implementação (PR #247), o volume foi fixado em `0.3` direto no
ponto de som (`tocarSomDeRecusa`), e o review apontou o literal mágico e o
desvio silencioso da spec como achados (B3): um futuro botão de volume não
teria um contrato explícito para compor, e o motivo do desvio não estava
registrado em lugar algum.

## Decisão

O volume do som de Recusa vive na constante nomeada
`VOLUME_BASE_SOM_DE_RECUSA = 0.3` (`frontend/web/src/components/partida/
somDeRecusa.ts`), sob o contrato:

`audio.volume = master * VOLUME_BASE_SOM_DE_RECUSA`

com `master` em [0, 1] (padrão `1`, sem controle de volume hoje). O futuro
botão de volume controla apenas o `master` neste ponto — sem recostura do
ponto de som, sem tocar na base. O desvio da spec ("sempre cheio") é
consciente, por decisão humana explícita registrada neste ADR.

## Porquê

- **Ponto único**: a Partida tem um só ponto de som de Recusa; a base
  nomeada documenta a intenção (conforto auditivo em recusas repetidas) onde
  ela é aplicada, em vez de um literal solto.
- **Extensão sem recostura**: o botão de volume futuro multiplica o `master`
  pela base, preservando o teto percebido que motivou o 0.3; sons distintos
  por motivo (outra issue) herdam o mesmo contrato trocando valores no mapa
  `SOM_POR_MOTIVO`.
- **Rastro do desvio**: a spec dizia "sempre cheio"; este ADR é o registro
  de que o 0.3 substitui essa exigência por decisão humana, não por acidente.

## Alternativas consideradas

- **Volume cheio (1.0) conforme a spec** — rejeitada por decisão humana
  explícita: recusas repetidas em volume máximo são agressivas, e o botão
  de volume futuro compõe melhor sobre uma base confortável.
- **Literal 0.3 inline** — rejeitada no review (B3): sem nome, sem
  contrato, o próximo ajuste teria que adivinhar a intenção.
