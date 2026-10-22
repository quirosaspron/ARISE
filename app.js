import * as THREE from 'three';
import URDFLoader from './vendor/urdf/URDFLoader.js';
import { loadPackedModels } from './packed-model.js';
import { t, initLanguage } from './i18n.js';

initLanguage();

const panels=[...document.querySelectorAll('.panel')];
const track=document.querySelector('.track');
const journey=document.querySelector('#journey');
const viewport=document.querySelector('.viewport');
const progress=document.querySelector('.progress');
const motionButton=document.querySelector('#motion-toggle');
const media=matchMedia('(prefers-reduced-motion: reduce)');
const initialHash=location.hash;
let reading=media.matches&&innerWidth>700, target=0, current=0, last=0, frame=0, robot=null, renderer=null, camera=null, scene=null, shadow=null;
let travel=0, velocity=0, motion=0, stopped=false;
const stage=document.querySelector('.robot-stage');
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
let active=0, navigationSequence=0;
let measuredWindowWidth=innerWidth, mobileViewportHeight=0, lastLayoutMobile=innerWidth<=700;
let layoutRevision=0, ignoredViewportResizes=0;

function updateUI(index,fraction){
  active=index;
  document.querySelectorAll('.rail nav a').forEach((a,i)=>{if(i===index)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  document.querySelector('#counter').textContent=`${String(index+1).padStart(2,'0')} / ${String(panels.length).padStart(2,'0')}`;
  progress.setAttribute('aria-valuenow',Math.round(fraction*100));
  progress.firstElementChild.style.width=`${fraction*100}%`;
  document.querySelector('#previous').disabled=index===0;
  document.querySelector('#next').disabled=index===panels.length-1;
}

function measure(resetViewport=false){
  const mobile=innerWidth<=700;
  const root=document.documentElement;
  if(mobile){
    if(resetViewport===true||!mobileViewportHeight){
      root.style.removeProperty('--mobile-viewport-height');
      mobileViewportHeight=viewport.clientHeight;
      root.style.setProperty('--mobile-viewport-height',mobileViewportHeight+'px');
    }
    root.toggleAttribute('data-short-screen',mobileViewportHeight<=730);
    root.toggleAttribute('data-compact-screen',mobileViewportHeight<=600);
  }else{
    mobileViewportHeight=0;
    root.style.removeProperty('--mobile-viewport-height');
    root.removeAttribute('data-short-screen');root.removeAttribute('data-compact-screen');
  }
  measuredWindowWidth=innerWidth;lastLayoutMobile=mobile;
  stage.dataset.layoutRevision=String(++layoutRevision);
  if(!reading) journey.style.height=((innerWidth<=700?viewport.clientHeight:innerHeight)+viewport.clientWidth*(panels.length-1))+'px';
  if(innerWidth<=700){
    const top=viewport.getBoundingClientRect().top;
    const contentBottom=Math.max(...panels.map(panel=>panel.querySelector('.copy').getBoundingClientRect().bottom-top));
    stage.style.setProperty('--mobile-stage-top',Math.ceil(contentBottom+12)+'px');
  }else stage.style.removeProperty('--mobile-stage-top');
  if(renderer){
    const ratio=mobile?Math.min(Math.max(devicePixelRatio,2),2.5):Math.min(devicePixelRatio,1.6);
    if(renderer.getPixelRatio()!==ratio)renderer.setPixelRatio(ratio);
    const width=stage.clientWidth,height=Math.max(1,stage.clientHeight);
    if(renderer.domElement.width!==Math.floor(width*ratio)||renderer.domElement.height!==Math.floor(height*ratio))renderer.setSize(width,height,false);
    stage.dataset.pixelRatio=String(ratio);
  }
  readScroll();
}
function readScroll(){
  if(reading){
    let i=0;panels.forEach((p,j)=>{if(p.getBoundingClientRect().top<innerHeight*.5)i=j;});
    updateUI(i,i/(panels.length-1));
  }else target=clamp(scrollY/Math.max(1,journey.offsetHeight-(innerWidth<=700?viewport.clientHeight:innerHeight)))*(panels.length-1);
  requestFrame();
}
function go(index,focus=false,jump=false){
  const focusDeadline=performance.now()+2500;
  const sequence=++navigationSequence;
  index=clamp(index,0,panels.length-1);
  if(reading) panels[index].scrollIntoView({behavior:'auto',block:'start'});
  else {
    if(jump){
      current=target=index;velocity=motion=0;
      track.style.transform=`translate3d(${-index*viewport.clientWidth}px,0,0)`;
      panels.forEach((p,i)=>p.inert=i!==index);
      updateUI(index,index/(panels.length-1));
    }
    window.scrollTo({top:index*viewport.clientWidth,behavior:jump?'auto':'smooth'});
    requestFrame();
  }
  history.replaceState(null,'',`#${panels[index].id}`);
  if(focus){
    // Focus the destination after it becomes visible, so inert never swallows focus.
    const focusPanel=()=>{
      if(sequence!==navigationSequence||performance.now()>focusDeadline)return;
      if(!reading&&Math.abs(current-index)>.08){
        requestAnimationFrame(focusPanel);return;
      }
      panels[index].inert=false;panels[index].setAttribute('tabindex','-1');panels[index].focus({preventScroll:true});
    };
    requestAnimationFrame(focusPanel);
  }
}
document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{
  const i=panels.findIndex(p=>`#${p.id}`===a.getAttribute('href'));
  if(i<0)return;e.preventDefault();go(i,true,a.hasAttribute('data-jump'));
}));
document.querySelector('#previous').addEventListener('click',()=>go(active-1));
document.querySelector('#next').addEventListener('click',()=>go(active+1));
addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.target.matches('input,textarea,select,button,a'))return;
  if(e.key==='ArrowRight'){e.preventDefault();go(active+1);}
  if(e.key==='ArrowLeft'){e.preventDefault();go(active-1);}
});
// Native vertical scrolling remains intact, including touch, keyboard and scrollbar.
addEventListener('scroll',readScroll,{passive:true});
addEventListener('resize',()=>{
  // Safari's toolbar changes the visible height during scroll. Keep the mobile
  // composition and scroll position stable; only reflow when the width changes.
  if(innerWidth<=700&&lastLayoutMobile&&innerWidth===measuredWindowWidth){
    stage.dataset.ignoredViewportResizes=String(++ignoredViewportResizes);return;
  }
  const position=current;measure(true);
  if(!reading){current=target=position;window.scrollTo({top:position*viewport.clientWidth,behavior:'auto'});requestFrame();}
});
function syncMotionLabels(){
  motionButton.textContent=t(reading?'motion.off':'motion.on');
  motionButton.title=t(reading?'motion.start':'motion.stop');
  document.querySelector('.scroll-hint').textContent=t(reading?'scroll.reading':'scroll.hint');
}
function setReading(value){
  const previous=active;reading=innerWidth<=700?false:value;
  document.body.classList.toggle('reading',reading);
  syncMotionLabels();
  motionButton.setAttribute('aria-pressed',String(reading));
  measure();go(previous,false,true);requestFrame();
}
motionButton.addEventListener('click',()=>setReading(!reading));
media.addEventListener('change',e=>setReading(e.matches&&innerWidth>700));
addEventListener('arise:languagechange',()=>{syncMotionLabels();measure();requestFrame();});

function modelMessage(key){
  const status=document.querySelector('.loading');
  status.dataset.modelMessage=key;
  status.textContent=t(key);
}


async function loadScene(){
 const status=document.querySelector('.loading');
 const loadStarted=performance.now();
 try{
  THREE.Object3D.DEFAULT_UP.set(0,0,1);
  scene=new THREE.Scene();
  renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setClearColor(0xffffff,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;
  document.querySelector('#robot-canvas').append(renderer.domElement);
  camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,30);
  camera.position.set(0,-4,.65);camera.up.set(0,0,1);camera.lookAt(0,0,.23);
  scene.add(new THREE.HemisphereLight(0xffffff,0x8a8f96,2));
  const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(-2,-3,5);scene.add(key);
  const rim=new THREE.DirectionalLight(0xffffff,1.5);rim.position.set(2,3,3);scene.add(rim);
  const s=document.createElement('canvas');s.width=s.height=128;const c=s.getContext('2d');
  const g=c.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,'rgba(25,30,40,.19)');g.addColorStop(.5,'rgba(25,30,40,.06)');g.addColorStop(1,'rgba(25,30,40,0)');c.fillStyle=g;c.fillRect(0,0,128,128);
  shadow=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.65),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(s),transparent:true,depthWrite:false}));shadow.visible=false;scene.add(shadow);
  const manager=new THREE.LoadingManager();
  let failed=false;
  manager.onError=url=>{failed=true;stage.dataset.modelState='error';status.hidden=false;modelMessage('model.error');console.error('ARISE asset:',url);};
  manager.onLoad=()=>{if(!robot||failed)return;robot.visible=true;shadow.visible=true;status.hidden=true;stage.dataset.modelState='ready';stage.dataset.modelLoadMs=String(Math.round(performance.now()-loadStarted));measure();requestFrame();};
  const loader=new URDFLoader(manager);
  loader.packages={go2_description:new URL('./assets/go2_description/',import.meta.url).href};
  // Same URDF joints and original Collada transforms, pre-parsed into one pack.
  // Geometry and materials remain shared between copies of each leg.
  const meshes=loadPackedModels();
  meshes.catch(()=>{});
  let meshTicket=0;
  loader.loadMeshCb=(url,manager,done)=>{
   const ticket='packed-mesh-'+(++meshTicket);
   manager.itemStart(ticket);
   meshes.then(models=>{
     const model=models.get(url.split('/').pop());
     if(!model)throw new Error('Missing robot part: '+url);
     done(model.clone(true));
   }).catch(error=>{manager.itemError(ticket);done(null,error);}).finally(()=>manager.itemEnd(ticket));
  };
  loader.load('./assets/go2_description/urdf/go2_description.urdf',model=>{
   robot=model;robot.visible=false;scene.add(robot);pose(0,.016);
  },undefined,error=>{failed=true;stage.dataset.modelState='error';modelMessage('model.error');console.error(error);});
  renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();stopped=true;status.hidden=false;modelMessage('model.contextLost');});
  measure();
 }catch(error){stage.dataset.modelState='error';modelMessage('model.error');console.error(error);}
}

function pose(delta,dt){
 if(!robot)return;
 const mobile=innerWidth<=700;
 const turn=smooth(current/.7);
 const stageHeight=Math.max(1,stage.clientHeight);
 const span=mobile?Math.max(.44+.04*turn,stageHeight/255*(.60+.18*turn)):1.12;
 const width=stage.clientWidth;
 camera.left=-span*width/stageHeight/2;camera.right=-camera.left;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();
 const centerX=mobile?.5:.73;
 const centerY=mobile?(stageHeight<180?.54:.58):.55;
 robot.position.set((centerX-.5)*(camera.right-camera.left),0,.32+(.5-centerY)*span);
 robot.rotation.set(0,0,-Math.PI/2*(1-turn));
 const speed=Math.min(1,Math.abs(delta)*95);
 velocity+=(speed-velocity)*Math.min(1,dt*12);
 motion=velocity*turn;
 travel=current*15;
 for(const [leg,offset] of [['FL',0],['RR',0],['FR',Math.PI],['RL',Math.PI]]){
  const phase=travel+offset;
  const x=.065*Math.cos(phase)*motion;
  const height=.285-.065*Math.max(0,Math.sin(phase))*motion;
  const knee=-Math.acos(clamp((x*x+height*height-2*.213*.213)/(2*.213*.213),-1,1));
  const hip=Math.atan2(-x,height)-knee/2;
  robot.setJointValue(`${leg}_hip_joint`,0);
  robot.setJointValue(`${leg}_thigh_joint`,hip);
  robot.setJointValue(`${leg}_calf_joint`,knee);
 }
 shadow.position.set(robot.position.x,0,robot.position.z-.307);shadow.rotation.z=robot.rotation.z;
 stage.dataset.yaw=robot.rotation.z.toFixed(3);stage.dataset.gaitPhase=travel.toFixed(3);stage.dataset.walking=String(motion>.025);
}
function requestFrame(){if(!frame&&!document.hidden)frame=requestAnimationFrame(render);}
function render(time){
 frame=0;const dt=Math.min((time-last)/1000||.016,.05);last=time;
 if(reading||stopped)return;
 const previous=current;
 current+=(target-current)*(1-Math.exp(-dt*12));
 if(Math.abs(current-target)<.00005)current=target;
 const delta=current-previous;
 track.style.transform=`translate3d(${-current*viewport.clientWidth}px,0,0)`;
 const index=Math.round(current);panels.forEach((p,i)=>p.inert=i!==index);updateUI(index,current/(panels.length-1));
 pose(delta,dt);if(renderer&&camera&&scene)renderer.render(scene,camera);
 if(Math.abs(target-current)>.00001||velocity>.001)requestFrame();
}
addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{last=performance.now();requestFrame();}});
new MutationObserver(()=>{if(reading)panels.forEach(p=>p.inert=false);}).observe(document.body,{attributes:true,attributeFilter:['class']});
setReading(reading);measure();loadScene();
if(document.fonts)document.fonts.ready.then(measure);
const initial=panels.findIndex(p=>`#${p.id}`===initialHash);if(initial>0)go(initial,false,true);
