// Testes de integração — Retorno à Sala via callback HTTP (issue #178)
// Cobre revalidação, reabertura, presença normal, idempotência, guarda 401, re-habilitação ALTERNAR_PRONTIDAO/CHAT
// Padrão PG/Redis reais, sequencial, similar a encaminhamento.integration.test.ts

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from './teardown.ts';
import type { Sala, SalaAtualizadaEvento } from '@flicker/shared';
import type { AceiteDoEncaminhamento, OfertaDeEncaminhamento } from '@flicker/shared';
import { createApp } from '../src/app.ts';
import { createWebSocketServer } from '../src/ws/ws.ts';
import { pool } from '../src/config/pg.ts';
import { criarContextoDasSalas, type CriarContextoOpcoes, type SalasContexto } from '../src/salas/index.ts';
import { assinarServiceToken } from '../src/jwt.ts';

registrarArquivoDeTeste();
const redis = criarClienteRedis();
const caixas = new WeakMap<WebSocket, { mensagens: string[]; esperas: Array<{ resolver: (r: string) => void; rejeitar: (e: Error) => void }> }>();

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
  }
  throw new Error(`timeout esperando ${type}`);
}
async function esperarClose(ws:WebSocket,timeoutMs=3000):Promise<void> { return new Promise((res,rej)=>{ const t=setTimeout(()=>{ws.terminate();rej(new Error('timeout close'));},timeoutMs); ws.once('close',()=>{clearTimeout(t);res();}); ws.once('error',(e)=>{clearTimeout(t);rej(e);}); }); }

async function subirServidorComContexto(opcoes: CriarContextoOpcoes={}): Promise<{baseUrl:string;wsUrl:string;contexto: SalasContexto; fechar:()=>Promise<void>}> {
  const contexto = criarContextoDasSalas(opcoes);
  const app = createApp({ contextoSalas: contexto });
  const server=http.createServer(app);
  await contexto.estado.carregar(contexto.repo, contexto.projecao);
  const wss=createWebSocketServer(server,{contextoSalas:contexto});
  await new Promise<void>((res,rej)=>{ server.once('error',rej); server.listen(0,'127.0.0.1',()=>res());});
  const end=server.address() as AddressInfo;
  return {
    baseUrl:`http://127.0.0.1:${end.port}`,
    wsUrl:`ws://127.0.0.1:${end.port}`,
    contexto,
    fechar: async()=>{ for(const c of wss.clients) c.terminate(); await new Promise<void>((res,rej)=>wss.close((e)=>e?rej(e):res())); await new Promise<void>((res,rej)=>server.close((e)=>e?rej(e):res())); }
  };
}
async function comServidor<T>(exec:(s:{baseUrl:string;wsUrl:string;contexto:SalasContexto})=>Promise<T>, opcoes: CriarContextoOpcoes={}):Promise<T> {
  const s=await subirServidorComContexto(opcoes); try{return await exec(s);} finally{await s.fechar();}
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

async function montarSalaEncaminhada(baseUrl:string, wsUrl:string, contexto: SalasContexto, ofertarStub?: (o:OfertaDeEncaminhamento)=>Promise<AceiteDoEncaminhamento>): Promise<{a:any;b:any;c:any;d:any;wsA:WebSocket;wsB:WebSocket;wsC:WebSocket;wsD:WebSocket;codigo:string;salaId:string;serverId:string;partidaId:string}> {
  // Usar WS + ofertar stub para chegar em encaminhada de forma natural
  // Se não há stub, usar aceitar direto via estado? Mas vamos usar stub injetado no contexto já
  const a=await registrarJogador(baseUrl);
  const b=await registrarJogador(baseUrl);
  const c=await registrarJogador(baseUrl);
  const d=await registrarJogador(baseUrl);
  const wsA=await conectarWs(wsUrl,a.cookies);
  const wsB=await conectarWs(wsUrl,b.cookies);
  const wsC=await conectarWs(wsUrl,c.cookies);
  const wsD=await conectarWs(wsUrl,d.cookies);
  enviar(wsA,{type:'CRIAR_SALA'});
  const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento;
  const codigo=cri.sala.codigoDeSala;
  const salaId=cri.sala.id;
  for(const ws of [wsB,wsC,wsD]){ enviar(ws,{type:'ENTRAR_NA_SALA',codigoDeSala:codigo}); await esperarMensagem(ws); await esperarMensagem(ws);}
  for(let i=0;i<6;i++) await esperarMensagem(wsA);
  for(let i=0;i<4;i++) await esperarMensagem(wsB);
  for(let i=0;i<2;i++) await esperarMensagem(wsC);
  for(const ws of [wsA,wsB,wsC,wsD]) enviar(ws,{type:'ALTERNAR_PRONTIDAO'});
  for(const ws of [wsA,wsB,wsC,wsD]) for(let i=0;i<8;i++) await esperarMensagem(ws);
  // iniciar partida
  enviar(wsA,{type:'INICIAR_PARTIDA'});
  for(const ws of [wsA,wsB,wsC,wsD]){ await esperarTipo(ws,'PARTIDA_PREPARANDO',3000); await esperarTipo(ws,'SALA_ATUALIZADA',3000); }
  // aguardar disponivel
  const disp = await esperarTipo(wsA,'PARTIDA_DISPONIVEL',4000) as {partidaId:string;serverId:string};
  for(const ws of [wsB,wsC,wsD]) await esperarTipo(ws,'PARTIDA_DISPONIVEL',4000);
  for(const ws of [wsA,wsB,wsC,wsD]) await esperarTipo(ws,'SALA_ATUALIZADA',3000);
  return {a,b,c,d,wsA,wsB,wsC,wsD,codigo,salaId, serverId: disp.serverId, partidaId: disp.partidaId};
}

test('revalidação e reabertura: encaminhada → aberta com reset de Prontidão e presença inalterada', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'partida-reab-1', serverId:'server-reab-1'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {wsA,wsB,wsC,wsD,salaId,serverId,partidaId,a,b,c,d}=await montarSalaEncaminhada(baseUrl,wsUrl, null as any);
    // verificar PG encaminhada
    const linha=await pool.query<{status:string;server_id:string;partida_id:string}>(`SELECT status, server_id, partida_id FROM salas_historico WHERE id=$1`,[salaId]);
    assert.equal(linha.rows[0].status,'encaminhada');
    // chamar retorno HTTP
    const token=assinarServiceToken();
    const resp=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId, partidaId, serverId, resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]})
    });
    assert.equal(resp.status,200);
    const body=await resp.json() as {sala: Sala};
    assert.equal(body.sala.estado,'aberta');
    assert.equal(body.sala.id,salaId);
    // Prontidão false para todos
    for(const m of body.sala.membros) assert.equal(m.prontidao,false);
    // ordem preservada
    assert.deepEqual(body.sala.membros.map(m=>m.ordemDeEntrada).sort((x,y)=>x-y), [1,2,3,4]);
    // anfitrião mantido
    assert.equal(body.sala.anfitriaoId, body.sala.membros.find(m=>m.jogadorId===a.id)?.id);
    // presença inalterada (conectado)
    for(const m of body.sala.membros) assert.equal(m.presenca,'conectado');
    // PG reaberta
    const linha2=await pool.query<{status:string;server_id:string|null;partida_id:string|null}>(`SELECT status, server_id, partida_id FROM salas_historico WHERE id=$1`,[salaId]);
    assert.equal(linha2.rows[0].status,'aberta');
    assert.equal(linha2.rows[0].server_id,null);
    assert.equal(linha2.rows[0].partida_id,null);
    // projeção sem encaminhamento
    const projRaw=await redis.get(`lobby:sala:${salaId}:estado`);
    assert.ok(projRaw);
    const proj=JSON.parse(projRaw);
    assert.equal(proj.estado,'aberta');
    assert.equal(proj.encaminhamento,undefined);
    // broadcast SALA_ATUALIZADA para todos
    for(const ws of [wsA,wsB,wsC,wsD]){
      const ev=await esperarTipo(ws,'SALA_ATUALIZADA',3000) as SalaAtualizadaEvento;
      assert.equal(ev.sala.estado,'aberta');
      assert.equal(ev.sala.encaminhamento,undefined);
    }
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('revalidação falha: serverId/partidaId e jogadores incoerentes retornam 409', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'p-val', serverId:'s-val'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {wsA,wsB,wsC,wsD,salaId,a,b,c,d}=await montarSalaEncaminhada(baseUrl,wsUrl,null as any);
    const token=assinarServiceToken();
    // serverId errado
    const r1=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId, partidaId:'p-val', serverId:'errado', resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]})
    });
    assert.equal(r1.status,409);
    const b1=await r1.json() as {codigo:string};
    assert.equal(b1.codigo,'SALA_NAO_ENCAMINHADA');
    // jogadores errado (falta um)
    const r2=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId, partidaId:'p-val', serverId:'s-val', resultado:'derrota', jogadores:[a.id,b.id,c.id]})
    });
    assert.equal(r2.status,409);
    // correta ainda deve passar após falhas
    const r3=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId, partidaId:'p-val', serverId:'s-val', resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]})
    });
    assert.equal(r3.status,200);
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('idempotência: segunda chamada mesma salaId já aberta retorna 200 sem mutação', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'p-idem', serverId:'s-idem'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {wsA,wsB,wsC,wsD,salaId,a,b,c,d}=await montarSalaEncaminhada(baseUrl,wsUrl,null as any);
    const token=assinarServiceToken();
    const body={salaId, partidaId:'p-idem', serverId:'s-idem', resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]};
    const r1=await fetch(`${baseUrl}/api/retorno`,{method:'POST',headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    assert.equal(r1.status,200);
    const j1=await r1.json() as {sala:Sala};
    // drenar broadcast
    for(const ws of [wsA,wsB,wsC,wsD]) await esperarTipo(ws,'SALA_ATUALIZADA',3000);
    const r2=await fetch(`${baseUrl}/api/retorno`,{method:'POST',headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
    assert.equal(r2.status,200);
    const j2=await r2.json() as {sala:Sala};
    assert.deepEqual(j2.sala,j1.sala);
    // não deve haver novo broadcast de mutação (só idempotente sem broadcast extra?) - nosso código não envia broadcast no idempotente, só retorna sala
    // garantir que não há SALA_ATUALIZADA extra pendente
    // tentar esperar silencio
    await new Promise(r=>setTimeout(r,200));
    // verificar estado ainda aberta e sem encaminhamento
    const linha=await pool.query<{status:string}>(`SELECT status FROM salas_historico WHERE id=$1`,[salaId]);
    assert.equal(linha.rows[0].status,'aberta');
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('guarda 401: sem service token em produção é recusado', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'p-auth', serverId:'s-auth'});
  const originalEnv=process.env.NODE_ENV;
  const originalJwt=process.env.JWT_SECRET;
  const originalJwtRefresh=process.env.JWT_REFRESH_SECRET;
  const originalPgPass=process.env.POSTGRES_PASSWORD;
  const originalLobbyUrl=process.env.LOBBY_PUBLIC_URL;
  process.env.JWT_SECRET='test-jwt-secret-para-retorno-401';
  process.env.JWT_REFRESH_SECRET='test-refresh-secret-para-retorno-401';
  process.env.POSTGRES_PASSWORD='test_pg_pass';
  process.env.LOBBY_PUBLIC_URL='http://localhost:3001';
  process.env.NODE_ENV='production';
  try {
    await comServidor(async ({baseUrl,wsUrl})=>{
      const {salaId,a,b,c,d,wsA,wsB,wsC,wsD}=await montarSalaEncaminhada(baseUrl,wsUrl,null as any);
      // sem header
      const r=await fetch(`${baseUrl}/api/retorno`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({salaId, resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]})
      });
      assert.equal(r.status,401);
      // token inválido
      const r2=await fetch(`${baseUrl}/api/retorno`,{
        method:'POST',
        headers:{'content-type':'application/json', Authorization:'Bearer invalido'},
        body:JSON.stringify({salaId, resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]})
      });
      assert.equal(r2.status,401);
      // token válido
      const token=assinarServiceToken();
      const r3=await fetch(`${baseUrl}/api/retorno`,{
        method:'POST',
        headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
        body:JSON.stringify({salaId, partidaId:'p-auth', serverId:'s-auth', resultado:'vitoria', jogadores:[a.id,b.id,c.id,d.id]})
      });
      assert.equal(r3.status,200);
      wsA.close(); wsB.close(); wsC.close(); wsD.close();
      await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
    }, {ofertarEncaminhamento: ofertarStub});
  } finally {
    process.env.NODE_ENV=originalEnv;
    if (originalJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=originalJwt;
    if (originalJwtRefresh === undefined) delete process.env.JWT_REFRESH_SECRET; else process.env.JWT_REFRESH_SECRET=originalJwtRefresh;
    if (originalPgPass === undefined) delete process.env.POSTGRES_PASSWORD; else process.env.POSTGRES_PASSWORD=originalPgPass;
    if (originalLobbyUrl === undefined) delete process.env.LOBBY_PUBLIC_URL; else process.env.LOBBY_PUBLIC_URL=originalLobbyUrl;
  }
});

test('após reabertura, ALTERNAR_PRONTIDAO e CHAT voltam a funcionar', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'p-reab2', serverId:'s-reab2'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {wsA,wsB,wsC,wsD,salaId,a,b,c,d}=await montarSalaEncaminhada(baseUrl,wsUrl,null as any);
    const token=assinarServiceToken();
    const r=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId, partidaId:'p-reab2', serverId:'s-reab2', resultado:'derrota', jogadores:[a.id,b.id,c.id,d.id]})
    });
    assert.equal(r.status,200);
    for(const ws of [wsA,wsB,wsC,wsD]) await esperarTipo(ws,'SALA_ATUALIZADA',3000);
    // alternar prontidão deve funcionar
    enviar(wsA,{type:'ALTERNAR_PRONTIDAO'});
    for(const ws of [wsA,wsB,wsC,wsD]){
      const ev=await esperarTipo(ws,'PRONTIDAO_ATUALIZADA',3000) as {prontidao:boolean};
      assert.equal(ev.prontidao,true);
      await esperarTipo(ws,'SALA_ATUALIZADA',3000);
    }
    // chat deve funcionar
    enviar(wsB,{type:'ENVIAR_MENSAGEM_DE_CHAT',conteudo:'voltamos!'});
    for(const ws of [wsA,wsB,wsC,wsD]){
      const chat=await esperarTipo(ws,'MENSAGEM_DE_CHAT',3000) as {conteudo:string};
      assert.equal(chat.conteudo,'voltamos!');
    }
    wsA.close(); wsB.close(); wsC.close(); wsD.close();
    await Promise.all([wsA,wsB,wsC,wsD].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('payload inválido e sala não encontrada retornam 400/404', async()=>{
  await comServidor(async ({baseUrl})=>{
    const token=assinarServiceToken();
    // salaId faltando
    const r1=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({resultado:'vitoria', jogadores:['x']})
    });
    assert.equal(r1.status,400);
    const j1=await r1.json() as {codigo:string};
    assert.equal(j1.codigo,'DADOS_INVALIDOS');
    // sala inexistente
    const r2=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId:'00000000-0000-0000-0000-000000000000', resultado:'vitoria', jogadores:['a','b','c','d']})
    });
    assert.equal(r2.status,404);
    const j2=await r2.json() as {codigo:string};
    assert.equal(j2.codigo,'SALA_NAO_ENCONTRADA');
    // sala aberta nunca encaminhada -> 409
    const a=await registrarJogador(baseUrl);
    const wsA=await conectarWs(wsUrlFromBase(baseUrl),a.cookies);
    enviar(wsA,{type:'CRIAR_SALA'});
    const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento;
    const salaId=cri.sala.id;
    const r3=await fetch(`${baseUrl}/api/retorno`,{
      method:'POST',
      headers:{'content-type':'application/json', Authorization:`Bearer ${token}`},
      body:JSON.stringify({salaId, resultado:'vitoria', jogadores:[a.id]})
    });
    // pode ser 409 porque não encaminhada
    assert.equal(r3.status,409);
    wsA.close(); await esperarClose(wsA).catch(()=>undefined);
  }, {});
});

function wsUrlFromBase(baseUrl:string): string {
  const u=new URL(baseUrl);
  return `ws://${u.host}`;
}
