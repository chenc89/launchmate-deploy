import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {crc32} from '../tools/zipArchive.js';

const execute=promisify(execFile);
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
test('release package is self-contained, shares files offline and excludes unrelated implementations',async t=>{
  const root=await realpath(await mkdtemp(join(tmpdir(),'launchmate-share package-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const output=join(root,'skill.zip');const args=[join(repository,'scripts/package.mjs'),'--out',output];
  const options={cwd:root,env:{PATH:process.env.PATH},timeout:15000};
  await execute(process.execPath,args,options);const bytes=await readFile(output);
  const names=[];let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+length).toString();const start=offset+30+length+extra;
    const content=bytes.subarray(start,start+size);assert.equal(crc32(content),bytes.readUInt32LE(offset+14));
    assert.ok(name.startsWith('launchmate-deploy/'));assert.ok(!name.split('/').some(part=>['..','.env','test','node_modules','work'].includes(part)));
    names.push(name);const target=join(root,'installed',name);await mkdir(dirname(target),{recursive:true});await writeFile(target,content);
    assert.deepEqual(content,await readFile(join(repository,name.slice('launchmate-deploy/'.length))));offset=start+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);
  for(const name of ['apiClient','backendCommands','commands','deployProject','mcpServer','mcpTools','projectBinding','sourceFiles'])assert.ok(!names.includes(`launchmate-deploy/scripts/cli/src/${name}.js`));
  const installed=join(root,'installed/launchmate-deploy');
  const manifest=JSON.parse(await readFile(join(installed,'scripts/cli/package.json')));assert.deepEqual(Object.keys(manifest.bin),['launchmate']);assert.equal(manifest.license,'MIT');
  assert.deepEqual(await readFile(join(installed,'LICENSE')),await readFile(join(installed,'scripts/cli/LICENSE')));
  for(const entry of Object.values(manifest.bin))await execute(process.execPath,['--check',join(installed,'scripts/cli',entry)],options);
  const cli=join(installed,'scripts/cli/bin/launchmate.js');assert.match((await execute(process.execPath,[cli,'--help'],options)).stdout,/Launchmate Share/);
  const doctor=JSON.parse((await execute(process.execPath,[cli,'share-doctor','--cloudflared',join(root,'missing')],options)).stdout);assert.equal(doctor.node.ready,true);assert.equal(doctor.cloudflared.ready,false);
  for(const command of ['deploy','inspect','mcp','sync','publish','backend-config'])await assert.rejects(execute(process.execPath,[cli,command],options),error=>JSON.parse(error.stderr).error.message.includes('未知命令'));
  const app=join(root,'my page');await mkdir(app);await writeFile(join(app,'index.html'),'<h1>Offline package</h1>');await writeFile(join(app,'.env'),'PRIVATE_VALUE=not-public');await writeFile(join(app,'audio.mp3'),Buffer.from([73,68,51,0,255]));
  await execute(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {createLocalPreview} from ${JSON.stringify(pathToFileURL(join(installed,'scripts/cli/src/localPreview.js')).href)};
    const server=await createLocalPreview({directory:${JSON.stringify(app)},shareId:'offline-release'});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
    try {assert.equal((await fetch(url)).status,200);assert.equal((await fetch(url+'/.env')).status,404);assert.deepEqual(Buffer.from(await(await fetch(url+'/audio.mp3')).arrayBuffer()),Buffer.from([73,68,51,0,255]));}
    finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  `],options);
  await assert.rejects(execute(process.execPath,args,options),/EEXIST/);assert.deepEqual(await readFile(output),bytes);
});
