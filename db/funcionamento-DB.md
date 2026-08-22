# Funcionamento do Banco de Dados — Flicker of Sanity

## Visao Geral

O banco de dados do Flicker of Sanity usa PostgreSQL 17 como write-model
(fonte da verdade) e Redis como projecao de alta frequencia (conforme
ADR-0002). As migrations e seeds sao gerenciadas pelo Knex.js em
TypeScript.

## Esquema Atual

### usuarios

Tabela de cadastro de Usuarios (dominio CONTEXT.md).

| Coluna      | Tipo         | Constraints                  | Descricao                              |
|-------------|--------------|------------------------------|----------------------------------------|
| id          | uuid         | PK, default gen_random_uuid()| Identificador unico do jogador         |
| apelido     | varchar(30)  | NOT NULL, UNIQUE             | Identificacao publica do jogador       |
| email       | varchar(255) | NOT NULL, UNIQUE             | Email do jogador (usado para login)    |
| senha       | text         | NOT NULL                     | Hash da senha (bcrypt/argon2)          |
| criado_em   | timestamptz  | NOT NULL, default now()      | Data de criacao do cadastro            |

### salas_historico

Tabela que cumpre o papel do antigo `registro_partida`: registra cada sala
disputada. Enquanto a sala esta aberta, `resultado` e `duracao` permanecem
nulos; ambos sao preenchidos somente quando a sala e encerrada.

| Coluna       | Tipo                                              | Constraints                              | Descricao                                    |
|--------------|---------------------------------------------------|------------------------------------------|----------------------------------------------|
| id           | uuid                                              | PK, default gen_random_uuid()            | Identificador unico da sala                  |
| codigo_sala  | varchar(6)                                        | NOT NULL, UNIQUE, check ^[A-Z0-9]{6}$    | Codigo de convite da sala                    |
| status       | enum('aberta', 'encaminhada', 'encerrada', 'expirada') | NOT NULL, default 'aberta'          | Estado atual da sala                         |
| anfitriao_id | uuid                                              | NULL, FK -> usuarios.id                  | Jogador que criou a sala (nulo se saiu)      |
| resultado    | enum('vitoria', 'derrota')                        | NULL                                     | Desfecho da sala (preenchido ao encerrar)    |
| duracao      | interval                                          | NULL                                     | Duracao total (preenchida ao encerrar)       |

### membros

Tabela que absorveu o antigo `registro_usuarios_partida` como vinculo N:N
historico entre jogadores e salas. Vinculos encerrados sao preservados via
`motivo_de_termino`, que permanece nulo enquanto o jogador esta ativo na sala.

| Coluna             | Tipo                                                  | Constraints                                        | Descricao                                       |
|--------------------|-------------------------------------------------------|----------------------------------------------------|-------------------------------------------------|
| sala_id            | uuid                                                  | PK composta, FK -> salas_historico.id, ON DELETE CASCADE | Sala da qual o jogador participa         |
| usuario_id         | uuid                                                  | PK composta, FK -> usuarios.id, ON DELETE CASCADE  | Jogador participante                            |
| ordem_de_entrada   | integer                                               | NOT NULL                                           | Posicao de entrada do jogador na sala           |
| motivo_de_termino  | enum('saida', 'expulsao', 'expiracao', 'encerramento')| NULL enquanto o vinculo esta ativo                 | Como o vinculo do jogador com a sala terminou   |

## Esquema Futuro (implantacao posterior)

### lista_amigos

Tabela de relacao N:N entre jogadores para gestao de pedidos de amizade.

| Coluna     | Tipo                                  | Constraints               | Descricao                        |
|------------|---------------------------------------|---------------------------|----------------------------------|
| usuario_fk | uuid                                  | FK -> usuarios.id, PK     | Jogador que envia/recebe         |
| amigo_id   | uuid                                  | FK -> usuarios.id, PK     | Amigo associado                  |
| status     | enum('pendente_recebeu', 'pendente_enviou', 'aceito')             | NOT NULL                  | Estado do pedido                 |

**Regra de negocio:**

Quando um jogador envia um pedido de amizade, duas linhas sao criadas:

- Uma com `usuario_fk` = remetente, `amigo_id` = destinatario, status = 'pendente_enviou'
- Uma com `usuario_fk` = destinatario, `amigo_id` = remetente, status = 'pendente_recebeu'

Ao aceitar, ambas as linhas sao atualizadas para status = 'aceito'.

## Comandos Knex

### Instalar dependencias

```sh
cd db && npm install
```

### Criar nova migration

```sh
npm run migrate:make -- nome_da_migration
```

### Rodar migrations

```sh
npm run migrate:latest
```

### Reverter ultima migration

```sh
npm run migrate:rollback
```

### Rodar seeds

```sh
npm run seed:run
```

## Variaveis de Ambiente

As credenciais de conexao sao lidas do arquivo `.env` na raiz do monorepo
via `dotenv`. Fallback para os valores do docker-compose:

| Variavel        | Default              |
|-----------------|----------------------|
| POSTGRES_HOST   | localhost            |
| POSTGRES_PORT   | 5432                 |
| POSTGRES_USER   | flicker              |
| POSTGRES_PASSWORD | flicker_dev_password |
| POSTGRES_DB     | flicker              |

## Observacoes

- O hash de senha e responsabilidade do backend (bcrypt/argon2), nao do banco
- O Redis e volatile no ambiente local e armazena apenas dados temporarios
  (prontidao, presenca, reconexao)
- Todas as tabelas usam UUID como PK para compatibilidade com distribuicao
  horizontal (exceto `membros`, cuja PK e composta por `sala_id` +
  `usuario_id`)
- A migration e a seed estao em TypeScript (.ts), executadas via ts-node
