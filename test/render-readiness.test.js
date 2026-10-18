"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {renderDeck} = require("../lib/render.js");
test("pre-aborted whole-run render refuses before spawning", async () => {
 const controller = new AbortController(); controller.abort();
 const result = await renderDeck({title:"Fixture",slides:[{layout:"01-editorial-statement",headline:"Fixture"}]}, {chromePath:"/usr/bin/false",signal:controller.signal,timeoutMs:1000,unattendedTextOnly:true});
 assert.equal(result.error,"render_aborted");
 assert.equal(result.shutdown.spawned,false);
});

const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const {runBoundedRenderer,textOnlyInput} = require("../lib/render.js");
const gone = pid => { try {process.kill(pid,0);return false;} catch(e){return e.code==="ESRCH";} };
test("deadline and mid-run abort reap a worker and its descendant", {skip:process.platform==="win32",timeout:8000}, async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"renderer-tree-test-"));
 try {
  for(const abort of [false,true]) {
   const file=path.join(dir,abort?"abort.json":"timeout.json");
   const controller=new AbortController();
   const code=`const fs=require('node:fs'),{spawn}=require('node:child_process');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});fs.writeFileSync(process.argv[1],JSON.stringify({worker:process.pid,child:c.pid}));setInterval(()=>{},1000);`;
   const promise=runBoundedRenderer(["-e",code,file],{timeoutMs:abort?4000:500,signal:controller.signal});
   const until=Date.now()+2000;while(!fs.existsSync(file)&&Date.now()<until)await new Promise(r=>setTimeout(r,10));
   assert.ok(fs.existsSync(file));if(abort)controller.abort();
   const result=await promise;const pids=JSON.parse(fs.readFileSync(file));
   assert.equal(result.error,abort?"render_aborted":"render_timeout");
   assert.equal(result.shutdown.childExited,true);assert.equal(result.shutdown.processGroupExited,true);
   assert.equal(gone(pids.worker),true);assert.equal(gone(pids.child),true);
  }
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("unattended text input rejects remote images and external CSS",()=>{
 assert.throws(()=>textOnlyInput({slides:[{image:"relative.png"}]}));
 assert.throws(()=>textOnlyInput({headline:"url(https://example.invalid/a)"}));
});

test("malformed signal never spawns a worker",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bad-render-signal-")),file=path.join(dir,"started");
 try {
  await assert.rejects(runBoundedRenderer(['-e',"require('node:fs').writeFileSync(process.argv[1],'started');setInterval(()=>{},1000)",file],{signal:{},timeoutMs:100}));
  await new Promise(r=>setTimeout(r,60));assert.equal(fs.existsSync(file),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("default host brand cannot open an external font or extra asset roots",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bad-render-brand-")),marker=path.join(dir,"browser-started");
 try {
  const font=path.join(dir,"host.woff2"),browser=path.join(dir,"fake-browser");fs.writeFileSync(font,"fixture");
  fs.writeFileSync(browser,`#!/bin/sh\necho started > '${marker}'\nexit 9\n`,{mode:0o700});
  fs.writeFileSync(path.join(dir,"brand.json"),JSON.stringify({fonts:{body:{family:"Fixture",file:font}}}));
  const {renderJobs}=await import(require('node:url').pathToFileURL(path.join(__dirname,'../render.mjs')).href);
  const result=await renderJobs([{name:'fixture',layout:'01-editorial-statement',fields:{headline:'Fixture'},out:path.join(dir,'out.png'),baseDir:dir}],{dataDir:dir,chromePath:browser,unattendedTextOnly:true,timeoutMs:1000});
  assert.equal(result.ok,false);assert.equal(fs.existsSync(marker),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
