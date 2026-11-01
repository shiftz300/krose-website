'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Decoder}=require('../public/opus-decoder.js');
const publicRoot=path.resolve(__dirname,'../public'),catalog=JSON.parse(fs.readFileSync(path.join(publicRoot,'catalog.json')));
const reference=JSON.parse(fs.readFileSync(require.resolve('./fixtures/opus-pcm-reference.json'))).samples;
const originalWorker=globalThis.Worker;let created=0;
// Exercise the shipped classic Worker and shipped browser UMD, not an alternate Node decoder.
class BrowserWorker {
 constructor(url){
  created++;assert.equal(url,'opus-worker.js');this.terminated=false;
  const scope={console,TextDecoder,TextEncoder,WebAssembly,URL,Blob,performance,atob,btoa,setTimeout,clearTimeout,Uint8Array,Uint16Array,Uint32Array,Int8Array,Int16Array,Int32Array,Float32Array,Float64Array,ArrayBuffer,DataView,Worker:class{}};
  this.scope=vm.createContext(scope);scope.self=this.scope;
  scope.importScripts=file=>{assert.equal(file,'vendor/ogg-opus-decoder-1.7.5.min.js');vm.runInContext(fs.readFileSync(path.join(publicRoot,file),'utf8'),this.scope)};
  scope.postMessage=(data,transfer)=>{const copy=structuredClone(data,{transfer});queueMicrotask(()=>{if(!this.terminated)this.onmessage?.({data:copy})})};
  vm.runInContext(fs.readFileSync(path.join(publicRoot,url),'utf8'),this.scope);
 }
 postMessage(data,transfer){const copy=structuredClone(data,{transfer});queueMicrotask(()=>{if(!this.terminated)this.scope.self.onmessage({data:copy})})}
 terminate(){this.terminated=true}
}
function encoded(id){const s=catalog.samples[id],p=catalog.packs[s.pack],bytes=fs.readFileSync(path.join(publicRoot,p.file));return Uint8Array.from(bytes.subarray(s.offset,s.offset+s.length)).buffer}
let attempts=0;
const context={
 async decodeAudioData(bytes){attempts++;structuredClone(bytes,{transfer:[bytes]});throw new Error('EncodingError')},
 createBuffer(channels,length,rate){return {numberOfChannels:channels,length,sampleRate:rate,channelData:[],copyToChannel(data,ch){this.channelData[ch]=data.slice()}}}
};
(async()=>{
 globalThis.Worker=BrowserWorker;
 const native=new Decoder(),sentinel={native:true};assert.equal(await native.decode({decodeAudioData:async()=>sentinel},encoded('0')),sentinel);assert.equal(created,0);
 const decoder=new Decoder(),ids=['0','10056','10057','10271'];
 const inputs=ids.map(encoded),buffers=await Promise.all(inputs.map(b=>decoder.decode(context,b)));
 assert.equal(created,1);assert(attempts<=ids.length);
 for(let i=0;i<ids.length;i++){
  const b=buffers[i];assert.equal(b.sampleRate,48000);assert.equal(b.numberOfChannels,1);assert.equal(b.length,Math.round(catalog.samples[ids[i]].duration*48000));
  const ref=reference[ids[i]];ref.values.forEach((value,j)=>assert(Math.abs(value-b.channelData[0][ref.offset+j])<.0001,`${ids[i]} PCM alignment ${j}`));
  assert(b.channelData[0].every(Number.isFinite));assert(b.channelData[0].some(x=>Math.abs(x)>1e-6));assert.equal(inputs[i].byteLength,0);
 }
 const attemptsAfter=attempts;
 const again=await decoder.decode(context,encoded('10056'));assert.equal(attempts,attemptsAfter);assert.deepEqual(again.channelData[0],buffers[1].channelData[0]);
 await assert.rejects(decoder.decode(context,new Uint8Array([1,2,3]).buffer),/Opus/);
 const recovered=await decoder.decode(context,encoded('10057'));assert.deepEqual(recovered.channelData[0],buffers[2].channelData[0]);
 decoder.close();assert.equal(decoder.pending.size,0);
 await decoder.decode(context,encoded('0'));assert.equal(created,2);decoder.close();
 // A load/CSP failure rejects all pending jobs and allows a later retry.
 globalThis.Worker=class{constructor(){queueMicrotask(()=>this.onerror())}postMessage(){}terminate(){}};
 const retry=new Decoder();retry.nativeFailed=true;
 const failed=await Promise.allSettled([retry.decode(context,encoded('0')),retry.decode(context,encoded('10056'))]);assert(failed.every(r=>r.status==='rejected'));assert.equal(retry.pending.size,0);
 globalThis.Worker=BrowserWorker;await retry.decode(context,encoded('0'));retry.close();
 const headers=fs.readFileSync(path.join(publicRoot,'_headers'),'utf8');assert(headers.includes("worker-src 'self'"));assert(headers.includes("'wasm-unsafe-eval'"));assert(!headers.includes("'unsafe-eval'"));
 console.log('PASS: native fast path, detached-input fallback, shipped WASM/Worker decoding of real onboard/OASYS samples, exact frame counts, concurrent file isolation, corrupt-file and Worker-load recovery.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{globalThis.Worker=originalWorker});
