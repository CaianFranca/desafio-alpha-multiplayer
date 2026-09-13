// Testes de integração — Encaminhamento no lobby-server (issue #48)
// Cobre seam WS com PG+Redis reais e game-server stub via ofertarEncaminhamento injetado.
// Critérios #48: iniciar só do Anfitrião 4 prontos, trava em voo, aceite congela, revalidação cancela, recusa/indisponibilidade/timeout mantém aberta, broadcasts, snapshot, chat bloqueado.

// Reuse harness minimal similar to outros arquivos, mas usando injeção de handoff.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from './teardown.ts';
import type {
  Sala,
  SalaAtualizadaEvento,
  SalaEventoDoServidor,
  MembroDaSala,
} from '@flicker/shared';
import type {
  PartidaPreparandoEvento,
  PartidaDisponivelEvento,
  PartidaRecusadaEvento,
  PartidaFalhouEvento,
  OfertaDeEncaminhamento,
  AceiteDoEncaminhamento,
} from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';
import { criarContextoDasSalas, type CriarContextoOpcoes } from '../src/salas/index.ts';

registrarArquivoDeTeste();
const redis = criarClienteRedis();
const caixas = new WeakMap<WebSocket, { mensagens: string[]; esperas: Array<{ resolver: (r: string) => void; rejeitar: (e: Error) => void }> }>();
let appServ: ReturnType<typeof createApp> | null = null;
let contador = 0;
function sufixo(): string { contador += 1; return `${contador}`; }
function apelidoUnico(p: string): string { return `${p}-${sufixo()}`; }
function emailUnico(p: string): string { return `${p}-${sufixo()}@teste.local`; }
function extrairCookies(res: Response): Record<string,string> {
  const cookies: Record<string,string> = {};
  for (const raw of res.headers.getSetCookie()) {
    const [par] = raw.split(';'); if (!par) continue;
    const eq = par.indexOf('='); if (eq===-1) continue;
    const nome = par.slice(0,eq).trim(); const valor = par.slice(eq+1).trim();
    if (nome==='access_token'||nome==='refresh_token') cookies[nome]=valor;
  }
  return cookies;
}
function headerDeCookies(c: Record<string,string>): string {
  const partes: string[]=[]; if (c.access_token) partes.push(`access_token=${c.access_token}`); if (c.refresh_token) partes.push(`refresh_token=${c.refresh_token}`); return partes.join('; ');
}
async function registrarJogador(baseUrl: string): Promise<{id:string;cookies:Record<string,string>;apelido:string}> {
  const corpo={apelido:apelidoUnico('jogador'),email:emailUnico('jogador'),senha:'senha_dev_123'};
  const res=await fetch(`${baseUrl}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(corpo)});
  const texto=await res.text(); assert.equal(res.status,201,`register falhou: ${texto}`); const j=JSON.parse(texto) as {id:string;apelido:string}; return {id:j.id,cookies:extrairCookies(res),apelido:j.apelido};
}
function conectarWs(wsUrl:string,cookies?:Record<string,string>): Promise<WebSocket> {
  return new Promise((resolve,reject)=>{
    const headers: Record<string,string>={}; const ch=headerDeCookies(cookies??{}); if(ch) headers.Cookie=ch;
    const ws=new WebSocket(wsUrl,{headers} as never);
    const caixa={mensagens:[] as string[],esperas:[] as Array<{resolver:(r:string)=>void;rejeitar:(e:Error)=>void}>};
    caixas.set(ws,caixa);
    ws.on('message',(d)=>{const raw=d.toString(); const e=caixa.esperas.shift(); if(e) e.resolver(raw); else caixa.mensagens.push(raw);});
    ws.on('error',(er)=>{for(const e of caixa.esperas.splice(0)) e.rejeitar(er);});
    const t=setTimeout(()=>{ws.terminate();reject(new Error('timeout conectar WS'));},3000);
    ws.once('open',()=>{clearTimeout(t);resolve(ws);});
    ws.once('error',(er)=>{clearTimeout(t);reject(er);});
    ws.once('close',(c)=>{clearTimeout(t);reject(new Error(`close prematuro ${c}`));});
  });
}
function esperarMensagem(ws: WebSocket, timeoutMs=2000): Promise<string> {
  return new Promise((resolve,reject)=>{
    const caixa=caixas.get(ws)!; const m=caixa.mensagens.shift(); if(m!==undefined){resolve(m);return;}
    const esp={resolver:(r:string)=>{clearTimeout(t);resolve(r);},rejeitar:(e:Error)=>{clearTimeout(t);reject(e);}};
    const t=setTimeout(()=>{const i=caixa.esperas.indexOf(esp); if(i>=0) caixa.esperas.splice(i,1); reject(new Error('timeout mensagem'));},timeoutMs);
    caixa.esperas.push(esp);
  });
}
function enviar(ws:WebSocket,c:object){ws.send(JSON.stringify(c));}
async function esperarTipo(ws:WebSocket, type:string, timeoutMs=3000): Promise<unknown> {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const raw=await esperarMensagem(ws, Math.max(200, deadline-Date.now()));
    const ev=JSON.parse(raw) as {type:string};
    if(ev.type===type) return ev;
    // se não é o esperado, continuar (pode haver SALA_ATUALIZADA antes)
    // mas para simplificar, se buscamos PARTIDA_* e veio SALA_ATUALIZADA, ignorar e continuar
    // guardar outros? para testes que precisam sequenciar, usaremos coletar
  }
  throw new Error(`timeout esperando ${type}`);
}
async function coletarEventos(ws:WebSocket,n:number,timeoutMs=3000):Promise<unknown[]> {
  const evs:unknown[]=[]; for(let i=0;i<n;i++) evs.push(JSON.parse(await esperarMensagem(ws,timeoutMs))); return evs;
}
async function esperarClose(ws:WebSocket,timeoutMs=3000):Promise<void> { return new Promise((res,rej)=>{ const t=setTimeout(()=>{ws.terminate();rej(new Error('timeout close'));},timeoutMs); ws.once('close',()=>{clearTimeout(t);res();}); ws.once('error',(e)=>{clearTimeout(t);rej(e);}); }); }

async function subirServidor(opcoes: CriarContextoOpcoes={}): Promise<{baseUrl:string;wsUrl:string;fechar:()=>Promise<void>}> {
  if(appServ===null) appServ=createApp();
  const app=appServ;
  const server=http.createServer(app);
  const contexto=criarContextoDasSalas(opcoes);
  await contexto.estado.carregar(contexto.repo, contexto.projecao);
  const wss=createWebSocketServer(server,{contextoSalas:contexto});
  await new Promise<void>((res,rej)=>{ server.once('error',rej); server.listen(0,'127.0.0.1',()=>res());});
  const end=server.address() as AddressInfo;
  return {
    baseUrl:`http://127.0.0.1:${end.port}`,
    wsUrl:`ws://127.0.0.1:${end.port}`,
    fechar: async()=>{ for(const c of wss.clients) c.terminate(); await new Promise<void>((res,rej)=>wss.close((e)=>e?rej(e):res())); await new Promise<void>((res,rej)=>server.close((e)=>e?rej(e):res())); }
  };
}
async function comServidor<T>(exec:(s:{baseUrl:string;wsUrl:string})=>Promise<T>, opcoes: CriarContextoOpcoes={}):Promise<T> {
  const s=await subirServidor(opcoes); try{return await exec(s);} finally{await s.fechar();}
}

before(async()=>{
  try{await pool.query('SELECT 1');} catch(e){throw new Error(`Postgres indisponível: ${(e as Error).message}`);}
  try{await redis.connect(); await redis.ping();} catch(e){throw new Error(`Redis indisponível: ${(e as Error).message}`);}
});
after(async()=>{
  try{await redis.quit().catch(()=>{try{redis.disconnect();}catch{}});}catch{try{redis.disconnect();}catch{}}
  await finalizarArquivoDeTeste();
});
beforeEach(async()=>{
  await pool.query(`TRUNCATE TABLE membros_historico, membros, salas_historico, usuarios RESTART IDENTITY CASCADE`);
  await redis.flushdb();
});

// Helpers de sala
interface JogadorDaSala { id: string; cookies: Record<string,string>; apelido: string; ws: WebSocket }

// Monta sala com n membros, sendo os `prontos` primeiros com prontidão alternada.
// Drena os broadcasts de forma determinística (padrão: 2 eventos por entrada/prontidão por cliente conectado).
async function montarSalaNProntos(baseUrl: string, wsUrl: string, n: number, prontos: number = n): Promise<{jogadores: JogadorDaSala[]; codigo: string}> {
  const jogadores: JogadorDaSala[] = [];
  for (let i = 0; i < n; i++) {
    const j = await registrarJogador(baseUrl);
    const ws = await conectarWs(wsUrl, j.cookies);
    jogadores.push({ ...j, ws });
  }
  const wss = jogadores.map((j) => j.ws);
  enviar(wss[0], {type:'CRIAR_SALA'});
  const criacao = JSON.parse(await esperarMensagem(wss[0])) as SalaAtualizadaEvento;
  assert.equal(criacao.type,'SALA_ATUALIZADA');
  const codigo = criacao.sala.codigoDeSala;
  for (let i = 1; i < n; i++) {
    enviar(wss[i], {type:'ENTRAR_NA_SALA', codigoDeSala: codigo});
    await esperarMensagem(wss[i]); // MEMBRO_ENTROU
    await esperarMensagem(wss[i]); // SALA_ATUALIZADA
  }
  // entradas: jogador i (0-index) recebe 2*(n-1-i) broadcasts das entradas seguintes
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2 * (n - 1 - i); k++) await esperarMensagem(wss[i]);
  }
  // prontidões: cada alternância gera 2 eventos para cada um dos n clientes
  for (let i = 0; i < prontos; i++) enviar(wss[i], {type:'ALTERNAR_PRONTIDAO'});
  for (const ws of wss) for (let k = 0; k < 2 * prontos; k++) await esperarMensagem(ws);
  return { jogadores, codigo };
}

function fecharTodos(wss: WebSocket[]): Promise<unknown> {
  for (const ws of wss) ws.close();
  return Promise.all(wss.map((ws) => esperarClose(ws).catch(() => undefined)));
}

test('INICIAR_PARTIDA só aceito do Anfitrião com 4 conectados e prontos', async()=>{
  let ofertado=false;
  const ofertarStub=async (oferta: OfertaDeEncaminhamento): Promise<AceiteDoEncaminhamento>=>{
    ofertado=true;
    assert.equal(oferta.roster.length,4);
    return {partidaId:'partida-1', serverId:'server-1'};
  };
  await comServidor(async (servidor)=>{
    // criar sala com 4 mas só 2 prontos inicialmente para testar rejeição
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    // criar e entrar (reusa lógica)
    enviar(wsA,{type:'CRIAR_SALA'});
    let criacao=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento;
    const codigo=criacao.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:codigo}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    // só A pronto (1 pronto) — tentar iniciar deve falhar ENCAMINHAMENTO_INVALIDO
    enviar(wsA,{type:'ALTERNAR_PRONTIDAO'}); // A pronto
    for(const ws of [wsA,wsB,wsC,wsD]){ for(let i=0;i<2;i++) await esperarMensagem(ws); }
    // tentar iniciar com composição inválida
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    const erro=JSON.parse(await esperarMensagem(wsA)) as {type:string;codigo:string};
    assert.equal(erro.type,'ERRO_DA_SALA');
    assert.equal(erro.codigo,'ENCAMINHAMENTO_INVALIDO');
    assert.equal(ofertado,false, 'não deve ofertar quando composição inválida');
    // tentar por não-anfitrião (B) com composição ainda inválida — deve dar APENAS_ANFITRIAO antes?
    // mas composição inválida também daria erro; para garantir APENAS_ANFITRIAO, deixar composição válida primeiro
    // Tornar todos prontos
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ALTERNAR_PRONTIDAO'}); }
    for(const ws of [wsA,wsB,wsC,wsD]){ for(let i=0;i<6;i++) await esperarMensagem(ws); }
    // agora B (não-anfitrião) tenta iniciar -> APENAS_ANFITRIAO
    enviar(wsB,{type:'INICIAR_PARTIDA'});
    const erro2=JSON.parse(await esperarMensagem(wsB)) as {type:string;codigo:string};
    assert.equal(erro2.type,'ERRO_DA_SALA');
    assert.equal(erro2.codigo,'APENAS_ANFITRIAO');
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('segundo INICIAR_PARTIDA em voo é recusado', async()=>{
  let resolveOferta: (v: AceiteDoEncaminhamento)=>void;
  const promOferta=new Promise<AceiteDoEncaminhamento>((res)=>{resolveOferta=res;});
  const ofertarStub=async (): Promise<AceiteDoEncaminhamento>=> promOferta;
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]){ enviar(ws,{type:'ALTERNAR_PRONTIDAO'}); }
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    // iniciar 1
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    // PARTIDA_PREPARANDO + SALA_ATUALIZADA para todos
    for(const ws of [wsA,wsB,wsC,wsD]){
      const e1=JSON.parse(await esperarMensagem(ws)) as {type:string};
      assert.equal(e1.type,'PARTIDA_PREPARANDO');
      const e2=JSON.parse(await esperarMensagem(ws)) as {type:string};
      assert.equal(e2.type,'SALA_ATUALIZADA');
    }
    // segundo iniciar em voo
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    const erro=JSON.parse(await esperarMensagem(wsA)) as {type:string;codigo:string};
    assert.equal(erro.type,'ERRO_DA_SALA');
    assert.equal(erro.codigo,'DADOS_INVALIDOS');
    // liberar aceite
    resolveOferta!({partidaId:'p1',serverId:'s1'});
    // esperar PARTIDA_DISPONIVEL
    for(const ws of [wsA,wsB,wsC,wsD]){
      const e=JSON.parse(await esperarMensagem(ws,3000)) as {type:string};
      assert.equal(e.type,'PARTIDA_DISPONIVEL');
      const e2=JSON.parse(await esperarMensagem(ws)) as {type:string; sala: Sala};
      assert.equal(e2.type,'SALA_ATUALIZADA');
      assert.equal((e2 as SalaAtualizadaEvento).sala.estado,'encaminhada');
    }
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('aceite conclui: encaminhada, composição congelada, server/partida persistidos e snapshot inclui redirect', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'partida-XYZ', serverId:'server-ABC'});
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws); } // preparando
    // aguardar disponivel
    const evA1=JSON.parse(await esperarMensagem(wsA,3000)) as PartidaDisponivelEvento;
    assert.equal(evA1.type,'PARTIDA_DISPONIVEL');
    assert.equal(evA1.partidaId,'partida-XYZ');
    assert.equal(evA1.serverId,'server-ABC');
    const salaEv=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento;
    assert.equal(salaEv.sala.estado,'encaminhada');
    assert.deepEqual(salaEv.sala.encaminhamento,{serverId:'server-ABC', partidaId:'partida-XYZ'});
    for(const ws of [wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws); }
    // PG persistido
    const linha=await pool.query<{status:string; server_id:string; partida_id:string}>(`SELECT status, server_id, partida_id FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'encaminhada');
    assert.equal(linha.rows[0]?.server_id,'server-ABC');
    assert.equal(linha.rows[0]?.partida_id,'partida-XYZ');
    // chat bloqueado
    enviar(wsB,{type:'ENVIAR_MENSAGEM_DE_CHAT',conteudo:'oi'});
    const erro=JSON.parse(await esperarMensagem(wsB)) as {type:string;codigo:string};
    assert.equal(erro.type,'ERRO_DA_SALA');
    // mutação bloqueada
    enviar(wsB,{type:'ALTERNAR_PRONTIDAO'});
    const erro2=JSON.parse(await esperarMensagem(wsB)) as {type:string;codigo:string};
    assert.equal(erro2.type,'ERRO_DA_SALA');
    // drenar restante disponivel já consumido, garantir que não há mais
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('revalidação no commit cancela Partida e mantém aberta com PARTIDA_FALHOU', async()=>{
  let resolveOferta: (v:AceiteDoEncaminhamento)=>void;
  const prom=new Promise<AceiteDoEncaminhamento>((res)=>{resolveOferta=res;});
  let cancelado:{serverId:string;partidaId:string;motivo:string}|null=null;
  const cancelarStub=async (serverId:string, partidaId:string, motivo:string)=>{ cancelado={serverId,partidaId,motivo}; };
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws);}
    // mudar composição antes do aceite: B tira prontidão
    enviar(wsB,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws); }
    // agora liberar aceite (composição inválida)
    resolveOferta!({partidaId:'p-cancel',serverId:'s-cancel'});
    // esperar PARTIDA_FALHOU (usa esperarTipo para ignorar SALA_ATUALIZADA extra de B3)
    const ev = await esperarTipo(wsA, 'PARTIDA_FALHOU', 3000) as {type:string};
    assert.equal(ev.type,'PARTIDA_FALHOU');
    // sala permanece aberta
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'aberta');
    assert.ok(cancelado, 'deveria ter cancelado a partida');
    assert.equal(cancelado!.partidaId,'p-cancel');
    // ainda pode chat (ignora SALA_ATUALIZADA extra que vem após PARTIDA_FALHOU)
    enviar(wsA,{type:'ENVIAR_MENSAGEM_DE_CHAT',conteudo:'ainda aberta'});
    const chatOk = await esperarTipo(wsA, 'MENSAGEM_DE_CHAT', 3000) as {type:string};
    assert.equal(chatOk.type,'MENSAGEM_DE_CHAT');
    // drenar para outros (pode haver SALA_ATUALIZADA pendente antes do chat em B/C/D)
    for(const ws of [wsB,wsC,wsD]) await esperarTipo(ws, 'MENSAGEM_DE_CHAT', 3000).catch(async () => { await esperarMensagem(ws, 500).catch(()=>undefined); });
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ()=>prom, cancelarPartida: cancelarStub});
});

test('divergência de composição oferta→aceite (#305): saída em-voo cancela Partida e mantém aberta com PARTIDA_FALHOU', async()=>{
  let resolveOferta: (v:AceiteDoEncaminhamento)=>void;
  const prom=new Promise<AceiteDoEncaminhamento>((res)=>{resolveOferta=res;});
  let cancelado:{serverId:string;partidaId:string;motivo:string}|null=null;
  const cancelarStub=async (serverId:string, partidaId:string, motivo:string)=>{ cancelado={serverId,partidaId,motivo}; };
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws);}
    // Divergência de composição: oferta com 4, D sai em-voo (3 restantes seguem prontos/conectados,
    // dentro da faixa 2–4) — o aceite deve recusar por divergência de roster.
    enviar(wsD,{type:'SAIR_DA_SALA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws); }
    // agora liberar aceite (composição 3 válida na faixa, mas diverge da oferta de 4)
    resolveOferta!({partidaId:'p-divergente',serverId:'s-divergente'});
    const ev = await esperarTipo(wsA, 'PARTIDA_FALHOU', 3000) as PartidaFalhouEvento;
    assert.equal(ev.type,'PARTIDA_FALHOU');
    // sala permanece aberta
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'aberta');
    assert.ok(cancelado, 'deveria ter cancelado a partida');
    assert.equal(cancelado!.partidaId,'p-divergente');
    // ainda pode chat
    enviar(wsA,{type:'ENVIAR_MENSAGEM_DE_CHAT',conteudo:'ainda aberta apos divergencia'});
    const chatOk = await esperarTipo(wsA, 'MENSAGEM_DE_CHAT', 3000) as {type:string};
    assert.equal(chatOk.type,'MENSAGEM_DE_CHAT');
    for(const ws of [wsB,wsC]) await esperarTipo(ws, 'MENSAGEM_DE_CHAT', 3000).catch(async () => { await esperarMensagem(ws, 500).catch(()=>undefined); });
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ()=>prom, cancelarPartida: cancelarStub});
});

test('recusa mantém aberta com PARTIDA_RECUSADA', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> { throw {codigo:'ENCAMINHAMENTO_RECUSADO', motivo:'lotado'}; };
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws);}
    const ev=JSON.parse(await esperarMensagem(wsA,3000)) as PartidaRecusadaEvento;
    assert.equal(ev.type,'PARTIDA_RECUSADA');
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'aberta');
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('indisponibilidade (sem game-server) mantém aberta com PARTIDA_RECUSADA', async()=>{
  // sem stub, sem game-servers no Redis => indisponibilidade
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws);}
    const ev=JSON.parse(await esperarMensagem(wsA,4000)) as {type:string};
    assert.equal(ev.type,'PARTIDA_RECUSADA');
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'aberta');
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {});
});

test('timeout/falha mantém aberta com PARTIDA_FALHOU', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> { throw new Error('network timeout'); };
  // nosso handler mapeia Error genérico para PARTIDA_FALHOU (R1)
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws);}
    const ev=JSON.parse(await esperarMensagem(wsA,3000)) as {type:string};
    assert.equal(ev.type,'PARTIDA_FALHOU');
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'aberta');
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('snapshot de reconexão em sala encaminhada inclui encaminhamento (B1)', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'p-recon', serverId:'s-recon'});
  await comServidor(async (servidor)=>{
    const a=await registrarJogador(servidor.baseUrl);
    const b=await registrarJogador(servidor.baseUrl);
    const c=await registrarJogador(servidor.baseUrl);
    const d=await registrarJogador(servidor.baseUrl);
    const wsA=await conectarWs(servidor.wsUrl,a.cookies);
    const wsB=await conectarWs(servidor.wsUrl,b.cookies);
    const wsC=await conectarWs(servidor.wsUrl,c.cookies);
    const wsD=await conectarWs(servidor.wsUrl,d.cookies);
    enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
    for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
    for(let i=0;i<6;i++) await esperarMensagem(wsA);
    for(let i=0;i<4;i++) await esperarMensagem(wsB);
    for(let i=0;i<2;i++) await esperarMensagem(wsC);
    for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarMensagem(ws); await esperarMensagem(ws); }
    // aguardar encaminhada
    for(const ws of [wsA,wsB,wsC,wsD]){ await esperarTipo(ws,'PARTIDA_DISPONIVEL',3000); await esperarTipo(ws,'SALA_ATUALIZADA',3000); }
    // desconectar B (fechar WS) e reconectar via novo WS com mesmo cookie
    wsB.close(); await esperarClose(wsB);
    // janela ainda aberta, reconectar
    const wsB2=await conectarWs(servidor.wsUrl,b.cookies);
    // deve receber MEMBRO_RECONECTADO + SALA_ATUALIZADA com encaminhamento
    const recon = await esperarTipo(wsB2,'MEMBRO_RECONECTADO',3000) as {type:string};
    assert.equal(recon.type,'MEMBRO_RECONECTADO');
    const salaAtu = await esperarTipo(wsB2,'SALA_ATUALIZADA',3000) as SalaAtualizadaEvento;
    assert.equal(salaAtu.sala.estado,'encaminhada');
    assert.deepEqual(salaAtu.sala.encaminhamento,{serverId:'s-recon', partidaId:'p-recon'});
    // também A deve ver reconectado com encaminhamento
    const reconA = await esperarTipo(wsA,'MEMBRO_RECONECTADO',3000).catch(()=>null);
    if (reconA) {
      const salaA = await esperarTipo(wsA,'SALA_ATUALIZADA',3000) as SalaAtualizadaEvento;
      assert.equal(salaA.sala.encaminhamento?.partidaId,'p-recon');
    }
    wsA.close(); wsB2.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB2,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('handoff via HTTP real — game-server fake responde PARTIDA_DISPONIVEL (B2)', async()=>{
  // fake game-server HTTP
  const fake = http.createServer((req,res)=>{
    if (req.method==='POST' && req.url==='/api/encaminhamento') {
      let body=''; req.on('data',c=>body+=c); req.on('end',()=>{
        res.writeHead(200,{'content-type':'application/json'});
        res.end(JSON.stringify({partidaId:'partida-http-1', serverId:'fake-http-1'}));
      });
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(r=>fake.listen(0,'127.0.0.1',()=>r()));
  const addr=fake.address() as AddressInfo;
  const fakeUrl=`http://127.0.0.1:${addr.port}`;
  // registrar no Redis compartilhado (mesmo DB do lobby)
  await redis.set('game-servers:disponiveis:fake-http-1', JSON.stringify({serverId:'fake-http-1', url: fakeUrl}));
  try {
    await comServidor(async (servidor)=>{
      const a=await registrarJogador(servidor.baseUrl);
      const b=await registrarJogador(servidor.baseUrl);
      const c=await registrarJogador(servidor.baseUrl);
      const d=await registrarJogador(servidor.baseUrl);
      const wsA=await conectarWs(servidor.wsUrl,a.cookies);
      const wsB=await conectarWs(servidor.wsUrl,b.cookies);
      const wsC=await conectarWs(servidor.wsUrl,c.cookies);
      const wsD=await conectarWs(servidor.wsUrl,d.cookies);
      enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
      for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
      for(let i=0;i<6;i++) await esperarMensagem(wsA);
      for(let i=0;i<4;i++) await esperarMensagem(wsB);
      for(let i=0;i<2;i++) await esperarMensagem(wsC);
      for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
      for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
      enviar(wsA,{type:'INICIAR_PARTIDA'});
      for(const ws of [wsA,wsB,wsC,wsD]){ await esperarTipo(ws,'PARTIDA_PREPARANDO',3000); await esperarTipo(ws,'SALA_ATUALIZADA',3000); }
      const disp = await esperarTipo(wsA,'PARTIDA_DISPONIVEL',4000) as PartidaDisponivelEvento;
      assert.equal(disp.partidaId,'partida-http-1');
      assert.equal(disp.serverId,'fake-http-1');
      const salaEv = await esperarTipo(wsA,'SALA_ATUALIZADA',3000) as SalaAtualizadaEvento;
      assert.equal(salaEv.sala.estado,'encaminhada');
      assert.deepEqual(salaEv.sala.encaminhamento,{serverId:'fake-http-1', partidaId:'partida-http-1'});
      wsA.close(); wsB.close(); wsC.close(); wsD.close();
      await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
    }, {});
  } finally {
    await redis.del('game-servers:disponiveis:fake-http-1');
    await new Promise<void>(r=>fake.close(()=>r()));
  }
});

test('timeout real via AbortController mantém aberta com PARTIDA_FALHOU (B2/R1)', async()=>{
  const fake = http.createServer((req,res)=>{
    if (req.method==='POST' && req.url==='/api/encaminhamento') {
      // delay > timeoutMs para forçar AbortError
      setTimeout(()=>{
        try { res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({partidaId:'late', serverId:'fake-timeout'})); } catch {}
      }, 800);
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(r=>fake.listen(0,'127.0.0.1',()=>r()));
  const addr=fake.address() as AddressInfo;
  const fakeUrl=`http://127.0.0.1:${addr.port}`;
  await redis.set('game-servers:disponiveis:fake-timeout', JSON.stringify({serverId:'fake-timeout', url: fakeUrl}));
  try {
    await comServidor(async (servidor)=>{
      const a=await registrarJogador(servidor.baseUrl);
      const b=await registrarJogador(servidor.baseUrl);
      const c=await registrarJogador(servidor.baseUrl);
      const d=await registrarJogador(servidor.baseUrl);
      const wsA=await conectarWs(servidor.wsUrl,a.cookies);
      const wsB=await conectarWs(servidor.wsUrl,b.cookies);
      const wsC=await conectarWs(servidor.wsUrl,c.cookies);
      const wsD=await conectarWs(servidor.wsUrl,d.cookies);
      enviar(wsA,{type:'CRIAR_SALA'}); const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento; const cod=cri.sala.codigoDeSala;
      for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:cod}); await esperarMensagem(ws); await esperarMensagem(ws);}
      for(let i=0;i<6;i++) await esperarMensagem(wsA);
      for(let i=0;i<4;i++) await esperarMensagem(wsB);
      for(let i=0;i<2;i++) await esperarMensagem(wsC);
      for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
      for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
      enviar(wsA,{type:'INICIAR_PARTIDA'});
      for(const ws of [wsA,wsB,wsC,wsD]){ await esperarTipo(ws,'PARTIDA_PREPARANDO',3000); await esperarTipo(ws,'SALA_ATUALIZADA',3000); }
      const ev = await esperarTipo(wsA,'PARTIDA_FALHOU',4000) as PartidaFalhouEvento;
      assert.equal(ev.type,'PARTIDA_FALHOU');
      assert.equal(ev.codigo,'ENCAMINHAMENTO_FALHOU');
      const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
      assert.equal(linha.rows[0]?.status,'aberta');
      wsA.close(); wsB.close(); wsC.close(); wsD.close();
      await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
    }, {timeoutMs:300});
  } finally {
    await redis.del('game-servers:disponiveis:fake-timeout');
    await new Promise<void>((r) => fake.close(() => r()));
  }
});

// --- Composição 2 a 4 membros (issue #282) ---

test('INICIAR_PARTIDA aceita com 2 membros conectados e prontos — encaminhada + PARTIDA_DISPONIVEL', async()=>{
  const ofertarStub=async (oferta: OfertaDeEncaminhamento): Promise<AceiteDoEncaminhamento>=>{
    assert.equal(oferta.roster.length,2);
    assert.ok(oferta.roster[0].ordemDeEntrada < oferta.roster[1].ordemDeEntrada);
    return {partidaId:'partida-2p', serverId:'server-2p'};
  };
  await comServidor(async (servidor)=>{
    const {jogadores, codigo} = await montarSalaNProntos(servidor.baseUrl, servidor.wsUrl, 2);
    const [wsA, wsB] = jogadores.map((j)=>j.ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB]){
      const e1=JSON.parse(await esperarMensagem(ws)) as {type:string};
      assert.equal(e1.type,'PARTIDA_PREPARANDO');
      const e2=JSON.parse(await esperarMensagem(ws)) as {type:string};
      assert.equal(e2.type,'SALA_ATUALIZADA');
    }
    for(const ws of [wsA,wsB]){
      const ev=JSON.parse(await esperarMensagem(ws,3000)) as PartidaDisponivelEvento;
      assert.equal(ev.type,'PARTIDA_DISPONIVEL');
      assert.equal(ev.partidaId,'partida-2p');
      assert.equal(ev.serverId,'server-2p');
      const salaEv=JSON.parse(await esperarMensagem(ws)) as SalaAtualizadaEvento;
      assert.equal(salaEv.sala.estado,'encaminhada');
    }
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[codigo]);
    assert.equal(linha.rows[0]?.status,'encaminhada');
    await fecharTodos([wsA,wsB]);
  }, {ofertarEncaminhamento: ofertarStub});
});

test('INICIAR_PARTIDA aceita com 3 membros conectados e prontos — encaminhada + PARTIDA_DISPONIVEL', async()=>{
  const ofertarStub=async (oferta: OfertaDeEncaminhamento): Promise<AceiteDoEncaminhamento>=>{
    assert.equal(oferta.roster.length,3);
    return {partidaId:'partida-3p', serverId:'server-3p'};
  };
  await comServidor(async (servidor)=>{
    const {jogadores, codigo} = await montarSalaNProntos(servidor.baseUrl, servidor.wsUrl, 3);
    const [wsA, wsB, wsC] = jogadores.map((j)=>j.ws);
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    for(const ws of [wsA,wsB,wsC]){
      const e1=JSON.parse(await esperarMensagem(ws)) as {type:string};
      assert.equal(e1.type,'PARTIDA_PREPARANDO');
      const e2=JSON.parse(await esperarMensagem(ws)) as {type:string};
      assert.equal(e2.type,'SALA_ATUALIZADA');
    }
    for(const ws of [wsA,wsB,wsC]){
      const ev=JSON.parse(await esperarMensagem(ws,3000)) as PartidaDisponivelEvento;
      assert.equal(ev.type,'PARTIDA_DISPONIVEL');
      assert.equal(ev.partidaId,'partida-3p');
      const salaEv=JSON.parse(await esperarMensagem(ws)) as SalaAtualizadaEvento;
      assert.equal(salaEv.sala.estado,'encaminhada');
    }
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[codigo]);
    assert.equal(linha.rows[0]?.status,'encaminhada');
    await fecharTodos([wsA,wsB,wsC]);
  }, {ofertarEncaminhamento: ofertarStub});
});

test('INICIAR_PARTIDA com 1 membro recusa ENCAMINHAMENTO_INVALIDO e sala segue aberta', async()=>{
  let ofertado=false;
  const ofertarStub=async (): Promise<AceiteDoEncaminhamento>=>{ ofertado=true; return {partidaId:'p-solo', serverId:'s-solo'}; };
  await comServidor(async (servidor)=>{
    const {jogadores, codigo} = await montarSalaNProntos(servidor.baseUrl, servidor.wsUrl, 1);
    const wsA = jogadores[0].ws;
    enviar(wsA,{type:'INICIAR_PARTIDA'});
    const erro=JSON.parse(await esperarMensagem(wsA)) as {type:string;codigo:string};
    assert.equal(erro.type,'ERRO_DA_SALA');
    assert.equal(erro.codigo,'ENCAMINHAMENTO_INVALIDO');
    assert.equal(ofertado,false,'não deve ofertar com menos de 2 membros');
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[codigo]);
    assert.equal(linha.rows[0]?.status,'aberta');
    await fecharTodos([wsA]);
  }, {ofertarEncaminhamento: ofertarStub});
});

test('5º membro recebe SALA_CHEIA ao tentar entrar (teto de entrada permanece 4)', async()=>{
  await comServidor(async (servidor)=>{
    const {jogadores, codigo} = await montarSalaNProntos(servidor.baseUrl, servidor.wsUrl, 4);
    const quinto=await registrarJogador(servidor.baseUrl);
    const wsE=await conectarWs(servidor.wsUrl,quinto.cookies);
    enviar(wsE,{type:'ENTRAR_NA_SALA',codigoDeSala:codigo});
    const erro=JSON.parse(await esperarMensagem(wsE)) as {type:string;codigo:string};
    assert.equal(erro.type,'ERRO_DA_SALA');
    assert.equal(erro.codigo,'SALA_CHEIA');
    await fecharTodos([...jogadores.map((j)=>j.ws), wsE]);
  }, {});
});

test('3 presentes com 1 pronto: INICIAR_PARTIDA não encaminha e sala segue aberta', async()=>{
  let ofertado=false;
  const ofertarStub=async (): Promise<AceiteDoEncaminhamento>=>{ ofertado=true; return {partidaId:'p-parcial', serverId:'s-parcial'}; };
  await comServidor(async (servidor)=>{
    const {jogadores, codigo} = await montarSalaNProntos(servidor.baseUrl, servidor.wsUrl, 3, 1);
    const wss = jogadores.map((j)=>j.ws);
    enviar(wss[0],{type:'INICIAR_PARTIDA'});
    const erro=JSON.parse(await esperarMensagem(wss[0])) as {type:string;codigo:string};
    assert.equal(erro.type,'ERRO_DA_SALA');
    assert.equal(erro.codigo,'ENCAMINHAMENTO_INVALIDO');
    assert.equal(ofertado,false,'não deve ofertar com presentes > prontos');
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[codigo]);
    assert.equal(linha.rows[0]?.status,'aberta');
    await fecharTodos(wss);
  }, {ofertarEncaminhamento: ofertarStub});
});
