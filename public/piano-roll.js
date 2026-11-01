/* A small piano roll: drag notes, resize their right edge, pan and overview zoom. */
'use strict';
window.KroseRoll=class {
  constructor(hooks){
    this.hooks=hooks;this.view={start:0,end:5,low:47,high:75};this.key=null;this.drag=null;this.note=null;this.events=[];this.duration=1;
    this.editor=document.getElementById('rollEditor');this.svg=document.getElementById('recordRoll');this.overview=document.getElementById('rollOverview');this.overSvg=document.getElementById('overviewNotes');
    this.liveCanvas=document.createElement('canvas');this.liveCanvas.className='live-roll-canvas';this.liveCanvas.hidden=true;this.editor.append(this.liveCanvas);
    this.liveOverview=document.createElement('canvas');this.liveOverview.className='live-overview-canvas';this.liveOverview.hidden=true;this.overview.prepend(this.liveOverview);
    this.liveCanvas.width=1000;this.liveCanvas.height=230;this.liveOverview.width=1000;this.liveOverview.height=40;
    this.editor.onpointerdown=e=>this.begin(e);this.editor.onpointermove=e=>this.move(e);this.editor.onpointerup=e=>this.end(e);this.editor.onpointercancel=()=>{this.hooks.preview?.(null);this.drag=null;this.draw(this.events,this.duration,this.live)};
    this.overview.onpointerdown=e=>this.beginOverview(e);this.overview.onpointermove=e=>this.moveOverview(e);this.overview.onpointerup=()=>this.drag=null;this.overview.onpointercancel=()=>this.drag=null;
    document.getElementById('rollFit').onclick=()=>{this.fit();this.draw(this.events,this.duration,this.live)};
    this.editor.onkeydown=e=>{if(e.target.id==='recordPosition'&&!this.live){let at=this.cursorSeconds||0;if(e.key==='ArrowLeft')at-=e.shiftKey?1:.1;else if(e.key==='ArrowRight')at+=e.shiftKey?1:.1;else if(e.key==='Home')at=0;else if(e.key==='End')at=this.duration;else return;e.preventDefault();e.stopPropagation();this.hooks.seek?.(at);return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.stopPropagation();this.hooks.undo()}};
  }
  fit(){const notes=this.hooks.notes(this.events,this.duration);let low=48,high=72;for(const n of notes){low=Math.min(low,n.note);high=Math.max(high,n.note)}this.view={start:0,end:Math.max(1,this.duration+.15),low:Math.max(0,low-2),high:Math.min(128,high+3)}}
  node(tag,attrs,parent=this.svg){const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));parent.append(el);return el}
  draw(events,duration,live=false){
    if(live){this.drawLive(events,duration);return}
    this.liveCanvas.hidden=true;this.liveOverview.hidden=true;this.svg.style.visibility='visible';this.overSvg.style.visibility='visible';
    this.events=events;this.duration=Math.max(.1,duration);this.live=live;
    const key=live?'live':this.hooks.takeId();if(key!==this.key){this.key=key;this.fit();if(live)this.view.end=5}
    if(live&&!this.drag&&duration>this.view.end-.4){const span=this.view.end-this.view.start;this.view.start=Math.max(0,duration-span+.5);this.view.end=this.view.start+span}
    const v=this.view,span=Math.max(.1,v.end-v.start),rows=v.high-v.low;this.svg.replaceChildren();this.overSvg.replaceChildren();
    const defs=this.node('defs',{}),clip=this.node('clipPath',{id:'note-clip'},defs);this.node('rect',{x:44,y:22,width:956,height:208},clip);
    const plot=this.node('g',{'clip-path':'url(#note-clip)'});
    for(let pitch=Math.floor(v.low);pitch<v.high;pitch++){
      const y=22+(v.high-pitch-1)/rows*208,black=[1,3,6,8,10].includes((pitch+1200)%12);
      this.node('rect',{x:0,y,width:1000,height:208/rows,fill:black?'#e8ece1':'#f3f4ee'});
      this.node('line',{x1:44,x2:1000,y1:y,y2:y,class:'roll-grid'});
      if(pitch%12===0){const t=this.node('text',{x:7,y:y+Math.min(10,208/rows-1),class:'roll-axis'});t.textContent=`C${Math.floor(pitch/12)-1}`}
    }
    const step=[.1,.25,.5,1,2,5,10,15,30,60,120,300].find(s=>span/s<=10)||600;
    for(let t=Math.ceil(v.start/step)*step;t<=v.end;t+=step){const x=44+(t-v.start)/span*956;this.node('line',{x1:x,x2:x,y1:22,y2:230,class:'roll-time-grid'});const label=this.node('text',{x:x+4,y:14,class:'roll-axis'});label.textContent=`${Number(t.toFixed(2))}s`}
    if(live)this.node('rect',{x:44,y:22,width:Math.max(0,Math.min(956,(duration-v.start)/span*956)),height:208,class:'record-span'},plot);
    const notes=this.hooks.notes(events,duration),domain=Math.max(this.duration+.3,v.end,.5);this.domain=domain;
    for(const original of notes){
      const n=this.drag?.kind==='note'&&this.drag.note.onIndex===original.onIndex?{...original,...this.drag.preview}:original;
      const y=22+(v.high-n.note-1)/rows*208+1;
      if(n.end>=v.start&&n.start<=v.end&&n.note>=v.low&&n.note<v.high){
        const rect=this.node('rect',{x:44+(n.start-v.start)/span*956,y,width:Math.max(3,(n.end-n.start)/span*956),height:Math.max(3,208/rows-2),rx:1.5,opacity:.4+n.velocity/127*.6,'data-on-index':n.onIndex,class:'editable-note'},plot);
        const title=this.node('title',{},rect);title.textContent=`${n.note} · ${n.start.toFixed(2)}s · ${(n.end-n.start).toFixed(2)}s`;
      }
      this.node('rect',{x:n.start/domain*1000,y:4+(127-n.note)/128*30,width:Math.max(2,(n.end-n.start)/domain*1000),height:2.5},this.overSvg);
    }
    // Put the clipped note layer above the grid backgrounds.
    this.svg.append(plot);this.node('line',{x1:44,x2:44,y1:0,y2:230,class:'roll-time-grid'});
    const windowEl=document.getElementById('rollWindow');windowEl.style.left=`${v.start/domain*100}%`;windowEl.style.width=`${span/domain*100}%`;
    this.position(this.cursorSeconds||0);
    document.getElementById('rollRange').textContent=`${v.start.toFixed(1)}–${v.end.toFixed(1)}s`;
  }
  drawLive(events,duration){
    if(this.liveEvents!==events){this.liveEvents=events;this.liveIndex=0;this.liveNotes=[];this.liveHeld=new Map();this.lastOverview=-Infinity;this.key='live';this.view={start:0,end:5,low:46,high:75}}
    this.events=events;this.duration=Math.max(.01,duration);this.live=true;
    this.liveCanvas.hidden=false;this.liveOverview.hidden=false;this.svg.style.visibility='hidden';this.overSvg.style.visibility='hidden';
    // Process only newly recorded events; retained notes are reused for every frame.
    while(this.liveIndex<events.length){const e=events[this.liveIndex++],key=`${e.channel||0}:${e.note}`;
      if(e.type==='on'){const note={start:e.time,end:null,note:e.note,velocity:e.velocity};this.liveNotes.push(note);if(!this.liveHeld.has(key))this.liveHeld.set(key,[]);this.liveHeld.get(key).push(note)}
      else if(e.type==='off'){const note=this.liveHeld.get(key)?.shift();if(note)note.end=e.time}
    }
    const v=this.view,span=Math.max(.1,v.end-v.start),rows=v.high-v.low;
    if(!this.drag&&duration>v.end-.4){v.start=Math.max(0,duration-span+.5);v.end=v.start+span}
    const c=this.liveCanvas.getContext('2d');c.clearRect(0,0,1000,230);c.font='10px monospace';
    for(let pitch=v.low;pitch<v.high;pitch++){const y=22+(v.high-pitch-1)/rows*208;c.fillStyle=[1,3,6,8,10].includes(pitch%12)?'#e8ece1':'#f3f4ee';c.fillRect(0,y,1000,208/rows);if(pitch%12===0){c.fillStyle='#8a9081';c.fillText(`C${Math.floor(pitch/12)-1}`,7,y+Math.min(10,208/rows-1))}}
    const step=[.1,.25,.5,1,2,5,10,15,30,60,120,300].find(s=>span/s<=10)||600;
    c.strokeStyle='#d6dbce';c.beginPath();for(let t=Math.ceil(v.start/step)*step;t<=v.end;t+=step){const x=44+(t-v.start)/span*956;c.moveTo(x,22);c.lineTo(x,230);c.fillStyle='#8a9081';c.fillText(`${Number(t.toFixed(2))}s`,x+4,14)}c.stroke();
    c.save();c.beginPath();c.rect(44,22,956,208);c.clip();c.fillStyle='#8a9b7717';c.fillRect(44,22,Math.max(0,Math.min(956,(duration-v.start)/span*956)),208);
    for(const n of this.liveNotes){const end=n.end??duration;if(end<v.start||n.start>v.end||n.note<v.low||n.note>=v.high)continue;c.globalAlpha=.4+n.velocity/127*.6;c.fillStyle='#53694f';c.fillRect(44+(n.start-v.start)/span*956,22+(v.high-n.note-1)/rows*208+1,Math.max(3,(end-n.start)/span*956),Math.max(3,208/rows-2))}c.restore();
    this.domain=Math.max(duration+.3,v.end,.5);
    const windowEl=document.getElementById('rollWindow');windowEl.style.left=`${v.start/this.domain*100}%`;windowEl.style.width=`${span/this.domain*100}%`;
    // Overview and labels need fewer updates than the moving notes.
    const now=performance.now();if(now-this.lastOverview>=250||this.drag){this.lastOverview=now;const o=this.liveOverview.getContext('2d');o.clearRect(0,0,1000,40);o.fillStyle='#829078';for(const n of this.liveNotes)o.fillRect(n.start/this.domain*1000,4+(127-n.note)/128*30,Math.max(2,((n.end??duration)-n.start)/this.domain*1000),2.5);document.getElementById('rollRange').textContent=`${v.start.toFixed(1)}–${v.end.toFixed(1)}s`}
  }
  begin(e){
    if(e.button!==0)return;e.preventDefault();this.editor.focus({preventScroll:true});this.editor.setPointerCapture(e.pointerId);
    const b=this.svg.getBoundingClientRect(),rect=e.target.closest('[data-on-index]');
    if(!this.live&&(e.target.closest('#recordPosition')||(e.clientY-b.top)/b.height*230<22)){
      this.hooks.seek?.(this.view.start+((e.clientX-b.left)/b.width*1000-44)/956*(this.view.end-this.view.start));
      this.drag={kind:'cursor',bounds:b};return;
    }
    if(rect&&!this.live){const index=Number(rect.dataset.onIndex),r=rect.getBoundingClientRect();this.hooks.stop();const note=this.hooks.notes(this.events,this.duration).find(n=>n.onIndex===index);if(!note)return;this.drag={kind:'note',x:e.clientX,y:e.clientY,bounds:b,view:{...this.view},note,resize:e.clientX>r.right-Math.min(9,r.width*.3),preview:{start:note.start,end:note.end,note:note.note}};this.hooks.preview?.(note.note,note.velocity)}
    else this.drag={kind:'pan',x:e.clientX,y:e.clientY,bounds:b,view:{...this.view}};
    this.editor.classList.add('is-dragging');
  }
  move(e){
    const d=this.drag;if(d?.kind==='cursor'){this.hooks.seek?.(this.view.start+((e.clientX-d.bounds.left)/d.bounds.width*1000-44)/956*(this.view.end-this.view.start));return}if(!d||!['note','pan'].includes(d.kind))return;const span=d.view.end-d.view.start,dx=(e.clientX-d.x)/(d.bounds.width*.956)*span,dy=(e.clientY-d.y)/(d.bounds.height*208/230)*(d.view.high-d.view.low);
    if(d.kind==='pan'){const start=Math.max(0,Math.min(this.duration+span/2,d.view.start-dx)),rows=d.view.high-d.view.low,low=Math.max(0,Math.min(128-rows,d.view.low+Math.round(dy)));this.view={start,end:start+span,low,high:low+rows}}
    else if(d.resize)d.preview.end=Math.max(d.note.start+.03,Math.round((d.note.end+dx)*1000)/1000);
    else{const start=Math.max(0,Math.round((d.note.start+dx)*1000)/1000);d.preview={start,end:start+d.note.end-d.note.start,note:Math.max(0,Math.min(127,d.note.note-Math.round(dy)))}};
    if(d.kind==='note'&&d.preview.note!==(d.soundingNote??d.note.note)){d.soundingNote=d.preview.note;this.hooks.preview?.(d.preview.note,d.note.velocity)}
    this.draw(this.events,this.duration,this.live);
  }
  end(){this.hooks.preview?.(null);const d=this.drag;this.drag=null;this.editor.classList.remove('is-dragging');if(d?.kind==='note'&&(d.preview.start!==d.note.start||d.preview.end!==d.note.end||d.preview.note!==d.note.note))this.hooks.commit(d.note.onIndex,{start:d.preview.start,duration:d.preview.end-d.preview.start,note:d.preview.note});else this.draw(this.events,this.duration,this.live)}
  beginOverview(e){if(e.button!==0)return;e.preventDefault();this.overview.setPointerCapture(e.pointerId);const edge=e.target.closest('#rollLeft')?'left':e.target.closest('#rollRight')?'right':'window';this.drag={kind:edge,x:e.clientX,bounds:this.overview.getBoundingClientRect(),view:{...this.view},domain:this.domain};if(!e.target.closest('#rollWindow')){const span=this.view.end-this.view.start,start=Math.max(0,Math.min(this.domain-span,(e.clientX-this.drag.bounds.left)/this.drag.bounds.width*this.domain-span/2));this.view.start=start;this.view.end=start+span;this.drag.view={...this.view};this.draw(this.events,this.duration,this.live)}}
  moveOverview(e){const d=this.drag;if(!d||!['left','right','window'].includes(d.kind))return;const delta=(e.clientX-d.x)/d.bounds.width*d.domain,min=.25;if(d.kind==='left')this.view.start=Math.max(0,Math.min(d.view.end-min,d.view.start+delta));else if(d.kind==='right')this.view.end=Math.max(d.view.start+min,Math.min(d.domain,d.view.end+delta));else{const span=d.view.end-d.view.start,start=Math.max(0,Math.min(d.domain-span,d.view.start+delta));this.view.start=start;this.view.end=start+span}this.draw(this.events,this.duration,this.live)}
  position(seconds){
    this.cursorSeconds=seconds;const el=document.getElementById('recordPosition'),fraction=(seconds-this.view.start)/(this.view.end-this.view.start);
    el.hidden=fraction<0||fraction>1;el.disabled=!!this.live;el.style.left=`${4.4+95.6*fraction}%`;
    el.setAttribute('aria-valuenow',seconds.toFixed(2));el.setAttribute('aria-valuemax',this.duration.toFixed(2));el.setAttribute('aria-valuetext',`${seconds.toFixed(2)} 秒`);el.title=`录音起点 ${seconds.toFixed(2)}s`;
  }
  playhead(seconds){const el=document.getElementById('recordCursor'),fraction=(seconds-this.view.start)/(this.view.end-this.view.start);el.hidden=fraction<0||fraction>1;el.style.left=`${4.4+95.6*fraction}%`}
};
