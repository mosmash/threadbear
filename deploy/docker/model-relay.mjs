import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { prepareRequest, filterModels } from './model-policy.mjs';

const paths = new Set(['/v1/models', '/v1/messages', '/v1/messages/count_tokens', '/v1/responses']);
const equal = (a,b) => {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const reply = (res,code,message) => {res.writeHead(code, {'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:{type:'trial_relay',message}}));};

// Destinations and credentials are operator inputs, never HTTP parameters.
// No administration routes, arbitrary forwarding, or request/content logging.
export function createModelRelay(config, {stateDir='/state', upstreamOrigin='http://cliproxyapi:8317', fetchImpl=fetch}={}) {
  let active = 0;
  let counts = { day: '', requests: 0 };
  const usageFile = path.join(stateDir, 'usage.json');
  try { counts = JSON.parse(fs.readFileSync(usageFile, 'utf8')); } catch {}
  return http.createServer(async (req,res) => {
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
      let body=Buffer.concat(chunks);
      if(req.method==='POST') {
        let data;try{data=JSON.parse(body.toString());}catch{return reply(res,400,'Invalid JSON');}
        const prepared = prepareRequest(url.pathname, data);
        if(prepared.error) return reply(res,prepared.status,prepared.error);
        body=Buffer.from(JSON.stringify(prepared.body));
        if(counts.requests>=200) return reply(res,429,'Daily trial request limit reached');
        counts.requests++;
        fs.writeFileSync(usageFile+'.tmp',JSON.stringify(counts),{mode:0o600});fs.renameSync(usageFile+'.tmp',usageFile);
      }
      timer=setTimeout(()=>controller.abort(),180000);
      const headers={'content-type':'application/json'};
      // This header selects the proxy's Claude catalog. Do not add it to Codex.
      if(url.pathname.startsWith('/v1/messages') || req.headers['anthropic-version']) {
        headers['anthropic-version']=String(req.headers['anthropic-version']??'2023-06-01');
        if(req.headers['anthropic-beta']) headers['anthropic-beta']=String(req.headers['anthropic-beta']);
      }
      if(config.upstreamKey){headers.authorization='Bearer '+config.upstreamKey;headers['x-api-key']=config.upstreamKey;}
      const upstream=await fetchImpl(upstreamOrigin+url.pathname+url.search,{method:req.method,headers,...(req.method==='POST'?{body}:{}),signal:controller.signal,redirect:'error'});
      if(url.pathname==='/v1/models' && upstream.ok) {
        const catalog=filterModels(await upstream.json());
        res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
        res.end(JSON.stringify(catalog));return;
      }
      res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json','cache-control':'no-store'});
      if(upstream.body) await new Promise((resolve,reject)=>{const stream=Readable.fromWeb(upstream.body);stream.on('error',reject);res.on('finish',resolve);res.on('error',reject);stream.pipe(res);});
      else res.end();
    } catch {if(!res.headersSent) reply(res,502,'Provider request failed');else res.destroy();}
    finally {clearTimeout(timer);active--;}
  });
}

if(process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = JSON.parse(fs.readFileSync('/run/secrets/relay-config', 'utf8'));
  createModelRelay(config, {upstreamOrigin: process.env.THREADBEAR_UPSTREAM_ORIGIN ?? 'http://cliproxyapi:8317'})
    .listen(Number(process.env.THREADBEAR_RELAY_PORT ?? 8080), process.env.THREADBEAR_RELAY_BIND ?? '0.0.0.0');
}
