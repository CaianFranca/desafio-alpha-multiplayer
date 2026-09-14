# Flicker of Sanity

Vocabulário de domínio do Flicker of Sanity, jogo cooperativo de tabuleiro digital em que de dois a quatro jogadores exploram um sanatório e tentam escapar. Este glossário define os termos canônicos usados nas specs, no código e nas conversas.

## Pessoas

**Visitante**:
Pessoa que acessa a aplicação sem estar autenticada.
_Avoid_: usuário anônimo, convidado

**Jogador**:
Pessoa autenticada na aplicação, apta a criar salas e participar de partidas.
_Avoid_: usuário, conta, participante

**Membro**:
Jogador associado a uma sala por um vínculo com ordem de entrada, prontidão e presença próprias; o vínculo termina por saída, expulsão, expiração da reconexão ou encerramento da sala.
_Avoid_: participante, jogador da sala

**Anfitrião**:
Membro responsável pela sala; quem a cria assume o papel, que passa circularmente ao membro restante seguinte na ordem de entrada quando o vínculo do anfitrião termina.
_Avoid_: proprietário, dono, host

## Identidade e Acesso

**Cadastro**:
Registro persistente que liga Apelido, email e Credenciais a um Jogador.
_Avoid_: conta, registro, account

**Apelido**:
Identificação pública única de um Jogador.
_Avoid_: username, nick, nome de usuário, nome de exibição, tag

**Credenciais**:
Conjunto de email e senha que um Jogador usa para se autenticar.
_Avoid_: dados de acesso, login

**Sessão**:
Vínculo de autenticação de um Jogador; no máximo uma ativa por Jogador; termina por logout, novo login ou expiração.
_Avoid_: login ativo, conexão

## Partidas

**Sala**:
Reunião criada por um jogador para reunir membros antes de uma partida; aceita até quatro e só pode ser encaminhada à partida com de 2 a 4 membros, todos conectados e prontos.
_Avoid_: room, sessão de jogo

**Lobby**:
Área de preparação dentro de uma sala, onde os jogadores se organizam antes de a partida começar.
_Avoid_: sala de espera

**Partida**:
Jogo entre os 2 a 4 Jogadores de uma Sala, do Encaminhamento até a vitória ou derrota; estados: preparada, em andamento, terminada.
_Avoid_: jogo, sessão

**Resultado**:
Vitória, derrota ou não-início declarados no término ou cancelamento da Partida; em evento simultâneo das condições, a vitória tem prioridade, exceto o quórum mínimo — um Jogador restante após desistências encerra em derrota por desistência.
_Avoid_: desfecho, fim de jogo

**Desistência**:
Ato irreversível de um Jogador em Partida em andamento; só o próprio Jogador desiste, no próprio turno ou fora dele. Remove o peão (liberando a célula) e a vez da ordem — com Passagem de Vez imediata se era o Jogador Ativo —, recalcula a Iluminação com os restantes e aplica a Limpeza no ato; a vitória é re-avaliada com os N−1 peões no Portão (+ 3 Geradores + Cartão) e, quando resta 1, a Partida termina em derrota. Queda de conexão sem desistência continua voltável, sem expiração.
_Avoid_: abandono, saída da partida

**Partida Não Iniciada**:
Cancelamento de Partida preparada sem completar a admissão dos 2 a 4 Jogadores; com todos desconectados libera em 10s, com admissão parcial libera no teto de 90s; encerra conexões com PARTIDA_NAO_INICIADA e avisa o lobby para reabrir a Sala.
_Avoid_: abandono, timeout

**Partida Órfã**:
Sala encaminhada cuja Partida preparada foi cancelada, expirou ou está com todos em reconexão; libera SAIR_DA_SALA e ENTRAR_NA_SALA em nova Sala.
_Avoid_: sala fantasma, sala presa

**Retorno à Sala**:
Volta dos Jogadores à Sala de origem após o término da Partida — incluindo a derrota por desistência, pelos restantes —; a Sala reabre com os Membros restantes (1..N-1 do roster ativo), mantendo a ordem de entrada, com sucessão do Anfitrião quando o vínculo do anfitrião termina e a Prontidão redefinida. Cada Desistência da Partida mapeia para uma Saída do vínculo (`saida`) com histórico; sem Desistências, reabre com os mesmos Membros.
_Avoid_: retorno ao lobby, volta ao lobby

**Encaminhamento**:
Atividade iniciada pelo Anfitrião que leva uma Sala aberta com de 2 a 4 Membros conectados e prontos a uma Partida; a composição congela somente quando o game-server aceita, e a recusa ou a falha mantém a Sala aberta.
_Avoid_: handoff, transição

**AFK**:
Jogador conectado, mas inativo durante a partida; pertence ao domínio da partida, não ao lobby.
_Avoid_: ausente, inativo

**Conexão à Partida**:
Vínculo em tempo real entre um Jogador e o serviço da partida, pelo qual o Jogador percebe o estado da partida e envia Ações; a identidade do Jogador é derivada da Sessão autenticada do vínculo; em duplicidade, a conexão anterior é encerrada.
_Avoid_: conexão, socket, canal

**Ação**:
Comando de jogo emitido por um Jogador pela Conexão à Partida e julgado pelo serviço da partida, resultando em Aprovação ou Recusa.
_Avoid_: comando, input, jogada

**Aprovação**:
Julgamento positivo de uma Ação: aplica a mudança ao estado da partida e a reflete a todos os Jogadores conectados em tempo real.
_Avoid_: validação, aceite

**Recusa**:
Julgamento negativo de uma Ação: o estado da partida não muda e o feedback vai apenas ao autor.
_Avoid_: rejeição, erro

## Salas e Presença

**Código de Sala**:
Identificação curta e digitável de uma Sala; seis caracteres alfanuméricos maiúsculos, fixa enquanto a Sala existir.
_Avoid_: código de convite, código

**Convite**:
Link compartilhável que embute o Código de Sala; qualquer Membro pode compartilhá-lo.
_Avoid_: invite, link de convite

**Presença**:
Estado de conectividade de um Membro: conectado ou em reconexão.
_Avoid_: ativo, ausente, online

**Reconexão**:
Janela em que um Membro desconectado preserva seu vínculo, vaga, ordem, prontidão e papel; ao expirar, o vínculo termina.

**Expulsão**:
Término imediato do vínculo de um Membro, decidido pelo Anfitrião e comunicado ao expulso e aos demais; o Jogador expulso fica impedido de reentrar na Sala até o Anfitrião desbloqueá-lo.

**Prontidão**:
Declaração individual de um Membro de que está preparado para o encaminhamento da sala à partida.

**Estado da Sala**:
Situação da sala em seu ciclo de vida: aberta, encaminhada, encerrada ou expirada; uma sala vazia é encerrada quando o último vínculo termina por saída ou expulsão, e expirada quando termina por expiração da reconexão.

## Mundo do Jogo

**Sanatório**:
Local onde a partida acontece — o Sanatório Flicker of Sanity, cenário abandonado e perigoso que a equipe explora.
_Avoid_: hospital, asilo

**Sanidade**:
Estado mental dos personagens, degradado pelos monstros ao longo da partida; cada Jogador inicia a partida com 3 pontos, com piso em zero.
_Avoid_: saúde mental, lucidez

**Ambiente de Jogo**:
Cena visual da partida — background, mesa, iluminação e câmera — exibida em tela cheia sob a moldura.
_Avoid_: cena, tela de jogo

**Mesa**:
Plataforma do Ambiente de Jogo que serve de base de apoio ao tabuleiro e aos demais componentes do jogo; superfície lisa e sem textura.
_Avoid_: plataforma, base, mesa de jogo

## Tabuleiro e Peças

**Tabuleiro**:
Componente central da partida, posicionado sobre a mesa; controla a grade de células, a vizinhança, a ocupação das células e valida as ações.
_Avoid_: board, mapa

**Célula**:
Unidade da grade do tabuleiro; pode estar vazia ou ocupada por uma peça.
_Avoid_: casa, quadrado, slot

**Vizinhança**:
Relação entre células que compartilham uma borda; células diagonais não são vizinhas.
_Avoid_: adjacência

**Iluminação**:
Conjunto de células iluminadas pelos peões do tabuleiro: a célula de cada peão unida às células da sua Vizinhança; independe de Conexões e é compartilhada por todos os Jogadores.
_Avoid_: área visível, luz

**Limpeza**:
Mecânica do tabuleiro que remove permanentemente as peças cujas células ficaram fora da Iluminação; aplicada individualmente no turno do Jogador Ativo, no máximo uma vez, quando a Iluminação muda; as células das peças removidas ficam livres.
_Avoid_: faxina, purge

**Borda Aberta**:
Lado de uma peça com conexão externa aberta, definido pelo tipo e pela orientação da peça.
_Avoid_: lado aberto, saída

**Orientação**:
Estado de rotação de uma peça em passos discretos de 90 graus, determinando quais bordas ficam abertas.
_Avoid_: rotação, ângulo

**Peça Inicial**:
Tipo de peça com duas bordas adjacentes abertas.
_Avoid_: peça de começo

**Peça de Caminho**:
Categoria de peça que reconstrói os caminhos do sanatório: reta (duas bordas opostas abertas), T (três bordas abertas) e cruz (quatro bordas abertas).
_Avoid_: tile de caminho

**Caixa**:
Fonte única e finita de peças da partida, representada sobre a mesa; composta e embaralhada no início da partida, fornece as peças do Recebimento por sorteio, sem reposição.
_Avoid_: pilha, estoque, banco, reserva

**Sorteio**:
Retirada de uma peça da Caixa pelo serviço da partida, uma a uma, visível a todos os Jogadores.

**Bandeja**:
Recipiente de slot único adjacente à Caixa que exibe a Peça Corrente do Jogador Ativo; visível a todos, mas somente o dono do ciclo pode manuseá-la.
_Avoid_: fila, bandeja de sorteio, dock

**Peça Corrente**:
Única peça sorteada exibida na Bandeja, correspondente à primeira pendência de Recebimento ainda sem vaga; uma por vez, do sorteio ao encaixe.
_Avoid_: peça da vez, fila de sorteio

**Puxar**:
Gesto de interação que retira a Peça Corrente da Bandeja para habilitar a escolha de sua vaga; estado visual local do Jogador, consumido quando a peça recebe vaga e selecionada para o encaixe.
_Avoid_: selecionar peça, arrastar, pegar

**Embaralhamento**:
Ordenação aleatória da Caixa no início da partida.

**Composição**:
Conjunto de peças que formam a Caixa no início da partida.

**Esgotamento**:
Estado da Caixa sem peças restantes; nenhum Recebimento acontece enquanto durar.

**Peça Especial**:
Categoria de peça com quatro bordas abertas que não reconstrói caminhos e concede conquistas; tipos: Gerador, Sala do Diretor, Sala Médica e Portão de Saída.
_Avoid_: peça de objetivo

**Posicionamento**:
Ação de encaixar uma peça em uma célula vazia do tabuleiro.
_Avoid_: colocar, instalar

**Encaixe**:
Resultado do posicionamento: a peça assentada na célula, sem física ou colisão.
_Avoid_: snap, encaixe físico

**Manipulação**:
Janela após o encaixe em que a peça ainda pode ser girada na célula; a janela também se encerra na Passagem de Vez.
_Avoid_: ajuste, edição

**Finalização**:
Evento que encerra a manipulação de uma peça: nova seleção, novo posicionamento ou clique na própria peça posicionada.
_Avoid_: confirmação, travar

## Peões e Conexões

**Peão**:
Elemento simbólico com cor que marca a posição de um participante sobre uma peça; uma peça aceita no máximo um peão, exceto o Portão de Saída, que aceita até N (o número de Jogadores da Partida, de 2 a 4), e a peça com jogador precisando de Resgate, que aceita um peão a mais enquanto houver afetado nela; move-se entre peças conectadas; não é uma Peça.
_Avoid_: pawn, token, boneco

**Conexão**:
Relação entre duas peças vizinhas cujas bordas abertas estão voltadas uma para a outra; condição da movimentação do peão.
_Avoid_: ligação, elo

**Recebimento**:
Peças sorteadas da Caixa que o Jogador recebe, uma para cada borda aberta da peça sob o peão cuja célula vizinha correspondente está vazia; o Jogador escolhe a vaga de cada peça sorteada e a encaixa conectada à peça sob o peão, uma por uma; quando a Caixa não tem peças suficientes, recebe as restantes; ocorre no início da sequência do peão; com a peça puxada na bandeja, pontinhos brancos indicam as vagas onde ela pode ser colocada (somem ao posicionar).
_Avoid_: ganho

**Movimentação**:
Ação de deslocar o peão para uma peça vizinha conectada; encerra a sequência do peão.
_Avoid_: mover, andar

**Permanência**:
Escolha de manter o peão na peça atual; encerra a sequência sem novo recebimento; vedada após atravessar o Escuro no turno (o mover para a peça colocada é compulsório).
_Avoid_: ficar, pular

**Travessia do Escuro** (ADR-0017, ADR-0018):
Jogada exclusiva de Baixa Iluminação em que o peão alcança uma célula escura vazia vizinha conectada à peça sob ele; saca 1 peça sob demanda (sem sorteio no início do turno) com a célula-alvo pré-fixada, seguida de encaixe e movimento compulsório para a peça colocada, com fechamento automático (mover → confirmar → encerrar, sem clique); uma por turno e somente da Peça do início do turno ("uma casa por turno" — portar a outra peça iluminada não reabre a vaga; voltar à origem mantém a vaga) — inclusive quando a peça sacada é Monstro: o Monstro não aceita peão, o mover compulsório é impossível e o turno travado fecha por Permanência. Aposta às cegas (a célula é escolhida antes de conhecer a peça); pouso obrigatório guardado na Confirmação (confirmar sem pisar na peça é rejeitado; com Monstro, só Permanência fecha); o Monstro da aposta ataca antes de ser varrido pela Limpeza do próprio fechamento; cadeia retomada sozinha pós-readmissão, com botão Confirmar de segurança se o auto falhar.
_Avoid_: explorar o escuro, puxar no escuro

**Desseleção**:
Ato de encerrar a seleção vigente do peão via comando autoritativo ao servidor, que confirma com evento idempotente; sem ela a seleção obsoleta segue suprimindo o posicionamento da Peça Inicial.
_Avoid_: desseleção local, limpar seleção no cliente

## Turnos

**Jogador Ativo**:
Jogador com a vez na Partida; apenas ele comanda as ações do seu turno.
_Avoid_: jogador da vez, vez de

**Turno**:
Janela de ação de um Jogador Ativo, da Passagem de Vez anterior ao Encerramento do Turno.
_Avoid_: rodada, vez

**Rodada**:
Sequência completa em que todos os Jogadores da Partida (2 a 4) exerceram o turno uma vez.
_Avoid_: ciclo, volta

**Passagem de Vez**:
Evento que encerra o turno de um Jogador e ativa o seguinte na ordem de entrada.
_Avoid_: troca de vez, avanço

**Primeiro Turno**:
Turno de abertura de cada Jogador, em que ele posiciona a própria Peça Inicial e o próprio peão antes dos turnos normais.
_Avoid_: turno inicial, primeira rodada

**Confirmação de Posição**:
Declaração que trava o peão na peça em que terminou, gera o Recebimento quando houve mudança de peça e compromete o Resgate quando o confirmador co-ocupa peça com afetado.
_Avoid_: confirmação de movimento, travar posição

**Encerramento do Turno**:
Declaração explícita que conclui o turno e dispara a Passagem de Vez.
_Avoid_: passar a vez, fim de turno

## Monstros e Estados

**Monstro**:
Peça de Monstro que ameaça os jogadores durante a partida; tipos: O Vulto e O Espectro.
_Avoid_: criatura, inimigo

**Peça de Monstro**:
Categoria de peça com quatro bordas abertas e sem janela de Manipulação, que não aceita peão e retransmite o Alcance como qualquer peça; a Composição inclui seis de cada tipo; com modelo 3D sobre a base inalterada (vulto/espectro) — o clique no modelo equivale ao clique na peça.
_Avoid_: peça de criatura

**Alcance**:
Área efetiva de ataque de um Monstro a partir de sua peça: linhas retas ortogonais encadeadas por Conexões no Vulto; peças adjacentes conectadas no Espectro.
_Avoid_: área de ataque, visão

**Ataque**:
Evento avaliado por Monstro quando a Peça decidida do peão do Jogador Ativo (confirmada, mantida ou posicionada) entra, sai ou permanece no Alcance dele; disparam a Confirmação de Posição com troca, a Permanência e o posicionamento do peão no Primeiro Turno (como entrada); fora→fora é silêncio e só os Monstros envolvidos atacam; atinge todos os peões dentro do Alcance dos envolvidos e é negado pela Proteção.
_Avoid_: golpe, dano, ofensiva

**O Vulto**:
Monstro cujo Alcance segue linhas retas ortogonais encadeadas por Conexões, independentemente da distância, e impõe Baixa Iluminação a quem é atingido.
_Avoid_: sombra, entidade

**O Espectro**:
Monstro cujo Alcance cobre as peças adjacentes conectadas e faz quem é atingido perder 1 ponto de Sanidade.
_Avoid_: fantasma, espírito

**Baixa Iluminação**:
Estado de um Jogador imposto pelo ataque do Vulto; seu peão ilumina apenas a própria célula e seu Recebimento fica reduzido a uma peça, sacada somente sob demanda na Travessia do Escuro (sem sorteio no início do turno); no turno em Baixa o jogador pode mover por caminho iluminado sem saque (ida-e-volta livre: voltar à Peça do início do turno reabre a Permanência e as vagas escuras), atravessar o escuro (uma casa por turno — só da Peça de início do turno, com mover compulsório e fechamento automático) ou permanecer; a fase viaja no snapshot (atravessouNoTurno/pecaDaTravessiaId) para a re-admissão não órfã a entrega; encerrado apenas pelo Resgate.
_Avoid_: escuridão, luz baixa

**Amedrontado**:
Estado de um Jogador com a Sanidade em zero; não realiza ações no seu turno; encerrado pelo Resgate, que restaura a Sanidade a 2 pontos (teto 3).
_Avoid_: apavorado, em pânico

**Resgate**:
Chegada do peão de um aliado, por Conexão, à peça de um jogador em Baixa Iluminação ou Amedrontado, seguida de Confirmação de Posição do salvador na mesma peça; só a confirmação remove os estados do afetado — o Amedrontado sai sempre (Sanidade a 2 pontos, teto 3), mas a Baixa Iluminação só apaga com o salvador de vela acesa (fora da Baixa); abandonar sem confirmar não salva; a peça tolera um peão a mais enquanto houver afetado e fica com a Permanência bloqueada até um peão sair.
_Avoid_: salvamento, cura

## Objetivos da Partida

**Gerador**:
Peça Especial do sanatório que a equipe deve ativar; fica permanentemente ligado quando a posição de um peão é confirmada sobre ele; a vitória exige três geradores ligados.
_Avoid_: energia, fonte de luz

**Cartão de Acesso**:
Item obtido pela equipe na Sala do Diretor; componente do Objetivo Global.
_Avoid_: chave, cartão-chave

**Portão de Saída**:
Peça Especial por onde a equipe escapa; a vitória exige os N peões da Partida (2 a 4) reunidos nele; aceita até N peões simultaneamente.
_Avoid_: saída, porta

**Sala do Diretor**:
Peça Especial que concede o Cartão de Acesso quando a posição de um peão é confirmada sobre ela.

**Sala Médica**:
Peça Especial que concede Proteção contra o próximo ataque de monstro quando a posição de um peão é confirmada sobre ela.

**Proteção**:
Estado de um Jogador que nega o próximo ataque de monstro; não acumulável; permanece até ser consumida.

**Conquista**:
Efeito imediato concedido quando a posição de um peão é confirmada sobre uma Peça Especial.

**Objetivo Global**:
Condição de vitória acompanhada coletivamente pela equipe: geradores ligados, Cartão de Acesso obtido e os N peões da Partida (2 a 4) reunidos no Portão de Saída.

**Peça**:
Componente do tabuleiro posicionado pelos Jogadores durante a exploração; pode reconstruir o caminho do sanatório ou conceder conquistas (Peça Especial).
_Avoid_: tile, bloco

## Depuração

**Modo Desenvolvedor**:
Ferramenta escondida de diagnóstico do frontend, ativada por 5 cliques em até 3s no logo Ginga do footer; sobre um painel (PainelDeDepuração) que exibe em tempo real os logs capturados desde o boot (console, erros, boundaries, tráfego WS e linhas espelhadas do lobby-server/game-server quando o stream de debug está ligado), com marcadores de fase (login, registro, sala, turno por jogador) como fundo histórico das linhas. O modo sobrevive a reload e pode ser desligado pelo botão Desligar; esconder o painel não interrompe a captura nem o stream. Qualquer Jogador autenticado pode ativar o stream e recebe apenas linhas do próprio escopo (própria Sala no lobby, própria Partida no game-server) — risco aceito (ADR-0015).
_Avoid_: modo debug, console escondido, painel de logs
