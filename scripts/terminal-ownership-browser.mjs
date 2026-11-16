import { chromium } from 'playwright-core';
import { Kernel } from '@devlab/kernel';
import { grants, profile } from '../src/profile.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const source=fileURLToPath(new URL('../',import.meta.url));
const data=await mkdtemp(join(tmpdir(),'devlab-ownership-repro-')), project=join(data,'project');
const kernel=new Kernel(grants);let browser;
try {
 await mkdir(join(project,'.context/modules'),{recursive:true});await writeFile(join(project,'owned.txt'),'original');
 await writeFile(join(project,'.context/modules/registry.yaml'),'schema_version: 1\nmodules:\n  fixture-owner:\n    paths: [owned.txt]\n');
 process.env.DEVLAB_BUILD_DIR=join(source,'dist');
 await kernel.start(profile(kernel,source,0,data));
 const p=await kernel.service('projects').open({path:project,label:'Ownership repro'});
 await kernel.service('canvas').save({projectId:p.id,expectedRevision:0,graph:{name:'Ownership repro',nodes:[{id:'policy-node',type:'terminal',position:{x:40,y:40},data:{label:'Persisted terminal',cwd:'.',shell:'bash'}}],edges:[]}});
 const api=kernel.service('terminals');
 const session=await api.create({projectId:p.id,nodeId:'policy-node',cwd:'.',shell:'bash',cols:80,rows:24,ownership:{mode:'guided',ownerId:'fixture-owner'}});
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 await page.goto(kernel.service('http').url+'?projectId='+p.id,{waitUntil:'networkidle'});
 await page.getByTestId('workspace-view-terminals').click();
 await page.getByLabel('Actions for Persisted terminal',{exact:true}).click();
 await page.waitForFunction(()=>{const select=document.querySelector('select[aria-label="Ownership for Persisted terminal"]');return select&&!select.disabled;});
 const selected=await page.getByLabel('Ownership for Persisted terminal',{exact:true}).inputValue();
 const mode=await page.getByLabel('Ownership mode for Persisted terminal',{exact:true}).inputValue();
 console.log(JSON.stringify({effective:session.ownership,displayed:{ownerId:selected,mode}}));
 {
  assert.equal(selected,'fixture-owner'); assert.equal(mode,'guided');
  await page.reload({waitUntil:'networkidle'});
  await page.getByTestId('workspace-view-terminals').click();
  const nodes=(await kernel.service('canvas').load(p.id)).graph.nodes;
  assert.deepEqual(nodes[0].data.ownership,{mode:'guided',ownerId:'fixture-owner'});
  assert.equal(api.inspect(session.id).pid,session.pid);
  api.write(session.id, 'exit\r');
  let successor;
  for(let attempt=0;attempt<100;attempt++){
   successor=api.list(p.id).find(s=>s.nodeId==='policy-node'&&s.id!==session.id&&s.status==='running');
   if(successor)break;
   await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(successor,'The next shell did not start');
  assert.equal(successor.ownership.mode,'guided');assert.equal(successor.ownership.ownerId,'fixture-owner');
  const saved=await kernel.service('canvas').load(p.id);
  await kernel.service('canvas').save({projectId:p.id,expectedRevision:saved.revision,graph:{...saved.graph,nodes:saved.graph.nodes.map(n=>({...n,data:{...n.data,ownership:{mode:'off'}}}))}});
  await page.reload({waitUntil:'networkidle'});
  await page.getByTestId('workspace-view-terminals').click();
  await page.getByLabel('Actions for Persisted terminal',{exact:true}).click();
  assert.equal(await page.getByLabel('Ownership mode for Persisted terminal',{exact:true}).inputValue(),'off');
  assert.deepEqual((await kernel.service('canvas').load(p.id)).graph.nodes[0].data.ownership,{mode:'off'});
  assert.equal(api.inspect(successor.id).ownership.mode,'guided','An explicit pending change modified a running policy');
  console.log('PASS: ownership recovers, survives reload and shell exit, and respects explicit pending changes.');
 }
}finally{await browser?.close();await kernel.close();await rm(data,{recursive:true,force:true});}
