// Testes de integração — desvinculação do desistente via callback HTTP (issue #290)
// Cobre: detach só do desistente em sala encaminhada, MEMBRO_SAIU à vítima,
// liberação imediata para criar/entrar em outra sala, idempotência,
// guarda 401 e sala que segue encaminhada para os restantes.
// Padrão PG/Redis reais, sequencial, similar a retorno.integration.test.ts

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { criarClienteRedis } from '@flicker/config';
import { registrarArquivoDeTeste, finalizarArquivoDeTeste } from './teardown.ts';
import type { SalaAtualizadaEvento } from '@flicker/shared';
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
  try {
    await pool.query(`TRUNCATE TABLE membros_historico, membros, salas_historico, sala_reaberta_markers, usuarios RESTART IDENTITY CASCADE`);
  } catch {
    await pool.query(`TRUNCATE TABLE membros_historico, membros, salas_historico, usuarios RESTART IDENTITY CASCADE`);
  }
  await redis.flushdb();
});

async function montarSalaEncaminhada(baseUrl:string, wsUrl:string): Promise<{a:any;b:any;wsA:WebSocket;wsB:WebSocket;codigo:string;salaId:string;serverId:string;partidaId:string}> {
  const a=await registrarJogador(baseUrl);
  const b=await registrarJogador(baseUrl);
  const wsA=await conectarWs(wsUrl,a.cookies);
  const wsB=await conectarWs(wsUrl,b.cookies);
  enviar(wsA,{type:'CRIAR_SALA'});
  const cri=JSON.parse(await esperarMensagem(wsA)) as SalaAtualizadaEvento;
  const codigo=cri.sala.codigoDeSala;
  const salaId=cri.sala.id;
  enviar(wsB,{type:'ENTRAR_NA_SALA',codigoDeSala:codigo}); await esperarMensagem(wsB); await esperarMensagem(wsB);
  await esperarMensagem(wsA);
  enviar(wsA,{type:'ALTERNAR_PRONTIDAO'}); enviar(wsB,{type:'ALTERNAR_PRONTIDAO'});
  for(let i=0;i<4;i++) await esperarMensagem(wsA);
  for(let i=0;i<4;i++) await esperarMensagem(wsB);
  enviar(wsA,{type:'INICIAR_PARTIDA'});
  for(const ws of [wsA,wsB]){ await esperarTipo(ws,'PARTIDA_PREPARANDO',3000); await esperarTipo(ws,'SALA_ATUALIZADA',3000); }
  const disp = await esperarTipo(wsA,'PARTIDA_DISPONIVEL',4000) as {partidaId:string;serverId:string};
  await esperarTipo(wsB,'PARTIDA_DISPONIVEL',4000);
  for(const ws of [wsA,wsB]) await esperarTipo(ws,'SALA_ATUALIZADA',3000);
  return {a,b,wsA,wsB,codigo,salaId, serverId: disp.serverId, partidaId: disp.partidaId};
}

function tokenServico(): string {
  return assinarServiceToken();
}

async function postDesistencia(baseUrl:string, corpo:object, token?:string): Promise<{status:number;texto:string}> {
  const headers: Record<string,string> = {'content-type':'application/json'};
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${baseUrl}/api/desistencia`, { method:'POST', headers, body: JSON.stringify(corpo) });
  return { status: res.status, texto: await res.text() };
}

test('desistencia desvincula só o desistente: vítima recebe MEMBRO_SAIU e pode criar sala; restantes seguem encaminhados', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'partida-des-1', serverId:'server-des-1'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {a,b,wsA,wsB,salaId,serverId,partidaId}=await montarSalaEncaminhada(baseUrl, wsUrl);
    // callback do game-server para o desistente (b)
    const resp = await postDesistencia(baseUrl, { salaId, partidaId, serverId, jogadorId: b.id }, tokenServico());
    assert.equal(resp.status, 200, `desistencia falhou: ${resp.texto}`);
    assert.deepEqual(JSON.parse(resp.texto), { desvinculado: true });

    // vítima recebe MEMBRO_SAIU com a sala sem ela
    const ev = await esperarTipo(wsB,'MEMBRO_SAIU',3000) as {jogadorId:string;sala:{membros:Array<{jogadorId:string}>;estado:string}};
    assert.equal(ev.jogadorId, b.id);
    assert.ok(!ev.sala.membros.some((m) => m.jogadorId === b.id));
    assert.equal(ev.sala.estado, 'encaminhada');

    // PG: vítima sem vínculo ativo; anfitrião segue
    const assoc = await pool.query(`SELECT sala_id FROM membros m JOIN salas_historico s ON s.id=m.sala_id WHERE m.usuario_id=$1 AND m.bloqueado=false AND s.status IN ('aberta','encaminhada')`, [b.id]);
    assert.equal(assoc.rows.length, 0);
    const assocA = await pool.query(`SELECT sala_id FROM membros m JOIN salas_historico s ON s.id=m.sala_id WHERE m.usuario_id=$1 AND m.bloqueado=false AND s.status IN ('aberta','encaminhada')`, [a.id]);
    assert.equal(assocA.rows[0].sala_id, salaId);

    // vítima NÃO entra em bloqueados: pode criar sala na hora
    const bloc = await pool.query(`SELECT * FROM membros WHERE usuario_id=$1 AND bloqueado=true`, [b.id]);
    assert.equal(bloc.rows.length, 0);
    enviar(wsB,{type:'CRIAR_SALA'});
    const nova = await esperarTipo(wsB,'SALA_ATUALIZADA',3000) as SalaAtualizadaEvento;
    assert.equal(nova.sala.estado, 'aberta');
    assert.notEqual(nova.sala.id, salaId);

    wsA.close(); wsB.close();
    await Promise.all([wsA,wsB].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('desistencia idempotente: segunda chamada responde 200 sem mutação', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'partida-des-2', serverId:'server-des-2'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {b,salaId,serverId,partidaId,wsA,wsB}=await montarSalaEncaminhada(baseUrl, wsUrl);
    const corpo = { salaId, partidaId, serverId, jogadorId: b.id };
    const r1 = await postDesistencia(baseUrl, corpo, tokenServico());
    assert.equal(r1.status, 200);
    const r2 = await postDesistencia(baseUrl, corpo, tokenServico());
    assert.equal(r2.status, 200, `retry falhou: ${r2.texto}`);
    assert.deepEqual(JSON.parse(r2.texto), { desvinculado: false });
    wsA.close(); wsB.close();
    await Promise.all([wsA,wsB].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('desistencia valida payload e sala existente', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'partida-des-3', serverId:'server-des-3'});
  await comServidor(async ({baseUrl,wsUrl})=>{
    const {b,salaId,serverId,partidaId,wsA,wsB}=await montarSalaEncaminhada(baseUrl, wsUrl);
    const invalido = await postDesistencia(baseUrl, { salaId }, tokenServico());
    assert.equal(invalido.status, 400);
    const inexistente = await postDesistencia(baseUrl, { salaId: 'sala-que-nao-existe', jogadorId: b.id }, tokenServico());
    assert.equal(inexistente.status, 404);
    const partidaErrada = await postDesistencia(baseUrl, { salaId, partidaId: 'outra-partida', serverId, jogadorId: b.id }, tokenServico());
    assert.equal(partidaErrada.status, 409);
    wsA.close(); wsB.close();
    await Promise.all([wsA,wsB].map(ws=>esperarClose(ws).catch(()=>undefined)));
  }, {ofertarEncaminhamento: ofertarStub});
});

test('guarda 401: sem service token em produção é recusado', async()=>{
  const ofertarStub=async ():Promise<AceiteDoEncaminhamento>=> ({partidaId:'partida-des-4', serverId:'server-des-4'});
  const originalEnv=process.env.NODE_ENV;
  const originalJwt=process.env.JWT_SECRET;
  const originalJwtRefresh=process.env.JWT_REFRESH_SECRET;
  const originalPgPass=process.env.POSTGRES_PASSWORD;
  const originalLobbyUrl=process.env.LOBBY_PUBLIC_URL;
  process.env.JWT_SECRET='test-jwt-secret-para-desistencia-401';
  process.env.JWT_REFRESH_SECRET='test-refresh-secret-para-desistencia-401';
  process.env.POSTGRES_PASSWORD='test_pg_pass';
  process.env.LOBBY_PUBLIC_URL='http://localhost:3001';
  process.env.NODE_ENV='production';
  try {
    await comServidor(async ({baseUrl,wsUrl})=>{
      const {b,salaId,serverId,partidaId,wsA,wsB}=await montarSalaEncaminhada(baseUrl, wsUrl);
      const corpo = { salaId, partidaId, serverId, jogadorId: b.id };
      // sem header
      const r=await fetch(`${baseUrl}/api/desistencia`,{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(corpo)
      });
      assert.equal(r.status,401);
      // token inválido
      const r2=await fetch(`${baseUrl}/api/desistencia`,{
        method:'POST',
        headers:{'content-type':'application/json', Authorization:'Bearer invalido'},
        body:JSON.stringify(corpo)
      });
      assert.equal(r2.status,401);
      // token válido
      const r3=await postDesistencia(baseUrl, corpo, tokenServico());
      assert.equal(r3.status,200);
      wsA.close(); wsB.close();
      await Promise.all([wsA,wsB].map(ws=>esperarClose(ws).catch(()=>undefined)));
    }, {ofertarEncaminhamento: ofertarStub});
  } finally {
    process.env.NODE_ENV=originalEnv;
    if (originalJwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=originalJwt;
    if (originalJwtRefresh === undefined) delete process.env.JWT_REFRESH_SECRET; else process.env.JWT_REFRESH_SECRET=originalJwtRefresh;
    if (originalPgPass === undefined) delete process.env.POSTGRES_PASSWORD; else process.env.POSTGRES_PASSWORD=originalPgPass;
    if (originalLobbyUrl === undefined) delete process.env.LOBBY_PUBLIC_URL; else process.env.LOBBY_PUBLIC_URL=originalLobbyUrl;
  }
});
