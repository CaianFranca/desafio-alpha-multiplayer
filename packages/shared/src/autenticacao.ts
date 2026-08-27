// DTOs de Identidade e Acesso compartilhados via @flicker/shared.
// Vocabulário canônico: Jogador, Cadastro, Apelido, Credenciais, Sessão.
// Apenas type/interface, sem runtime, sem validação, sem dependência de backend.
//
// Fronteira shared (DTO de transporte) vs lobby-server (rotas) vs engine (domínio):
// este arquivo é o contrato HTTP de `/api/auth`. O lobby-server produz e consome
// estas estruturas, e o frontend AuthProvider (issue #27) também as tipa.
// Ver CONTEXT.md (Identidade e Acesso) e openapi.yaml (schemas JogadorResponse,
// CadastroRequest, LoginRequest, ErroResponse).

export interface Jogador {
  id: string;
  apelido: string;
  email: string;
}

export type CampoDeErroDeAutenticacao = 'apelido' | 'email' | 'senha';

export interface ErroAuthItem {
  campo?: CampoDeErroDeAutenticacao;
  mensagem: string;
}

export interface ErroAuth {
  erros: ErroAuthItem[];
}

export interface CadastroPayload {
  apelido: string;
  email: string;
  senha: string;
}

export interface LoginPayload {
  email: string;
  senha: string;
}
