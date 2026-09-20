import {readFile} from 'node:fs/promises';
import {compile} from '../vendor/cuda-webshader/compiler/compiler.js';
import {ENTRIES} from '../src/solver.js';
const source=(await Promise.all(['coastal-kernels.cu','river.cu','impacts.cu'].map(f=>readFile(new URL('../src/'+f,import.meta.url),'utf8')))).join('\n');
for(const entry of ENTRIES){const a=compile(source,{entry,workgroupSize:[128,1,1]});if(!a.wgsl.includes('@compute'))throw Error(entry);console.log(entry+': compiled');}
