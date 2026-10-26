import {readFile,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {saveZipArchive} from '../tools/zipArchive.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{out:{type:'string'}}});
if(!values.out)throw new Error('Usage: npm run package:skill -- --out new-skill.zip');
const runtime=join(root,'scripts/cli');
const manifest=JSON.parse(await readFile(join(runtime,'package.json'),'utf8'));
const names=['SKILL.md','LICENSE','agents/openai.yaml','references/public-access.md'];
const runtimeNames=['package.json','LICENSE',...Object.values(manifest.bin).map(name=>name.replace(/^\.\//,''))];
runtimeNames.push(...(await readdir(join(runtime,'src'))).filter(name=>name.endsWith('.js')).map(name=>'src/'+name));
names.push(...runtimeNames.sort((a,b)=>a.localeCompare(b)).map(name=>'scripts/cli/'+name));
const files=[];
for(const name of names)files.push({path:'launchmate-deploy/'+name,content:await readFile(join(root,name))});
const archive=await saveZipArchive(files,values.out);
console.log(JSON.stringify({archive,file_count:files.length,cli_version:manifest.version}));
