import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

// Deliberately no administration routes, arbitrary destinations, or request logging.
const config = JSON.parse(fs.readFileSync('/run/secrets/relay-config', 'utf8'));
const paths = new Set(['/v1/models', '/v1/messages', '/v1/messages/count_tokens']);
const models = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
let active = 0;
let counts = { day: '', requests: 0 };
try { counts = JSON.parse(fs.readFileSync('/state/usage.json', 'utf8')); } catch {}
const equal = (a,b) => {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const reply = (res,code,message) => {res.writeHead(code, {'content-type':'application/json'});res.end(JSON.stringify({error:{type:'trial_relay',message}}));};
http.createServer(async (req,res) => {
  const url = new URL(req.url, 'http://relay');
  if (req.url === '/health' && req.method === 'GET') {res.writeHead(200);res.end('ok');return;}
  const token = String(req.headers.authorization ?? '').replace(/^Bearer /i,'') || String(req.headers['x-api-key'] ?? '');
  if (!equal(token,config.token)) return reply(res,401,'Authentication required');
  if (!paths.has(url.pathname) || !['GET','POST'].includes(req.method) || (url.pathname==='/v1/models' ? req.method!=='GET' : req.method!=='POST')) return reply(res,403,'Route not allowed');
  if (active >= 2) return reply(res,429,'Trial concurrency limit');
  active++;
  let timer;
  const controller = new AbortController();
  res.on('close',()=>controller.abort());
  try {
    const day = new Date().toISOString().slice(0,10);
    if(counts.day !== day) counts={day,requests:0};
    const chunks=[];let size=0;
    for await (const c of req) {size+=c.length;if(size>4*1024*1024) return reply(res,413,'Request exceeds trial size limit');chunks.push(c);}
    const body=Buffer.concat(chunks);
    if(req.method==='POST') {
      let data;try{data=JSON.parse(body.toString());}catch{return reply(res,400,'Invalid JSON');}
      if(!models.has(data.model)) return reply(res,403,'Model not allowed for this trial');
      if(!Number.isInteger(data.max_tokens) || data.max_tokens<1 || data.max_tokens>16384) {
        if(url.pathname!=='/v1/messages/count_tokens') return reply(res,400,'Trial output limit is 16384 tokens');
      }
      if(counts.requests>=200) return reply(res,429,'Daily trial request limit reached');
      counts.requests++;
      fs.writeFileSync('/state/usage.json.tmp',JSON.stringify(counts),{mode:0o600});fs.renameSync('/state/usage.json.tmp','/state/usage.json');
    }
    timer=setTimeout(()=>controller.abort(),180000);
    const headers={'content-type':'application/json','anthropic-version':String(req.headers['anthropic-version']??'2023-06-01')};
    if(req.headers['anthropic-beta']) headers['anthropic-beta']=String(req.headers['anthropic-beta']);
    if(config.upstreamKey){headers.authorization='Bearer '+config.upstreamKey;headers['x-api-key']=config.upstreamKey;}
    const upstream=await fetch('http://cliproxyapi:8317'+url.pathname+url.search,{method:req.method,headers,...(req.method==='POST'?{body}:{}),signal:controller.signal,redirect:'error'});
    res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json','cache-control':'no-store'});
    if(upstream.body) await new Promise((resolve,reject)=>{const stream=Readable.fromWeb(upstream.body);stream.on('error',reject);res.on('finish',resolve);res.on('error',reject);stream.pipe(res);});
    else res.end();
  } catch {if(!res.headersSent) reply(res,502,'Provider request failed');else res.destroy();}
  finally {clearTimeout(timer);active--;}
}).listen(8080,'0.0.0.0');
