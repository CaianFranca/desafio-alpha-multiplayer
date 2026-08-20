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

### registro_partida

Log de cada partida disputada.

| Coluna                           | Tipo     | Constraints                  | Descricao                    |
|----------------------------------|----------|------------------------------|------------------------------|
| id                               | uuid     | PK, default gen_random_uuid()| Identificador da partida     |
| resultado                        | enum     | NOT NULL                     | 'vitoria' ou 'derrota'       |
| quantidade_de_geradores_ligado   | integer  | NOT NULL                     | Geradores ativados           |
| duracao                          | interval | NOT NULL                     | Duracao da partida           |

### registro_usuarios_partida

Tabela N:N entre jogadores e partidas (historico).

| Coluna              | Tipo | Constraints                   | Descricao         |
|---------------------|------|-------------------------------|--------------------|
| registro_partida_id | uuid | FK -> registro_partida.id, PK | Partida            |
| usuario_id          | uuid | FK -> usuarios.id, PK         | Jogador            |

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
  horizontal
- A migration e a seed estao em TypeScript (.ts), executadas via ts-node
