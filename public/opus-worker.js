/* Same-origin classic Worker; the small vendor bundle embeds its WASM. */
'use strict';
importScripts('vendor/ogg-opus-decoder-1.7.5.min.js');
let decoder=null,queue=Promise.resolve();
// Opus granules count the encoder delay. Keep exactly the playable frames,
// including EOS trim, so WASM and native decoding use identical loop timing.
function playableFrames(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let position=0,preSkip=null,last=null;
  while(position<bytes.length){
    if(position+27>bytes.length||String.fromCharCode(...bytes.subarray(position,position+4))!=='OggS')throw Error('Opus 容器不完整。');
    const segments=bytes[position+26],body=position+27+segments;
    if(body>bytes.length)throw Error('Opus 容器不完整。');
    let size=0;for(let i=position+27;i<body;i++)size+=bytes[i];
    if(body+size>bytes.length)throw Error('Opus 容器不完整。');
    if(preSkip===null){
      if(size<19||String.fromCharCode(...bytes.subarray(body,body+8))!=='OpusHead')throw Error('Opus 文件头无效。');
      preSkip=view.getUint16(body+10,true);
    }
    if(bytes[position+5]&4)last=view.getUint32(position+6,true)+view.getUint32(position+10,true)*4294967296;
    position=body+size;
  }
  if(last===null||last<=preSkip)throw Error('Opus 音频长度无效。');
  return last-preSkip;
}
self.onmessage=({data})=>{
  queue=queue.then(async()=>{
    try{
      if(!decoder){decoder=new self['ogg-opus-decoder'].OggOpusDecoder();await decoder.ready}
      const bytes=new Uint8Array(data.bytes),frames=playableFrames(bytes);
      const decoded=await decoder.decodeFile(bytes);
      if(decoded.errors.length||!decoded.samplesDecoded||!decoded.channelData.length)throw Error('Opus 采样解码失败，资源可能损坏。');
      if(decoded.sampleRate!==48000||decoded.channelData.some(c=>c.length<frames))throw Error('Opus 采样长度不完整。');
      const channels=decoded.channelData.map(c=>c.slice(0,frames));
      self.postMessage({id:data.id,channelData:channels,samplesDecoded:frames,sampleRate:48000},channels.map(c=>c.buffer));
    }catch(error){self.postMessage({id:data.id,error:error.message||'Opus 解码失败。'})}
    finally{
      try{await decoder?.reset()}catch{decoder?.free();decoder=null}
    }
  });
};
