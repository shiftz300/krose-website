/* Native decoding first; a single lazy Worker handles unsupported Ogg Opus. */
'use strict';
(function(root){
  class Decoder {
    constructor(){this.nativeFailed=false;this.worker=null;this.pending=new Map();this.sequence=0}
    async decode(context,encoded){
      if(!this.nativeFailed){
        // decodeAudioData can detach its input even on failure. Keep the original for WASM.
        try{return await context.decodeAudioData(encoded.slice(0))}catch{this.nativeFailed=true}
      }
      const decoded=await this.decodeWorker(encoded);
      const buffer=context.createBuffer(decoded.channelData.length,decoded.samplesDecoded,decoded.sampleRate);
      decoded.channelData.forEach((channel,index)=>buffer.copyToChannel(channel,index));
      return buffer;
    }
    decodeWorker(encoded){
      return new Promise((resolve,reject)=>{
        try{
          if(!this.worker){
            this.worker=new root.Worker('opus-worker.js');
            this.worker.onmessage=({data})=>{
              const job=this.pending.get(data.id);if(!job)return;
              clearTimeout(job.timer);this.pending.delete(data.id);
              if(data.error)job.reject(new Error(data.error));else job.resolve(data);
            };
            this.worker.onerror=()=>this.close(new Error('Opus 解码器加载失败，请重试。'));
            this.worker.onmessageerror=()=>this.close(new Error('Opus 解码通信失败，请重试。'));
          }
          const id=++this.sequence;
          const timer=setTimeout(()=>this.close(new Error('Opus 解码超时，请重试。')),45000);
          this.pending.set(id,{resolve,reject,timer});
          this.worker.postMessage({id,bytes:encoded},[encoded]);
        }catch(error){this.close(error);reject(error)}
      });
    }
    close(error=new Error('Opus 解码已取消。')){
      this.worker?.terminate();this.worker=null;
      for(const job of this.pending.values()){clearTimeout(job.timer);job.reject(error)}
      this.pending.clear();
    }
  }
  root.KroseOpusDecoder=Decoder;
  if(typeof module!=='undefined')module.exports={Decoder};
})(globalThis);
