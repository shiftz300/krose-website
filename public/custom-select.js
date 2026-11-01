/* Keyboard-accessible, buildless custom combobox. Menus use a viewport portal. */
'use strict';
window.KroseSelect = class {
  constructor(root) {
    this.root=root;this.items=[];this._value='';this._disabled=false;this.active=0;this.opened=false;this.onchange=null;this.search='';
    this.button=document.createElement('button');this.button.type='button';this.button.className='select-trigger';
    this.button.id=`${root.id}-trigger`;this.button.setAttribute('role','combobox');this.button.setAttribute('aria-haspopup','listbox');this.button.setAttribute('aria-expanded','false');
    this.button.setAttribute('aria-label',root.dataset.label);this.button.setAttribute('aria-controls',`${root.id}-menu`);
    this.label=document.createElement('span');this.button.append(this.label);root.append(this.button);
    this.menu=document.createElement('div');this.menu.id=`${root.id}-menu`;this.menu.className='select-menu';this.menu.setAttribute('role','listbox');this.menu.setAttribute('aria-label',root.dataset.label);this.menu.setAttribute('aria-hidden','true');this.menu.inert=true;document.body.append(this.menu);
    this.button.onclick=()=>this.opened?this.close():this.open();
    this.button.onkeydown=e=>this.keydown(e);
    this.menu.onpointerdown=e=>e.preventDefault();
    this.menu.onclick=e=>{const option=e.target.closest('[data-option]');if(option)this.select(Number(option.dataset.option))};
    document.addEventListener('pointerdown',e=>{if(!root.contains(e.target)&&!this.menu.contains(e.target))this.close()});
    document.addEventListener('focusin',e=>{if(!root.contains(e.target)&&!this.menu.contains(e.target))this.close()});
    window.addEventListener('resize',()=>this.close());window.addEventListener('scroll',()=>{if(this.opened)this.position()},true);
  }
  setOptions(items) {
    this.close();this.items=items;const old=this._value;this._value=items.some(i=>i.value===old)?old:(items[0]?.value||'');
    this.menu.replaceChildren();
    items.forEach((item,index)=>{const option=document.createElement('button');option.type='button';option.className='select-option';option.id=`${this.root.id}-option-${index}`;option.dataset.option=index;option.setAttribute('role','option');option.tabIndex=-1;option.textContent=item.label;this.menu.append(option)});
    this.refresh();
  }
  get options(){return this.items}
  get value(){return this._value}
  set value(value){if(this.items.some(i=>i.value===value)){this._value=value;this.refresh()}}
  get disabled(){return this._disabled}
  set disabled(value){this._disabled=Boolean(value);this.button.disabled=this._disabled;if(value)this.close()}
  refresh(){this.label.textContent=this.items.find(i=>i.value===this._value)?.label||'—';this.menu.querySelectorAll('[data-option]').forEach((el,i)=>el.setAttribute('aria-selected',String(this.items[i].value===this._value)))}
  position(){
    const r=this.button.getBoundingClientRect(),width=Math.min(r.width,window.innerWidth-16);
    this.menu.style.width=`${width}px`;this.menu.style.left=`${Math.max(8,Math.min(r.left,window.innerWidth-width-8))}px`;
    const below=window.innerHeight-r.bottom,above=r.top,up=below<180&&above>below;
    this.menu.classList.toggle('opens-up',up);this.menu.style.maxHeight=`${Math.max(60,Math.min(280,(up?above:below)-8))}px`;
    if(up){this.menu.style.top='auto';this.menu.style.bottom=`${window.innerHeight-r.top}px`}
    else{this.menu.style.bottom='auto';this.menu.style.top=`${r.bottom}px`}
  }
  open(){if(this._disabled||!this.items.length)return;document.dispatchEvent(new CustomEvent('krose-select-open',{detail:this}));this.opened=true;this.active=Math.max(0,this.items.findIndex(i=>i.value===this._value));this.position();this.menu.inert=false;this.menu.setAttribute('aria-hidden','false');this.menu.classList.add('is-open');this.button.setAttribute('aria-expanded','true');this.highlight()}
  close(){this.opened=false;this.menu.inert=true;this.menu.setAttribute('aria-hidden','true');this.menu.classList.remove('is-open');this.button.setAttribute('aria-expanded','false');this.button.removeAttribute('aria-activedescendant')}
  highlight(){this.menu.querySelectorAll('[data-option]').forEach((el,i)=>{el.classList.toggle('is-active',i===this.active);if(i===this.active){this.button.setAttribute('aria-activedescendant',el.id);el.scrollIntoView({block:'nearest'})}})}
  select(index){const item=this.items[index];if(!item)return;const changed=this._value!==item.value;this._value=item.value;this.refresh();this.close();this.button.focus({preventScroll:true});if(changed)this.onchange?.()}
  keydown(e){
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();this.close();return}
    if(e.key==='Tab'){this.close();return}
    if(e.key==='Enter'||e.key===' '){e.preventDefault();if(this.opened)this.select(this.active);else this.open();return}
    if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();if(!this.opened)this.open();else if(e.key==='Home')this.active=0;else if(e.key==='End')this.active=this.items.length-1;else this.active=(this.active+(e.key==='ArrowDown'?1:-1)+this.items.length)%this.items.length;this.highlight();return}
    if(e.key.length===1){e.preventDefault();clearTimeout(this.searchTimer);this.search+=e.key.toLowerCase();this.searchTimer=setTimeout(()=>this.search='',700);if(!this.opened)this.open();const i=this.items.findIndex(item=>item.label.toLowerCase().startsWith(this.search));if(i>=0){this.active=i;this.highlight()}}
  }
};
document.addEventListener('krose-select-open',e=>document.querySelectorAll('.custom-select').forEach(root=>{if(root.kroseSelect&&root.kroseSelect!==e.detail)root.kroseSelect.close()}));
