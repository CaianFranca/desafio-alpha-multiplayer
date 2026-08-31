# Flicker of Sanity

Vocabulário de domínio do Flicker of Sanity, jogo cooperativo de tabuleiro digital em que quatro jogadores exploram um sanatório e tentam escapar. Este glossário define os termos canônicos usados nas specs, no código e nas conversas.

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
Reunião criada por um jogador para reunir membros antes de uma partida; aceita até quatro e só pode ser encaminhada à partida com exatamente quatro.
_Avoid_: room, sessão de jogo

**Lobby**:
Área de preparação dentro de uma sala, onde os jogadores se organizam antes de a partida começar.
_Avoid_: sala de espera

**Partida**:
Jogo entre os quatro Jogadores de uma Sala, do Encaminhamento até a vitória ou derrota; estados: preparada, em andamento, terminada.
_Avoid_: jogo, sessão

**Encaminhamento**:
Atividade iniciada pelo Anfitrião que leva uma Sala aberta com quatro Membros conectados e prontos a uma Partida; a composição congela somente quando o game-server aceita, e a recusa ou a falha mantém a Sala aberta.
_Avoid_: handoff, transição

**AFK**:
Jogador conectado, mas inativo durante a partida; pertence ao domínio da partida, não ao lobby.
_Avoid_: ausente, inativo

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
Estado mental dos personagens, degradado pela escuridão e pelos monstros ao longo da partida.
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
Elemento simbólico com cor que marca a posição de um participante sobre uma peça; uma peça aceita no máximo um peão, exceto o Portão de Saída, que aceita até quatro; move-se entre peças conectadas; não é uma Peça.
_Avoid_: pawn, token, boneco

**Conexão**:
Relação entre duas peças vizinhas cujas bordas abertas estão voltadas uma para a outra; condição da movimentação do peão.
_Avoid_: ligação, elo

**Recebimento**:
Peças sorteadas da Caixa que o Jogador recebe, uma para cada borda aberta da peça sob o peão cuja célula vizinha correspondente está vazia; o Jogador escolhe a vaga de cada peça sorteada; quando a Caixa não tem peças suficientes, recebe as restantes; ocorre no início da sequência do peão.
_Avoid_: ganho

**Movimentação**:
Ação de deslocar o peão para uma peça vizinha conectada; encerra a sequência do peão.
_Avoid_: mover, andar

**Permanência**:
Escolha de manter o peão na peça atual; encerra a sequência sem novo recebimento.
_Avoid_: ficar, pular

## Turnos

**Jogador Ativo**:
Jogador com a vez na Partida; apenas ele comanda as ações do seu turno.
_Avoid_: jogador da vez, vez de

**Turno**:
Janela de ação de um Jogador Ativo, da Passagem de Vez anterior ao Encerramento do Turno.
_Avoid_: rodada, vez

**Rodada**:
Sequência completa em que os quatro Jogadores exerceram o turno uma vez.
_Avoid_: ciclo, volta

**Passagem de Vez**:
Evento que encerra o turno de um Jogador e ativa o seguinte na ordem de entrada.
_Avoid_: troca de vez, avanço

**Primeiro Turno**:
Turno de abertura de cada Jogador, em que ele posiciona a própria Peça Inicial e o próprio peão antes dos turnos normais.
_Avoid_: turno inicial, primeira rodada

**Confirmação de Posição**:
Declaração que trava o peão na peça em que terminou e gera o Recebimento quando houve mudança de peça.
_Avoid_: confirmação de movimento, travar posição

**Encerramento do Turno**:
Declaração explícita que conclui o turno e dispara a Passagem de Vez.
_Avoid_: passar a vez, fim de turno

## Objetivos da Partida

**Gerador**:
Peça Especial do sanatório que a equipe deve ativar; fica permanentemente ligado quando a posição de um peão é confirmada sobre ele; a vitória exige três geradores ligados.
_Avoid_: energia, fonte de luz

**Cartão de Acesso**:
Item obtido pela equipe na Sala do Diretor que libera a abertura do Portão de Saída.
_Avoid_: chave, cartão-chave

**Portão de Saída**:
Peça Especial por onde a equipe escapa; os quatro Jogadores devem se reunir nele para vencer; aceita até quatro peões simultaneamente.
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
Condição de vitória acompanhada coletivamente pela equipe: geradores ligados e Cartão de Acesso obtido.

**Peça**:
Componente do tabuleiro posicionado pelos Jogadores durante a exploração; pode reconstruir o caminho do sanatório ou conceder conquistas (Peça Especial).
_Avoid_: tile, bloco
