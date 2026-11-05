/* TypeScript port of the user-designated root mockup.html particle field
 * (initWebGLFibers/initGhostFibers). Shader and particle equations are
 * preserved; no external library or provider calls. */
export interface FiberController { stop(): void }

function initWebGLFibers(canvas: HTMLCanvasElement, hero: HTMLElement, reduced: MediaQueryList): FiberController | null {
  const possibleGL=canvas.getContext('webgl2',{alpha:true,antialias:false,powerPreference:'low-power'});
  if(!possibleGL)return null;
  const gl=possibleGL;
  const vertex=`#version 300 es
    precision highp float;
    uniform float uTime;
    uniform float uMouse;
    uniform float uPixels;
    uniform float uLight;
    out vec3 vColor;
    out float vAlpha;
    const int DOTS=128;
    const int THREADS=56;
    void main(){
      int bead=gl_VertexID%DOTS;
      int fiber=(gl_VertexID/DOTS)%THREADS;
      int layer=gl_VertexID/(DOTS*THREADS);
      float s=float(bead)/float(DOTS-1);
      float v=float(fiber)/float(THREADS-1)*2.0-1.0;
      float phase=float(layer)*2.22+0.22;
      float edge=sin(3.14159265*s);
      float twist=s*7.3+phase+uTime*0.16+0.2*sin(s*7.0-uTime*0.35);
      float fold=pow(1.0-abs(cos(twist)),6.0);
      float base=0.5+(float(layer)-1.0)*0.155;
      float span=mix(0.3,0.43,1.0-abs(float(layer)-1.0));
      float wave=0.084*sin(s*7.1+phase+uTime*0.42)+0.036*sin(s*12.8-phase-uTime*0.22);
      float x=-0.14+1.28*s+v*sin(twist)*0.105*edge;
      float y=base+wave+v*cos(twist)*span*0.5+(float(layer)-1.0)*0.028*(s-0.5)+uMouse*0.012*(s-0.5);
      gl_Position=vec4(x*2.0-1.0,1.0-y*2.0,0.0,1.0);
      float near=0.62+0.38*(1.0-v*0.5);
      gl_PointSize=(2.5+fold*4.1+near*1.2)*uPixels*(1.18+uLight*0.62);
      float fade=pow(max(edge,0.0),0.6);
      float gain=mix(0.69,1.0,1.0-abs(float(layer)-1.0));
      vAlpha=min(1.0,fade*gain*(0.12+fold*0.47+near*0.12)*(1.45+uLight*2.35));
      vec3 darkFiber=mix(vec3(0.16,0.43,1.0),vec3(0.55,0.84,1.0),near);
      darkFiber=mix(darkFiber,vec3(0.94,0.99,1.0),fold*0.76);
      vec3 lightFiber=mix(vec3(0.035,0.18,0.42),vec3(0.055,0.3,0.63),near);
      lightFiber=mix(lightFiber,vec3(0.04,0.34,0.76),fold*0.65);
      vColor=mix(darkFiber,lightFiber,uLight);
    }`;
  const fragment=`#version 300 es
    precision highp float;
    in vec3 vColor;
    in float vAlpha;
    out vec4 outColor;
    void main(){
      float r=length(gl_PointCoord-vec2(0.5))*2.0;
      float core=1.0-smoothstep(0.04,0.38,r);
      float halo=(1.0-smoothstep(0.12,1.0,r))*0.32;
      outColor=vec4(vColor,vAlpha*(core+halo));
    }`;
  function shader(type: number, source: string): WebGLShader | null {
    const item=gl.createShader(type);if(!item)return null;gl.shaderSource(item,source);gl.compileShader(item);
    if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)){gl.deleteShader(item);return null;}
    return item;
  }
  const vs=shader(gl.VERTEX_SHADER,vertex),fs=shader(gl.FRAGMENT_SHADER,fragment);
  if(!vs||!fs){if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);return null;}
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  gl.deleteShader(vs);gl.deleteShader(fs);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteProgram(program);return null;}
  const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.useProgram(program);
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
  const timeUniform=gl.getUniformLocation(program,'uTime');
  const mouseUniform=gl.getUniformLocation(program,'uMouse');
  const pixelUniform=gl.getUniformLocation(program,'uPixels');
  const lightUniform=gl.getUniformLocation(program,'uLight');
  let frame=0,visible=true,disposed=false,mouse=0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function draw(time: number): void {
    if(disposed)return;
    const light=document.documentElement.dataset['theme']!=='dark';
    gl.blendFunc(gl.SRC_ALPHA,light?gl.ONE_MINUS_SRC_ALPHA:gl.ONE);
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(timeUniform,reduced.matches?0:time*.001);
    gl.uniform1f(mouseUniform,mouse);
    gl.uniform1f(pixelUniform,Math.min(devicePixelRatio||1,1));
    gl.uniform1f(lightUniform,light?1:0);
    gl.drawArrays(gl.POINTS,0,128*56*3);
  }
  function tick(time: number): void {
    if(disposed||reduced.matches||!visible||document.hidden)return;
    draw(time);schedule();
  }
  function schedule(){timer=setTimeout(()=>{frame=requestAnimationFrame(tick);},75);}
  function start(){clearTimeout(timer);cancelAnimationFrame(frame);draw(performance.now());if(!reduced.matches&&visible&&!document.hidden)schedule();}
  function resize(){
    const bounds=hero.getBoundingClientRect();const scale=Math.min(devicePixelRatio||1,1);
    canvas.width=Math.max(1,Math.round(bounds.width*scale));canvas.height=Math.max(1,Math.round(bounds.height*scale));start();
  }
  function onPointer(event: PointerEvent): void {const bounds=hero.getBoundingClientRect();mouse=(event.clientY-bounds.top)/Math.max(bounds.height,1)-.5;}
  function pause(){clearTimeout(timer);cancelAnimationFrame(frame);}
  function onVisibility(){if(document.hidden)pause();else start();}
  const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;if(visible)start();else pause();},{threshold:0}):null;
  const resizer='ResizeObserver' in window?new ResizeObserver(resize):null;
  const themeObserver=new MutationObserver(start);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  observer?.observe(hero);resizer?.observe(hero);
  if(!resizer)window.addEventListener('resize',resize);
  hero.addEventListener('pointermove',onPointer,{passive:true});
  document.addEventListener('visibilitychange',onVisibility);
  reduced.addEventListener('change',start);
  resize();
  return {stop(){disposed=true;pause();observer?.disconnect();resizer?.disconnect();themeObserver.disconnect();if(!resizer)window.removeEventListener('resize',resize);hero.removeEventListener('pointermove',onPointer);document.removeEventListener('visibilitychange',onVisibility);reduced.removeEventListener('change',start);gl.deleteVertexArray(vao);gl.deleteProgram(program);}};
}
export function startLandingFibers(element: HTMLCanvasElement, hero: HTMLElement): FiberController | null {
  let canvas=element;
  if(typeof window.matchMedia!=='function')return null;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const gpu=initWebGLFibers(canvas,hero,reduced);
  if(gpu){hero.dataset['fiberRenderer']='webgl2';return gpu;}
  let possibleContext=canvas.getContext('2d',{alpha:true});
  if(!possibleContext){const replacement=canvas.cloneNode() as HTMLCanvasElement;canvas.replaceWith(replacement);canvas=replacement;possibleContext=canvas.getContext('2d',{alpha:true});}
  if(!possibleContext)return null;
  const context=possibleContext;
  hero.dataset['fiberRenderer']='canvas2d';
  const makeDot=(core: string,halo: string): HTMLCanvasElement => {
    const dot=document.createElement('canvas');dot.width=dot.height=32;
    const ink=dot.getContext('2d');if(!ink)return dot;
    const glow=ink.createRadialGradient(16,16,0,16,16,16);
    glow.addColorStop(0,core);glow.addColorStop(.17,core);
    glow.addColorStop(.38,halo);glow.addColorStop(1,'rgba(0,0,0,0)');
    ink.fillStyle=glow;ink.fillRect(0,0,32,32);return dot;
  };
  const darkDots=[makeDot('rgba(132,202,255,1)','rgba(44,126,239,.32)'),makeDot('rgba(222,247,255,1)','rgba(94,183,255,.52)'),makeDot('rgba(76,140,255,1)','rgba(36,87,207,.3)')] as const;
  const lightDots=[makeDot('rgba(25,75,137,1)','rgba(56,115,191,.27)'),makeDot('rgba(14,82,167,1)','rgba(67,137,215,.38)'),makeDot('rgba(16,50,109,1)','rgba(42,94,172,.24)')] as const;
  let width=0,height=0,frame=0,visible=true,mouseY=0,disposed=false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function draw(time: number): void {
    if(!width||!height)return;
    context.clearRect(0,0,width,height);
    const light=document.documentElement.dataset['theme']!=='dark';
    const dots=light?lightDots:darkDots;
    context.globalCompositeOperation=light?'source-over':'screen';
    const drift=reduced.matches?0:time*.00028;
    const narrow=width<700;
    const threadCount=narrow?20:30;
    const beadCount=narrow?60:82;
    const bands=[
      {base:.34,span:.29,phase:.15,tilt:-.08,gain:.64},
      {base:.5,span:.37,phase:2.35,tilt:-.14,gain:1},
      {base:.66,span:.25,phase:4.4,tilt:.1,gain:.68}
    ];
    for(const [layer,band] of bands.entries()){
      for(let fiber=0;fiber<threadCount;fiber++){
        const v=(fiber/(threadCount-1))*2-1;
        for(let bead=0;bead<beadCount;bead++){
          const u=bead/(beadCount-1);
          const edge=Math.sin(Math.PI*u);
          const twist=7.4*u+band.phase+drift*.65+.22*Math.sin(u*7-drift);
          const fold=Math.pow(1-Math.abs(Math.cos(twist)),8);
          const center=band.base+band.tilt*(u-.5)+.085*Math.sin(u*7.5+band.phase+drift)+.047*Math.sin(u*13-band.phase-drift*.7);
          const spread=band.span*(.52+.48*edge);
          const x=width*(-.13+1.26*u)+v*Math.sin(twist)*width*.115*edge;
          const y=height*(center+v*Math.cos(twist)*spread*.5)+mouseY*.015*(u-.5);
          if(x<-12||x>width+12||y<-12||y>height+12)continue;
          const fade=Math.pow(edge,.55)*(.55+.45*Math.cos(v*1.2));
          const near=.52+.48*(1-v*.5);
          const sparkle=(fiber*17+bead*31+layer*13)%127===0?1.65:1;
          const size=(.8+near*.78+fold*.45)*sparkle*(narrow?.82:1);
          const alpha=Math.min(.95,band.gain*fade*(.17+fold*.46+near*.11)*(light?3:1.4));
          context.globalAlpha=alpha;
          const dot=fold>.58?dots[1]:(layer===0&&v<-.25?dots[2]:dots[0]);
          context.drawImage(dot,x-size*4,y-size*4,size*8,size*8);
        }
      }
    }
    context.globalAlpha=1;
    const bloom=context.createRadialGradient(width*.72,height*.4,0,width*.72,height*.4,width*.45);
    bloom.addColorStop(0,light?'rgba(70,144,230,.06)':'rgba(42,118,230,.12)');bloom.addColorStop(1,'rgba(42,118,230,0)');
    context.fillStyle=bloom;context.fillRect(0,0,width,height);
    context.globalCompositeOperation='source-over';
  }
  function tick(time: number): void {
    if(disposed||reduced.matches||!visible||document.hidden)return;
    draw(time);schedule();
  }
  function schedule(){timer=setTimeout(()=>{frame=requestAnimationFrame(tick);},110);}
  function start(){clearTimeout(timer);cancelAnimationFrame(frame);draw(performance.now());if(!reduced.matches&&visible&&!document.hidden)schedule();}
  function resize(){
    const bounds=hero.getBoundingClientRect();
    width=Math.max(1,Math.round(bounds.width));height=Math.max(1,Math.round(bounds.height));
    const scale=Math.min(devicePixelRatio||1,1);
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
    context.setTransform(scale,0,0,scale,0,0);start();
  }
  function onPointer(event: PointerEvent): void {const bounds=hero.getBoundingClientRect();mouseY=event.clientY-bounds.top-height/2;}
  function pause(){clearTimeout(timer);cancelAnimationFrame(frame);}
  function onVisibility(){if(document.hidden)pause();else start();}
  const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;if(visible)start();else pause();},{threshold:0}):null;
  const resizer='ResizeObserver' in window?new ResizeObserver(resize):null;
  const themeObserver=new MutationObserver(start);
  themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  observer?.observe(hero);resizer?.observe(hero);
  if(!resizer)window.addEventListener('resize',resize);
  hero.addEventListener('pointermove',onPointer,{passive:true});
  document.addEventListener('visibilitychange',onVisibility);
  reduced.addEventListener('change',start);
  resize();
  return {stop(){disposed=true;pause();observer?.disconnect();resizer?.disconnect();themeObserver.disconnect();if(!resizer)window.removeEventListener('resize',resize);hero.removeEventListener('pointermove',onPointer);document.removeEventListener('visibilitychange',onVisibility);reduced.removeEventListener('change',start);}};
}
