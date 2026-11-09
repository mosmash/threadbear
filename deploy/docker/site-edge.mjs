import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
// Only the configured Convex Cloud site is a redirect destination.
const cloudSite = process.env.THREADBEAR_CLOUD_SITE_ORIGIN;
let cloudOrigin;
if (cloudSite) {
  const u = new URL(cloudSite);
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)?\.convex\.site$/.test(u.hostname) || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) throw new Error('Invalid Convex Cloud site origin');
  cloudOrigin = u.origin;
}
const secret = JSON.parse(fs.readFileSync('/run/secrets/enrollment-auth','utf8'));
const expected = crypto.createHash('sha256').update(secret.username+':'+secret.password).digest();
function authorized(req) {
  const value=String(req.headers.authorization??'');
  if(!value.startsWith('Basic '))return false;
  let text;try{text=Buffer.from(value.slice(6),'base64').toString();}catch{return false;}
  return crypto.timingSafeEqual(expected,crypto.createHash('sha256').update(text).digest());
}
http.createServer((req,res)=>{
  let path;try{path=new URL(req.url,'http://site').pathname;}catch{res.writeHead(400);res.end();return;}
  if(path==='/setup'||path.startsWith('/setup/')){
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Robots-Tag','noindex, nofollow');
    if(!authorized(req)){res.writeHead(401,{'WWW-Authenticate':'Basic realm="Threadbear private setup", charset="UTF-8"'});res.end('Private setup');return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    const file=path==='/setup/phone.svg'?'/enrollment/phone.svg':(path==='/setup'||path==='/setup/')?'/enrollment/index.html':null;
    if(!file){res.writeHead(404);res.end();return;}
    fs.readFile(file,(error,data)=>{
      if(error){res.writeHead(503,{'content-type':'text/plain'});res.end('Enrollment is being prepared.');return;}
      res.writeHead(200,{'content-type':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'});res.end(req.method==='HEAD'?undefined:data);
    });return;
  }
  if (cloudOrigin) {
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(503);res.end('Trial moved to Convex Cloud; reconnect from the private setup page.');return; }
    const query = new URL(req.url,'http://site').search;
    res.writeHead(302,{'Location':cloudOrigin+path+query});res.end();return;
  }
  // Fixed backend only; no arbitrary destination, admin API, or request logging.
  const headers={...req.headers};delete headers.authorization;delete headers['proxy-authorization'];
  const proxy=http.request({hostname:'convex',port:3211,path:req.url,method:req.method,headers},up=>{
    res.writeHead(up.statusCode??502,up.headers);up.pipe(res);
  });
  proxy.setTimeout(60000,()=>proxy.destroy());
  proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Backend unavailable');});
  req.on('aborted',()=>proxy.destroy());res.on('close',()=>proxy.destroy());req.pipe(proxy);
}).listen(Number(process.env.THREADBEAR_SITE_PORT ?? 8080), process.env.THREADBEAR_SITE_BIND ?? '0.0.0.0');
