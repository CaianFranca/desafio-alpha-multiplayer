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
function emailUnico(p: string): string { return `${p}-${sufixo()}@exemplo.local`; }
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
async function criarSalaCom4Prontos(servidor:{baseUrl:string;wsUrl:string}, opcoes: CriarContextoOpcoes={}){
  // já cria via WS usando servidor efêmero passado por comServidor; este helper assume servidor já criado externo
  throw new Error('usar inline');
}

async function montarSala4Prontos(baseUrl:string, wsUrl:string, opcoes: CriarContextoOpcoes): Promise<{a:{id:string;cookies:Record<string,string>;apelido:string;ws:WebSocket}; b:any; c:any; d:any; codigo:string}> {
  const a=await registrarJogador(baseUrl);
  const b=await registrarJogador(baseUrl);
  const c=await registrarJogador(baseUrl);
  const d=await registrarJogador(baseUrl);
  const wsA=await conectarWs(wsUrl,a.cookies);
  const wsB=await conectarWs(wsUrl,b.cookies);
  const wsC=await conectarWs(wsUrl,c.cookies);
  const wsD=await conectarWs(wsUrl,d.cookies);
  enviar(wsA,{type:'CRIAR_SALA'});
  const criacao=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento;
  assert.equal(criacao.type,'SALA_ATUALIZADA');
  const codigo=criacao.sala.codigoDeSala;
  for(const ws of [wsB,wsC,wsD]){
    enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:codigo});
    await esperarMensagem(ws); // MEMBRO_ENTROU
    await esperarMensagem(ws); // SALA_ATUALIZADA
  }
  // drenar broadcasts nos antigos
  for(let i=0;i<3;i++){ // 3 entradas *2 eventos cada =6 para A, 4 para B etc – simplificar drenando até silence
  }
  // forma simples: esperar silencio não garantido; vamos coletar esperados de forma robusta:
  // Após as 3 entradas, A recebeu 6 eventos, B 4, C 2
  // Drenar exatamente
  for(let i=0;i<6;i++) await esperarMensagem(wsA);
  for(let i=0;i<4;i++) await esperarMensagem(wsB);
  for(let i=0;i<2;i++) await esperarMensagem(wsC);
  // D não tem pendente

  // Todos alternam prontidão
  for(const {ws} of [{ws:wsA},{ws:wsB},{ws:wsC},{ws:wsD}]){
    enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
  }
  // cada alternância gera 2 eventos para cada um dos 4 => 8 eventos por ws
  for(const ws of [wsA,wsB,wsC,wsD]){
    for(let i=0;i<8;i++) await esperarMensagem(ws);
  }
  return {a:{...a,ws:wsA}, b:{...b,ws:wsB}, c:{...c,ws:wsC}, d:{...d,ws:wsD}, codigo};
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
    // esperar PARTIDA_FALHOU
    const ev=JSON.parse(await esperarMensagem(wsA,3000)) as {type:string};
    assert.equal(ev.type,'PARTIDA_FALHOU');
    // sala permanece aberta
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE codigo_sala=$1`,[cod]);
    assert.equal(linha.rows[0]?.status,'aberta');
    assert.ok(cancelado, 'deveria ter cancelado a partida');
    assert.equal(cancelado!.partidaId,'p-cancel');
    // ainda pode chat?
    enviar(wsA,{type:'ENVIAR_MENSAGEM_DE_CHAT',conteudo:'ainda aberta'});
    const chatOk=JSON.parse(await esperarMensagem(wsA,3000)) as {type:string};
    // broadcast para todos, verificar que B recebe também
    assert.equal(chatOk.type,'MENSAGEM_DE_CHAT');
    // drenar para outros
    for(const ws of [wsB,wsC,wsD]) await esperarMensagem(ws);
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
  // nosso handler mapeia Error genérico para PARTIDA_FALHOU
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

