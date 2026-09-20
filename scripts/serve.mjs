import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export function createServer(){return http.createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
  const data=await readFile(path);
  const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.cu':'text/plain'}[extname(path)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'}).end(data);
 }catch{res.writeHead(404).end('Not found');}
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||5175);
 createServer().listen(port,'127.0.0.1',()=>console.log(`Mountain River: http://localhost:${port}`));
}

