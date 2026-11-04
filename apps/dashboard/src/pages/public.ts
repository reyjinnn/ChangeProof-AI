/* Public website pages (T-43, FR3-37; Progress UI 3 mockup fidelity).
 * Fixed public routes (#/, #/landing, #/product, …) follow
 * .template-ui/mockup.html structure and class names; manifest-driven
 * #/p/... routes keep the live-manifest behavior. Every CTA resolves to a
 * real in-app destination. Server strings pass through textContent only
 * (NEG3-21 content layer; the API boundary stays server-side). Runtime UI
 * copy is English (FR3-40); mockup Indonesian labels are translated. */

import type { HealthData } from '../../../../src/core/contracts/schemas/http.js';
import type {
  ChangelogEntry,
  PricingSnapshot,
  PublicCta,
  PublicFaq,
  PublicRoute,
  PublicTemplate,
  RoadmapItem,
  SampleReport,
} from '../../../../src/core/contracts/schemas/publicsite.js';
import type { SupportTicket } from '../../../../src/core/contracts/schemas/support.js';

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, changeproofMarkSvg, emptyState, errorState, field, h, iconSvg, pillIcon, staticBadge } from '../components.js';
import type { IconName } from '../icons.js';
import { registerRoute } from '../routes.js';
import { initPublicChrome } from './public-chrome.js';
import { TECH_LOGOS } from './tech-logos.js';

export type Destination =
  | { readonly kind: 'public'; readonly hash: string }
  | { readonly kind: 'login'; readonly hash: string }
  | { readonly kind: 'external'; readonly url: string };

/** CTA destinations resolve inside the app; absolute URLs open outside. */
export function classifyDestination(destination: string, kind: PublicCta['kind']): Destination {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.exec(destination) !== null) return { kind: 'external', url: destination };
  if (kind === 'requires-login') return { kind: 'login', hash: `#/login?return=${encodeURIComponent(destination)}` };
  return { kind: 'public', hash: `#/p${destination}` };
}

export interface ReturnTarget {
  readonly valid: boolean;
  readonly target: string;
}

/**
 * Display-side return-target check for the login notice. Same-app `/app`
 * paths only; anything else renders as plain text, never a link. Real
 * enforcement stays server-side (T-44).
 */
export function validateReturnTarget(raw: string | undefined): ReturnTarget {
  if (raw === undefined || raw === '') return { valid: false, target: '' };
  const ok = /^\/app([/?#]|$)/.exec(raw) !== null && !/[\s\\]/.exec(raw);
  return { valid: ok, target: ok ? raw : '' };
}

function ctaLink(cta: PublicCta, primary: boolean): HTMLElement {
  const dest = classifyDestination(cta.destination, cta.kind);
  if (dest.kind === 'external') {
    const link = h('a', { class: primary ? 'button primary' : 'button', href: dest.url }, [cta.label]);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    return link;
  }
  return h('a', { class: primary ? 'button primary' : 'button', href: dest.hash }, [cta.label]);
}

function ctaRow(ctas: readonly PublicCta[]): HTMLElement {
  const row = h('div', { class: 'cta-row' }, []);
  ctas.forEach((cta, index) => row.appendChild(ctaLink(cta, index === 0)));
  return row;
}

async function load<T>(
  outlet: HTMLElement,
  run: () => Promise<T>,
  render: (value: T) => void | Promise<void>,
): Promise<void> {
  outlet.replaceChildren(emptyState('Loading…', 'Reading the latest published content.'));
  try {
    await render(await run());
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
    outlet.replaceChildren(
      errorState('Content unavailable', message, {
        label: 'Retry',
        onClick: () => {
          void load(outlet, run, render);
        },
      }),
    );
  }
}

/* Ghost fibers (mockup 2026-2227): WebGL2 point field with a canvas-2D
 * fallback. Reduced-motion users get one static frame; no canvas support
 * (or a test DOM) yields null instead of throwing. */

export interface GhostFiberHandle {
  stop(): void;
}

function motionQuery(): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
    return window.matchMedia('(prefers-reduced-motion: reduce)');
  } catch {
    return null;
  }
}

function pixelScale(): number {
  try {
    return Math.min(window.devicePixelRatio || 1, 1);
  } catch {
    return 1;
  }
}

function webglContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', { alpha: true, antialias: false, powerPreference: 'low-power' });
  } catch {
    return null;
  }
}

function canvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', { alpha: true });
  } catch {
    return null;
  }
}

const FIBER_VERTEX = `#version 300 es
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

const FIBER_FRAGMENT = `#version 300 es
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

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const item = gl.createShader(type);
  if (item === null) return null;
  gl.shaderSource(item, source);
  gl.compileShader(item);
  if (gl.getShaderParameter(item, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(item);
    return null;
  }
  return item;
}

function initWebGLFibers(
  canvas: HTMLCanvasElement,
  hero: HTMLElement,
  reduced: MediaQueryList | null,
): GhostFiberHandle | null {
  const gl = webglContext(canvas);
  if (gl === null) return null;
  const vs = compileShader(gl, gl.VERTEX_SHADER, FIBER_VERTEX);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FIBER_FRAGMENT);
  if (vs === null || fs === null) {
    if (vs !== null) gl.deleteShader(vs);
    if (fs !== null) gl.deleteShader(fs);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.useProgram(program);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  const timeUniform = gl.getUniformLocation(program, 'uTime');
  const mouseUniform = gl.getUniformLocation(program, 'uMouse');
  const pixelUniform = gl.getUniformLocation(program, 'uPixels');
  const lightUniform = gl.getUniformLocation(program, 'uLight');
  let frame = 0;
  let timer = 0;
  let visible = true;
  let disposed = false;
  let mouse = 0;

  const draw = (time: number): void => {
    if (disposed) return;
    const light = document.documentElement.dataset['theme'] !== 'dark';
    gl.blendFunc(gl.SRC_ALPHA, light ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(timeUniform, reduced?.matches === true ? 0 : time * 0.001);
    gl.uniform1f(mouseUniform, mouse);
    gl.uniform1f(pixelUniform, pixelScale());
    gl.uniform1f(lightUniform, light ? 1 : 0);
    gl.drawArrays(gl.POINTS, 0, 128 * 56 * 3);
  };
  const schedule = (): void => {
    timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(tick);
    }, 75);
  };
  const tick = (time: number): void => {
    if (disposed || reduced?.matches === true || !visible || document.hidden || !canvas.isConnected) return;
    draw(time);
    schedule();
  };
  const start = (): void => {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
    draw(window.performance.now());
    if (reduced?.matches !== true && visible && !document.hidden) schedule();
  };
  const resize = (): void => {
    const bounds = hero.getBoundingClientRect();
    const scale = pixelScale();
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    start();
  };
  const onPointer = (event: PointerEvent): void => {
    const bounds = hero.getBoundingClientRect();
    mouse = (event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5;
  };
  const pause = (): void => {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
  };
  const onVisibility = (): void => {
    if (document.hidden) pause();
    else start();
  };
  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            visible = entries[0]?.isIntersecting ?? true;
            if (visible) start();
            else pause();
          },
          { threshold: 0 },
        )
      : null;
  const resizer = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  const themeObserver = new MutationObserver(start);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  observer?.observe(hero);
  resizer?.observe(hero);
  if (resizer === null) window.addEventListener('resize', resize);
  hero.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reduced?.addEventListener('change', start);
  resize();
  return {
    stop() {
      disposed = true;
      pause();
      observer?.disconnect();
      resizer?.disconnect();
      themeObserver.disconnect();
      if (resizer === null) window.removeEventListener('resize', resize);
      hero.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced?.removeEventListener('change', start);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}

interface FiberBand {
  readonly base: number;
  readonly span: number;
  readonly phase: number;
  readonly tilt: number;
  readonly gain: number;
}

function makeDot(core: string, halo: string): HTMLCanvasElement | null {
  const dot = document.createElement('canvas');
  dot.width = 32;
  dot.height = 32;
  const ink = canvas2d(dot);
  if (ink === null) return null;
  const glow = ink.createRadialGradient(16, 16, 0, 16, 16, 16);
  glow.addColorStop(0, core);
  glow.addColorStop(0.17, core);
  glow.addColorStop(0.38, halo);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ink.fillStyle = glow;
  ink.fillRect(0, 0, 32, 32);
  return dot;
}

type DotTriple = readonly [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement];

function dotTriple(colors: readonly (readonly [string, string])[]): DotTriple | null {
  const first = colors[0];
  const second = colors[1];
  const third = colors[2];
  if (first === undefined || second === undefined || third === undefined) return null;
  const a = makeDot(first[0], first[1]);
  const b = makeDot(second[0], second[1]);
  const c = makeDot(third[0], third[1]);
  if (a === null || b === null || c === null) return null;
  return [a, b, c];
}

function initCanvasFibers(
  surface: HTMLCanvasElement,
  hero: HTMLElement,
  reduced: MediaQueryList | null,
): GhostFiberHandle | null {
  let context = canvas2d(surface);
  let canvas = surface;
  if (context === null) {
    // A failed WebGL attempt poisons the context type; retry on a clone (mockup 2139).
    const replacement = surface.cloneNode();
    if (!(replacement instanceof HTMLCanvasElement)) return null;
    surface.replaceWith(replacement);
    canvas = replacement;
    context = canvas2d(canvas);
  }
  if (context === null) return null;
  const ink = context;
  const darkDots = dotTriple([
    ['rgba(132,202,255,1)', 'rgba(44,126,239,.32)'],
    ['rgba(222,247,255,1)', 'rgba(94,183,255,.52)'],
    ['rgba(76,140,255,1)', 'rgba(36,87,207,.3)'],
  ]);
  const lightDots = dotTriple([
    ['rgba(25,75,137,1)', 'rgba(56,115,191,.27)'],
    ['rgba(14,82,167,1)', 'rgba(67,137,215,.38)'],
    ['rgba(16,50,109,1)', 'rgba(42,94,172,.24)'],
  ]);
  if (darkDots === null || lightDots === null) return null;

  const bands: readonly FiberBand[] = [
    { base: 0.34, span: 0.29, phase: 0.15, tilt: -0.08, gain: 0.64 },
    { base: 0.5, span: 0.37, phase: 2.35, tilt: -0.14, gain: 1 },
    { base: 0.66, span: 0.25, phase: 4.4, tilt: 0.1, gain: 0.68 },
  ];
  let width = 0;
  let height = 0;
  let frame = 0;
  let timer = 0;
  let visible = true;
  let mouseY = 0;
  let disposed = false;

  const draw = (time: number): void => {
    if (width === 0 || height === 0) return;
    ink.clearRect(0, 0, width, height);
    const light = document.documentElement.dataset['theme'] !== 'dark';
    const dots = light ? lightDots : darkDots;
    ink.globalCompositeOperation = light ? 'source-over' : 'screen';
    const drift = reduced?.matches === true ? 0 : time * 0.00028;
    const narrow = width < 700;
    const threadCount = narrow ? 20 : 30;
    const beadCount = narrow ? 60 : 82;
    for (let layer = 0; layer < bands.length; layer += 1) {
      const band = bands[layer];
      if (band === undefined) continue;
      for (let fiber = 0; fiber < threadCount; fiber += 1) {
        const v = (fiber / (threadCount - 1)) * 2 - 1;
        for (let bead = 0; bead < beadCount; bead += 1) {
          const u = bead / (beadCount - 1);
          const edge = Math.sin(Math.PI * u);
          const twist = 7.4 * u + band.phase + drift * 0.65 + 0.22 * Math.sin(u * 7 - drift);
          const fold = Math.pow(1 - Math.abs(Math.cos(twist)), 8);
          const center =
            band.base +
            band.tilt * (u - 0.5) +
            0.085 * Math.sin(u * 7.5 + band.phase + drift) +
            0.047 * Math.sin(u * 13 - band.phase - drift * 0.7);
          const spread = band.span * (0.52 + 0.48 * edge);
          const x = width * (-0.13 + 1.26 * u) + v * Math.sin(twist) * width * 0.115 * edge;
          const y = height * (center + v * Math.cos(twist) * spread * 0.5) + mouseY * 0.015 * (u - 0.5);
          if (x < -12 || x > width + 12 || y < -12 || y > height + 12) continue;
          const fade = Math.pow(edge, 0.55) * (0.55 + 0.45 * Math.cos(v * 1.2));
          const near = 0.52 + 0.48 * (1 - v * 0.5);
          const sparkle = (fiber * 17 + bead * 31 + layer * 13) % 127 === 0 ? 1.65 : 1;
          const size = (0.8 + near * 0.78 + fold * 0.45) * sparkle * (narrow ? 0.82 : 1);
          const alpha = Math.min(0.95, band.gain * fade * (0.17 + fold * 0.46 + near * 0.11) * (light ? 3 : 1.4));
          ink.globalAlpha = alpha;
          const dot = fold > 0.58 ? dots[1] : layer === 0 && v < -0.25 ? dots[2] : dots[0];
          ink.drawImage(dot, x - size * 4, y - size * 4, size * 8, size * 8);
        }
      }
    }
    ink.globalAlpha = 1;
    const bloom = ink.createRadialGradient(width * 0.72, height * 0.4, 0, width * 0.72, height * 0.4, width * 0.45);
    bloom.addColorStop(0, light ? 'rgba(70,144,230,.06)' : 'rgba(42,118,230,.12)');
    bloom.addColorStop(1, 'rgba(42,118,230,0)');
    ink.fillStyle = bloom;
    ink.fillRect(0, 0, width, height);
    ink.globalCompositeOperation = 'source-over';
  };
  const schedule = (): void => {
    timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(tick);
    }, 110);
  };
  const tick = (time: number): void => {
    if (disposed || reduced?.matches === true || !visible || document.hidden || !canvas.isConnected) return;
    draw(time);
    schedule();
  };
  const start = (): void => {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
    draw(window.performance.now());
    if (reduced?.matches !== true && visible && !document.hidden) schedule();
  };
  const resize = (): void => {
    const bounds = hero.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    const scale = pixelScale();
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ink.setTransform(scale, 0, 0, scale, 0, 0);
    start();
  };
  const onPointer = (event: PointerEvent): void => {
    const bounds = hero.getBoundingClientRect();
    mouseY = event.clientY - bounds.top - height / 2;
  };
  const pause = (): void => {
    window.clearTimeout(timer);
    window.cancelAnimationFrame(frame);
  };
  const onVisibility = (): void => {
    if (document.hidden) pause();
    else start();
  };
  const observer =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            visible = entries[0]?.isIntersecting ?? true;
            if (visible) start();
            else pause();
          },
          { threshold: 0 },
        )
      : null;
  const resizer = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  const themeObserver = new MutationObserver(start);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  observer?.observe(hero);
  resizer?.observe(hero);
  if (resizer === null) window.addEventListener('resize', resize);
  hero.addEventListener('pointermove', onPointer, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reduced?.addEventListener('change', start);
  resize();
  return {
    stop() {
      disposed = true;
      pause();
      observer?.disconnect();
      resizer?.disconnect();
      themeObserver.disconnect();
      if (resizer === null) window.removeEventListener('resize', resize);
      hero.removeEventListener('pointermove', onPointer);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced?.removeEventListener('change', start);
    },
  };
}

/** Start the hero fiber field; null when the canvas cannot run here. */
export function initGhostFibers(): GhostFiberHandle | null {
  try {
    const canvas = document.querySelector('.cp-ghost-fibers');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const hero = canvas.closest('.cp-identity-hero');
    if (!(hero instanceof HTMLElement)) return null;
    const reduced = motionQuery();
    try {
      const gpu = initWebGLFibers(canvas, hero, reduced);
      if (gpu !== null) return gpu;
    } catch {
      // Fall through to the 2D painter below.
    }
    try {
      return initCanvasFibers(canvas, hero, reduced);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

let activeGhost: GhostFiberHandle | null = null;

function stopActiveGhost(): void {
  activeGhost?.stop();
  activeGhost = null;
}

/* Landing (#/, #/landing; mockup 2001-2005). Static English copy; only the
 * pricing cards carry live API data. */

function landingHero(): HTMLElement {
  const release = h('a', { class: 'modern-release', href: '#/integrations', 'data-hero': '', style: '--enter:0' }, [
    h('b', {}, ['New']),
    'GitHub connected. Evidence collected.',
  ]);
  release.appendChild(iconSvg('arrow'));
  const orbitGit = h('div', { class: 'hero-orbit orbit-git', 'aria-hidden': 'true' }, []);
  orbitGit.appendChild(iconSvg('github'));
  const orbitProof = h('div', { class: 'hero-orbit orbit-proof', 'aria-hidden': 'true' }, []);
  orbitProof.appendChild(iconSvg('evidence'));
  const pair = h('div', { class: 'modern-cta-pair' }, [
    h('a', { href: '#/dashboard' }, ['Open workspace']),
    h('a', { class: 'primary', href: '#/register' }, ['Get started free']),
  ]);
  return h('section', { class: 'modern-hero cp-identity-hero', id: 'top' }, [
    h('canvas', { class: 'cp-ghost-fibers', 'aria-hidden': 'true' }, []),
    h('div', { class: 'cp-ghost-shade', 'aria-hidden': 'true' }, []),
    release,
    orbitGit,
    orbitProof,
    h('h1', {}, [
      h('span', { 'data-hero': '', style: '--enter:1' }, ['Every change.']),
      h('span', { 'data-hero': '', style: '--enter:2' }, ['One ', h('mark', {}, ['proof.'])]),
    ]),
    h('p', { class: 'modern-hero-sub', 'data-hero': '', style: '--enter:3' }, [
      h('span', {}, ['Every impact mapped.']),
      h('span', {}, ['Every fix checked.']),
      h('span', {}, [h('strong', {}, ['One place to be sure.'])]),
    ]),
    h('div', { 'data-hero': '', style: '--enter:4' }, [
      pair,
      h('p', { class: 'modern-hero-caption' }, ['Start from one project · GitHub connected · Budget in control']),
    ]),
  ]);
}

function techGroup(hidden: boolean): HTMLElement {
  const group = h('div', { class: 'cp-tech-group', ...(hidden ? { 'aria-hidden': 'true' } : {}) }, []);
  for (const item of TECH_LOGOS) {
    const mark = h('span', { class: `cp-tech-mark cp-tech-${item.kind}`, 'aria-hidden': 'true' }, []);
    // Decorative brand artwork (pinned data URI, <img> context only):
    // empty alt plus the aria-hidden parent keep it out of the
    // accessible name, which is the visible technology name.
    mark.appendChild(h('img', { src: item.logo, alt: '', width: '31', height: '31' }));
    group.appendChild(h('span', { class: 'cp-tech-logo' }, [mark, item.name]));
  }
  return group;
}

function techStrip(): HTMLElement {
  return h('section', { class: 'cp-tech-strip', 'aria-label': 'Technology scope preview' }, [
    h('p', {}, ['Technology scope']),
    h('div', { class: 'cp-tech-window' }, [h('div', { class: 'cp-tech-track' }, [techGroup(false), techGroup(true)])]),
  ]);
}

interface ProofTab {
  readonly id: string;
  readonly num: string;
  readonly label: string;
}

const PROOF_TABS: readonly ProofTab[] = [
  { id: 'impact', num: '01', label: 'Map impact' },
  { id: 'candidate', num: '02', label: 'Review candidate' },
  { id: 'evidence', num: '03', label: 'Inspect evidence' },
];

function proofStory(): HTMLElement {
  const tabList = h('div', { class: 'proof-story-tabs', role: 'tablist', 'aria-label': 'Explore the proof workflow' }, []);
  PROOF_TABS.forEach((tab, index) => {
    tabList.appendChild(
      h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: `proof-tab-${tab.id}`,
          'aria-controls': `proof-panel-${tab.id}`,
          'aria-selected': index === 0 ? 'true' : 'false',
          tabindex: index === 0 ? '0' : '-1',
          'data-proof-tab': tab.id,
        },
        [h('span', {}, [tab.num]), ` ${tab.label}`],
      ),
    );
  });
  const flowNode = (kind: string, name: string, detail: string): HTMLElement =>
    h('div', { class: 'proof-flow-node' }, [h('span', {}, [kind]), h('strong', {}, [name]), h('small', {}, [detail])]);
  const panels = h('div', { class: 'proof-story-stage' }, [
    h('div', { class: 'proof-stage-top' }, [
      h('span', { class: 'proof-stage-dot' }, []),
      h('span', { class: 'proof-stage-dot' }, []),
      h('span', { class: 'proof-stage-dot' }, []),
      h('strong', {}, ['ChangeProof / workflow preview']),
      h('span', { class: 'proof-stage-sample' }, ['SAMPLE']),
    ]),
    h(
      'div',
      {
        id: 'proof-panel-impact',
        class: 'proof-panel',
        role: 'tabpanel',
        'aria-labelledby': 'proof-tab-impact',
        'data-proof-panel': 'impact',
      },
      [
        h('div', { class: 'proof-panel-heading' }, [h('span', {}, ['IMPACT GRAPH']), h('b', {}, ['Discovery'])]),
        h('div', { class: 'proof-flow' }, [
          flowNode('Source', 'orders-service', 'API contract changed'),
          h('div', { class: 'proof-flow-link', 'aria-hidden': 'true' }, [h('span', {}, [])]),
          flowNode('Consumer', 'storefront', 'Amount display affected'),
        ]),
        h('p', { class: 'proof-panel-note' }, ['An unresolved edge stays visible until there is evidence for it.']),
      ],
    ),
    h(
      'div',
      {
        id: 'proof-panel-candidate',
        class: 'proof-panel',
        role: 'tabpanel',
        'aria-labelledby': 'proof-tab-candidate',
        'data-proof-panel': 'candidate',
        hidden: 'hidden',
      },
      [
        h('div', { class: 'proof-panel-heading' }, [h('span', {}, ['CANDIDATE BUNDLE']), h('b', {}, ['Review'])]),
        h('div', { class: 'proof-diff' }, [
          h('div', {}, [h('span', {}, ['−']), ' amount: order.amount']),
          h('div', {}, [h('span', {}, ['+']), ' amount: order.amount_minor']),
        ]),
        h('p', { class: 'proof-panel-note' }, [
          'A proposed patch is a candidate. It needs fresh checks before any outcome is claimed.',
        ]),
      ],
    ),
    h(
      'div',
      {
        id: 'proof-panel-evidence',
        class: 'proof-panel',
        role: 'tabpanel',
        'aria-labelledby': 'proof-tab-evidence',
        'data-proof-panel': 'evidence',
        hidden: 'hidden',
      },
      [
        h('div', { class: 'proof-panel-heading' }, [h('span', {}, ['INDEPENDENT VERIFICATION']), h('b', {}, ['Evidence'])]),
        h('div', { class: 'proof-checks' }, [
          h('div', {}, [h('span', {}, ['✓']), ' Candidate identity recorded']),
          h('div', {}, [h('span', {}, ['✓']), ' Target checks available']),
          h('div', { class: 'proof-check-pending' }, [h('span', {}, ['·']), ' Cross-system proof incomplete']),
        ]),
        h('p', { class: 'proof-panel-note' }, [
          'Illustrative state: the bundle remains incomplete until every required check passes.',
        ]),
      ],
    ),
  ]);
  return h('section', { class: 'proof-story', 'aria-labelledby': 'proof-story-title' }, [
    h('div', { class: 'modern-container proof-story-layout' }, [
      h('div', { class: 'proof-story-copy' }, [
        h('span', { class: 'section-eyebrow' }, ['Interactive preview · illustrative data']),
        h('h2', { id: 'proof-story-title' }, ['Follow the change.', h('br', {}, []), h('em', {}, ['See the proof.'])]),
        h('p', {}, ['Explore how an intended change moves from impact discovery to an independently checked result.']),
        tabList,
        h('small', {}, ['Illustrative workflow preview. This is not a live verification result.']),
      ]),
      panels,
    ]),
  ]);
}

/** Mockup selectProofTab (2287-2306), scoped to this section (no document listeners). */
function initProofStory(section: HTMLElement): void {
  const select = (tab: HTMLElement, focus: boolean): void => {
    const group = tab.closest('.proof-story-tabs');
    if (group === null) return;
    const key = tab.dataset['proofTab'];
    for (const item of group.querySelectorAll('[data-proof-tab]')) {
      if (!(item instanceof HTMLElement)) continue;
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      if (focus && selected) item.focus();
    }
    for (const panel of section.querySelectorAll('[data-proof-panel]')) {
      if (!(panel instanceof HTMLElement)) continue;
      if (panel.dataset['proofPanel'] === key) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', 'hidden');
    }
  };
  section.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest('[data-proof-tab]');
    if (tab instanceof HTMLElement) select(tab, false);
  });
  section.addEventListener('keydown', (event) => {
    const tab = (event.target as HTMLElement).closest('[data-proof-tab]');
    if (!(tab instanceof HTMLElement)) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const group = tab.closest('.proof-story-tabs');
    if (group === null) return;
    const tabs = [...group.querySelectorAll('[data-proof-tab]')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    const index = tabs.indexOf(tab);
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const target = tabs[next];
    if (target === undefined) return;
    event.preventDefault();
    select(target, true);
  });
}

interface CapabilityGroup {
  readonly name: string;
  readonly code: string;
  readonly items: readonly (readonly [string, string])[];
}

/* Mockup cpCapabilityGroups (1931-1956), already English. */
const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  {
    name: 'Discover',
    code: '01',
    items: [
      ['Repository inventory', 'Understand connected repositories, supported stacks, and coverage limits.'],
      ['Impact graph', 'Trace API, data, event, cache, and dependency edges with uncertainty visible.'],
      ['Incident signals', 'Correlate telemetry and observations without treating correlation as proof.'],
      ['Legacy behavior', 'Characterize old workflows and flag unknown business rules for an owner.'],
    ],
  },
  {
    name: 'Repair',
    code: '02',
    items: [
      ['Causal diagnosis', 'Test hypotheses and plan the next bounded investigation step.'],
      ['Coordinated patches', 'Propose one candidate bundle across affected repositories.'],
      ['Migrations & upgrades', 'Plan schema, dependency, and framework changes together.'],
      ['Events & caches', 'Check producers, consumers, keys, and mixed-version behavior.'],
    ],
  },
  {
    name: 'Verify',
    code: '03',
    items: [
      ['Real execution', 'Run native builds and services inside isolated job environments.'],
      ['Reproduction campaigns', 'Record every planned trial, fault, schedule, and cleanup receipt.'],
      ['Four proof dimensions', 'Assess correctness, performance, resilience, and data integrity separately.'],
      ['Evidence-based review', 'Keep immutable evidence linked to the candidate and authorized PR.'],
    ],
  },
  {
    name: 'Operate',
    code: '04',
    items: [
      ['Browser & GitHub journey', 'Manage authorized projects and runs from the hosted interface.'],
      ['Team access', 'Apply current organization and repository grants to every view.'],
      ['Budget & privacy', 'Set spending caps and keep customer evidence private by default.'],
      ['Distribution options', 'Support self-hosting and qualified identity or repository providers.'],
    ],
  },
];

function scopeLoopGroup(): HTMLElement {
  const group = h('div', { class: 'cp-scope-loop-group' }, []);
  for (let i = 0; i < 4; i += 1) group.appendChild(h('span', {}, ['DISCOVER · REPAIR · VERIFY · OPERATE ·']));
  return group;
}

function capabilityFolders(): HTMLElement {
  const stack = h('div', { class: 'cp-workflow-stack', id: 'cp-workflow-stack' }, [
    h('span', { class: 'cp-workflow-back', 'aria-hidden': 'true' }, []),
  ]);
  CAPABILITY_GROUPS.forEach((group, index) => {
    stack.appendChild(
      h(
        'button',
        {
          type: 'button',
          class: `cp-workflow-sheet cp-workflow-sheet-${String(index + 1)}`,
          'data-cp-area': String(index),
          'aria-controls': `cp-workflow-area-${String(index)}`,
          'aria-expanded': 'false',
          'aria-label': `Open ${group.name}`,
        },
        [h('small', {}, [group.code]), h('strong', {}, [group.name])],
      ),
    );
  });
  const logo = h('span', { class: 'cp-workflow-logo' }, [
    h('strong', {}, ['ChangeProof']),
    h('small', {}, ['AI']),
  ]);
  logo.insertBefore(changeproofMarkSvg(), logo.firstChild);
  stack.appendChild(
    h(
      'button',
      {
        type: 'button',
        class: 'cp-workflow-front',
        'data-cp-folder-toggle': '',
        'aria-controls': 'cp-workflow-stack',
        'aria-expanded': 'false',
        'aria-label': 'Open ChangeProof folder',
      },
      [logo],
    ),
  );
  stack.appendChild(h('span', { class: 'cp-workflow-flap', 'aria-hidden': 'true' }, []));

  const areas = h('div', { class: 'cp-workflow-areas', id: 'cp-workflow-areas', hidden: 'hidden' }, []);
  CAPABILITY_GROUPS.forEach((group, index) => {
    const list = h('ul', {}, []);
    for (const [title, description] of group.items) {
      list.appendChild(h('li', {}, [h('strong', {}, [title]), h('p', {}, [description])]));
    }
    areas.appendChild(
      h(
        'article',
        {
          class: 'cp-workflow-area',
          id: `cp-workflow-area-${String(index)}`,
          'aria-labelledby': `cp-workflow-title-${String(index)}`,
          'data-file-label': group.name,
          hidden: 'hidden',
        },
        [
          h('span', {}, [`${group.code} / 04`]),
          h('h3', { id: `cp-workflow-title-${String(index)}`, tabindex: '-1' }, [group.name]),
          list,
        ],
      ),
    );
  });

  return h('section', { class: 'cp-capabilities', id: 'capability-folders', 'aria-labelledby': 'cp-capabilities-title' }, [
    h('div', { class: 'modern-container' }, [
      h('div', { class: 'cp-capabilities-heading' }, [
        h('span', { class: 'section-eyebrow' }, ['Product scope · design preview']),
        h('h2', { id: 'cp-capabilities-title' }, ['A workflow worth', h('br', {}, []), h('em', {}, ['opening up.'])]),
        h('p', {}, [
          'Explore the capabilities described in the ChangeProof specification. Availability and support levels require separate qualification.',
        ]),
      ]),
      h('div', { class: 'cp-motion-row' }, [
        h('div', { class: 'cp-capability-flap', role: 'status', 'aria-label': 'Explore the scope' }, ['EXPLORE THE SCOPE']),
        h('div', { class: 'cp-scope-loop', 'aria-hidden': 'true' }, [
          h('div', { class: 'cp-scope-loop-track' }, [scopeLoopGroup(), scopeLoopGroup()]),
        ]),
      ]),
      h('div', { class: 'cp-workflow-folder', role: 'group', 'aria-label': 'ChangeProof folder with four areas' }, [
        h('div', { class: 'cp-workflow-cover' }, [stack]),
        areas,
      ]),
      h('p', { class: 'cp-capabilities-foot' }, [
        'Specification targets shown for design exploration. This preview does not certify product availability.',
      ]),
    ]),
  ]);
}

/** Mockup setCapabilityArea + folder handlers (2307-2348), scoped to the folder. */
function initCapabilityFolder(section: HTMLElement): void {
  const folder = section.querySelector('.cp-workflow-folder');
  const flap = section.querySelector('.cp-capability-flap');
  if (!(folder instanceof HTMLElement)) return;

  const setArea = (index: number, open: boolean): void => {
    const areas = [...folder.querySelectorAll('.cp-workflow-area')].filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    );
    const selected = open && index >= 0 && index < areas.length;
    folder.classList.toggle('is-open', open);
    if (selected) folder.dataset['activeArea'] = String(index);
    else delete folder.dataset['activeArea'];
    const host = folder.querySelector('.cp-workflow-areas');
    if (host instanceof HTMLElement) {
      if (selected) host.removeAttribute('hidden');
      else host.setAttribute('hidden', 'hidden');
    }
    areas.forEach((area, i) => {
      if (selected && i === index) area.removeAttribute('hidden');
      else area.setAttribute('hidden', 'hidden');
    });
    for (const button of folder.querySelectorAll('[data-cp-area]')) {
      if (!(button instanceof HTMLElement)) continue;
      const active = selected && Number(button.dataset['cpArea']) === index;
      button.setAttribute('aria-expanded', String(active));
      button.classList.toggle('is-active', active);
      if (button.classList.contains('cp-workflow-sheet')) {
        const group = CAPABILITY_GROUPS[Number(button.dataset['cpArea'])];
        if (group !== undefined) button.setAttribute('aria-label', `${active ? 'Close' : 'Open'} ${group.name}`);
      }
    }
    const front = folder.querySelector('[data-cp-folder-toggle]');
    if (front instanceof HTMLElement) {
      front.setAttribute('aria-expanded', String(open));
      front.setAttribute('aria-label', open ? 'Close ChangeProof folder' : 'Open ChangeProof folder');
    }
    if (!(flap instanceof HTMLElement)) return;
    const group = index >= 0 ? CAPABILITY_GROUPS[index] : undefined;
    const phrase = selected && group !== undefined ? `${group.name.toUpperCase()} / EXPLORE` : open ? 'FOUR FILES / CHOOSE ONE' : 'EXPLORE THE SCOPE';
    flap.setAttribute('aria-label', phrase);
    const letters: HTMLElement[] = [];
    for (let i = 0; i < phrase.length; i += 1) {
      const letter = phrase[i] ?? '';
      letters.push(h('span', { 'aria-hidden': 'true', style: `--letter-index:${String(i)}` }, [letter === ' ' ? ' ' : letter]));
    }
    flap.replaceChildren(...letters);
  };

  folder.addEventListener('click', (event) => {
    const control = (event.target as HTMLElement).closest('[data-cp-area],[data-cp-folder-toggle]');
    if (!(control instanceof HTMLElement)) return;
    const isOpen = folder.classList.contains('is-open');
    const current = folder.dataset['activeArea'] === undefined || folder.dataset['activeArea'] === '' ? -1 : Number(folder.dataset['activeArea']);
    const isFolderButton = control.hasAttribute('data-cp-folder-toggle');
    const index = isFolderButton ? -1 : Number(control.dataset['cpArea']);
    const next = isFolderButton || index === current ? -1 : index;
    setArea(next, isFolderButton ? !isOpen : true);
    if (next >= 0 && control.classList.contains('cp-workflow-sheet')) {
      folder.querySelector<HTMLElement>(`#cp-workflow-title-${String(next)}`)?.focus();
    }
  });
  folder.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !folder.classList.contains('is-open')) return;
    setArea(-1, false);
    folder.querySelector<HTMLElement>('[data-cp-folder-toggle]')?.focus();
  });
}

/** Mockup cp-in-view observers (2253-2264); without observer support the class applies at once. */
function revealOnView(root: HTMLElement, selector: string): void {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) return;
  if (!('IntersectionObserver' in window)) {
    node.classList.add('cp-in-view');
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      node.classList.toggle('cp-in-view', entries[0]?.isIntersecting ?? false);
    },
    { threshold: 0 },
  );
  observer.observe(node);
}

function priceCard(name: string, notes: string, meta: string, first: boolean): HTMLElement {
  const card = h('article', { class: 'price-card', ...(first ? {} : { style: 'margin-top:16px' }) }, [
    staticBadge('Plan', 'green'),
    h('h3', {}, [name]),
    h('p', {}, [notes]),
    h('p', { class: 'muted' }, [meta]),
  ]);
  const action = h('a', { class: 'modern-button primary', href: '#/register' }, ['Start free']);
  action.appendChild(iconSvg('arrow'));
  card.appendChild(action);
  return card;
}

function pricingSection(): { section: HTMLElement; cards: HTMLElement; note: HTMLElement } {
  const cards = h('div', {}, []);
  const note = h('p', { class: 'muted' }, []);
  const section = h('section', { class: 'pricing-section', id: 'pricing' }, [
    h('div', { class: 'modern-container price-layout' }, [
      h('div', {}, [
        h('span', { class: 'section-eyebrow' }, ['Pricing']),
        h('h2', {}, ['Start small.', h('br', {}, []), 'Stay in control.']),
        h('p', {}, ['Review estimates, reserved credits, and actual usage before starting verification.']),
      ]),
      h('div', {}, [cards, note]),
    ]),
  ]);
  return { section, cards, note };
}

/* The pricing snapshot comes from the real /api/site/pricing endpoint (the
 * only pricing endpoint the server exposes); tier names and notes render as
 * text. No tier is marked featured: .featured/.price-ribbon do not exist in
 * the mockup and the snapshot carries no featured flag. */
async function fillPricing(cards: HTMLElement, note: HTMLElement): Promise<void> {
  note.textContent = 'Loading plans…';
  try {
    const pricing = await apiGet<PricingSnapshot>('/api/site/pricing');
    note.textContent = '';
    cards.replaceChildren(
      ...pricing.tiers.map((tier, index) =>
        priceCard(tier.name, tier.notes, `Pricing version ${pricing.pricingVersion} · ${pricing.currency}`, index === 0),
      ),
    );
  } catch {
    note.textContent = 'Pricing is unavailable right now. The plans above will return with the service.';
  }
}

function finalCta(): HTMLElement {
  const pair = h('div', { class: 'modern-cta-pair' }, [
    h('a', { class: 'primary', href: '#/register' }, ['Start free']),
    h('button', { type: 'button', 'data-evidence': 'later' }, ['Not now']),
  ]);
  (pair.firstChild as HTMLElement).appendChild(iconSvg('arrow'));
  const caption = h('p', {}, ['Start with the free capped tier · usage limits follow the workspace']);
  const later = pair.lastChild;
  if (later instanceof HTMLButtonElement) {
    later.addEventListener('click', () => {
      later.textContent = 'Not now';
      caption.textContent = "When you're ready, proof can start from one project.";
    });
    later.addEventListener('pointerover', () => {
      try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
      } catch {
        return;
      }
      later.textContent = 'Not now';
    });
  }
  const pricingLink = h('a', { class: 'section-demo-link', href: '#/pricing' }, ['See pricing']);
  pricingLink.appendChild(iconSvg('arrow'));
  return h('section', { class: 'final-cta' }, [
    h('span', { class: 'section-eyebrow' }, ['Next step']),
    h('h2', {}, ['Ready to verify', h('br', {}, []), 'your change?']),
    pair,
    caption,
    pricingLink,
  ]);
}

async function renderLanding(outlet: HTMLElement): Promise<void> {
  stopActiveGhost();
  const story = proofStory();
  const folders = capabilityFolders();
  const pricing = pricingSection();
  outlet.replaceChildren(landingHero(), techStrip(), story, folders, pricing.section, finalCta());
  initProofStory(story);
  initCapabilityFolder(folders);
  revealOnView(outlet, '.cp-capabilities');
  revealOnView(outlet, '.cp-tech-strip');
  await fillPricing(pricing.cards, pricing.note);
  activeGhost = initGhostFibers();
}

/* Fixed public sub-pages (mockup 2350-2433): .public-page shell with
 * breadcrumb, hero, info-grid, note, related links, plus live API blocks.
 * Copy is translated to English (FR3-40). */

interface InfoCard {
  readonly icon: IconName;
  readonly title: string;
  readonly copy: string;
  readonly link?: string;
  readonly linkLabel?: string;
}

function infoCard(card: InfoCard): HTMLElement {
  const article = h('article', { class: 'public-info-card' }, [
    pillIcon(card.icon),
    h('h2', {}, [card.title]),
    h('p', {}, [card.copy]),
  ]);
  if (card.link !== undefined) {
    const anchor = h('a', { href: card.link }, [card.linkLabel ?? 'Learn more']);
    anchor.appendChild(iconSvg('arrow'));
    article.appendChild(anchor);
  }
  return article;
}

function infoGrid(cards: readonly InfoCard[]): HTMLElement {
  const grid = h('div', { class: 'public-info-grid' }, []);
  for (const card of cards) grid.appendChild(infoCard(card));
  return grid;
}

function publicNote(title: string, copy: string): HTMLElement {
  const note = h('aside', { class: 'public-note' }, [h('div', {}, [h('strong', {}, [title]), h('p', {}, [copy])])]);
  note.insertBefore(iconSvg('info'), note.firstChild);
  return note;
}

function publicSteps(items: readonly (readonly [string, string])[]): HTMLElement {
  const list = h('ol', { class: 'public-steps' }, []);
  items.forEach(([title, copy], index) => {
    list.appendChild(
      h('li', {}, [
        h('span', {}, [`0${String(index + 1)}`]),
        h('div', {}, [h('h2', {}, [title]), h('p', {}, [copy])]),
      ]),
    );
  });
  return list;
}

function publicProse(sections: readonly (readonly [string, string])[]): HTMLElement {
  const prose = h('section', { class: 'public-prose' }, []);
  for (const [heading, copy] of sections) prose.append(h('h2', {}, [heading]), h('p', {}, [copy]));
  return prose;
}

const PAGE_TITLES: ReadonlyMap<string, string> = new Map([
  ['/product', 'Product'],
  ['/how-it-works', 'How it works'],
  ['/pricing', 'Pricing'],
  ['/documentation', 'Documentation'],
  ['/guides', 'Documentation'],
  ['/tutorials', 'Tutorials'],
  ['/help', 'Help center'],
  ['/security', 'Security'],
  ['/enterprise', 'Enterprise'],
  ['/self-hosted', 'Self-hosted'],
  ['/templates', 'Templates'],
  ['/integrations', 'GitHub integration'],
  ['/sample-report', 'Sample report'],
  ['/status', 'Status'],
  ['/changelog', 'Changelog'],
  ['/roadmap', 'Roadmap'],
  ['/about', 'About'],
  ['/contact', 'Contact'],
  ['/privacy', 'Privacy'],
  ['/privacy-policy', 'Privacy'],
  ['/terms', 'Terms'],
  ['/impact-overview', 'Analysis'],
  ['/verification', 'Verification'],
  ['/evidence-overview', 'Evidence'],
  ['/collaboration', 'Collaboration'],
]);

function publicRelated(paths: readonly string[]): HTMLElement {
  const row = h('div', {}, []);
  for (const path of paths) {
    const anchor = h('a', { href: `#${path}` }, [h('span', {}, [PAGE_TITLES.get(path) ?? path])]);
    anchor.appendChild(iconSvg('arrow'));
    row.appendChild(anchor);
  }
  return h('section', { class: 'public-related' }, [h('span', { class: 'section-eyebrow' }, ['Keep reading']), row]);
}

/* Mockup publicPageNav (2386) points at Product/Pricing/Docs/Templates/Help.
 * There is no fixed /help route (FAQ lives on #/documentation and the
 * manifest #/p/help), so Contact takes the fifth slot. */
const FIXED_NAV: readonly (readonly [string, string])[] = [
  ['#/product', 'Product'],
  ['#/pricing', 'Pricing'],
  ['#/documentation', 'Docs'],
  ['#/templates', 'Templates'],
  ['#/contact', 'Contact'],
];

function fixedPageNav(current: string): HTMLElement {
  const nav = h('nav', { class: 'public-page-nav', 'aria-label': 'Explore the site' }, []);
  for (const [hash, label] of FIXED_NAV) {
    const anchor = h('a', { href: hash }, [label]);
    if (hash === `#${current}`) anchor.setAttribute('aria-current', 'page');
    nav.appendChild(anchor);
  }
  return nav;
}

interface FixedPageDef {
  readonly path: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly hero: string;
  readonly sub: string;
  readonly related: readonly string[];
}

function pageShell(def: FixedPageDef, body: readonly HTMLElement[]): HTMLElement {
  const content = h('div', { class: 'public-page-content' }, [...body]);
  return h('div', { class: 'public-page' }, [
    h('div', { class: 'modern-container' }, [
      h('div', { class: 'public-breadcrumb' }, [
        h('a', { href: '#/landing' }, ['Home']),
        h('span', {}, ['/']),
        h('span', {}, [def.eyebrow]),
      ]),
      h('header', { class: 'public-page-hero' }, [
        h('span', { class: 'section-eyebrow' }, [def.eyebrow]),
        h('h1', {}, [def.hero]),
        h('p', {}, [def.sub]),
      ]),
      fixedPageNav(def.path),
      content,
      publicRelated(def.related),
    ]),
  ]);
}

function apiMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.failure.message : 'An unexpected error occurred.';
}

function productPreview(): HTMLElement {
  const navItems: readonly (readonly [IconName, string, boolean])[] = [
    ['dashboard', 'Overview', false],
    ['projects', 'Projects', false],
    ['runs', 'Verification', true],
    ['evidence', 'Evidence', false],
  ];
  const steps: readonly (readonly [IconName, string, string, string])[] = [
    ['check', 'Change mapped', '3 repositories in scope', '00:04'],
    ['check', 'Regression reproduced', 'Old baseline → new contract', '00:18'],
    ['check', 'Candidate prepared', 'Focused diff, boundaries intact', '00:46'],
    ['clock', 'Evidence reviewed', '1 target still needs verification', '01:11'],
  ];
  const targets: readonly (readonly [string, string, 'green' | 'amber'])[] = [
    ['storefront', 'fixed', 'green'],
    ['orders-service', 'fixed', 'green'],
    ['inventory-service', 'unverified', 'amber'],
  ];
  const previewBrand = h('div', { class: 'preview-brand' }, ['ChangeProof']);
  previewBrand.prepend(changeproofMarkSvg());
  const nav = h('aside', { class: 'preview-nav', 'aria-hidden': 'true' }, [
    previewBrand,
    h('span', { class: 'preview-nav-label' }, ['WORKSPACE']),
    ...navItems.map(([icon, label, active]) => {
      const item = h('div', { class: active ? 'preview-nav-item is-active' : 'preview-nav-item' }, [label]);
      item.prepend(iconSvg(icon));
      return item;
    }),
    h('span', { class: 'preview-nav-label', style: 'margin-top:30px' }, ['NORTHWIND COMMERCE']),
  ]);
  const timeline = h(
    'div',
    { class: 'mini-timeline' },
    steps.map(([symbol, title, sub, time]) => {
      const slot = h('i', {}, []);
      slot.appendChild(iconSvg(symbol));
      return h('div', { class: 'mini-step' }, [
        slot,
        h('div', {}, [h('strong', {}, [title]), h('small', {}, [sub])]),
        h('time', {}, [time]),
      ]);
    }),
  );
  const evidence = h('div', { class: 'preview-evidence' }, [
    h('h4', {}, ['Results by target']),
    ...targets.map(([name, status, tone]) =>
      h('div', { class: 'preview-evidence-row' }, [h('span', {}, [name]), staticBadge(status, tone)]),
    ),
    h('div', { class: 'preview-evidence-row' }, [h('span', {}, ['Bundle']), staticBadge('incomplete', 'amber')]),
  ]);
  const main = h('div', { class: 'preview-main' }, [
    h('div', { class: 'preview-head' }, [
      h('div', {}, [
        h('span', { class: 'mini-label' }, ['RUN-0142 / VERIFICATION']),
        h('h3', {}, ['Every step has evidence.']),
        h('p', {}, ['Order ID & amount representation change']),
      ]),
      staticBadge('Needs review', 'amber'),
    ]),
    h('div', { class: 'preview-columns' }, [timeline, evidence]),
    h('div', { class: 'preview-bottom' }, [
      h('span', { class: 'mono' }, ['a41f9c2 → e07b13d']),
      h('span', {}, ['The final decision stays in your hands. ', h('strong', {}, ['↗'])]),
    ]),
  ]);
  const frame = h(
    'div',
    {
      class: 'product-frame',
      role: 'img',
      'aria-label': 'Illustrative preview of RUN-0142 verification: two targets fixed, one unverified, bundle incomplete.',
    },
    [
      h('div', { class: 'product-browser', 'aria-hidden': 'true' }, [
        h('i', {}, []),
        h('i', {}, []),
        h('i', {}, []),
        h('span', {}, ['ChangeProof / Order Platform']),
        h('small', {}, ['Sample data']),
      ]),
      h('div', { class: 'preview-app' }, [nav, main]),
    ],
  );
  return h('div', { class: 'public-product-preview' }, [frame]);
}

function sampleReportSummary(): HTMLElement {
  const targets: readonly (readonly [string, string, 'green' | 'amber', string])[] = [
    ['Consumer A', 'fixed', 'green', 'Required checks on this target passed within the sample scope.'],
    ['Producer', 'fixed', 'green', 'Candidate is bound to the inspected source revision.'],
    ['Consumer B', 'unverified', 'amber', 'Resilience evidence is insufficient for a positive claim.'],
  ];
  return h('article', { class: 'public-report' }, [
    h('header', {}, [
      h('div', {}, [
        h('span', { class: 'section-eyebrow' }, ['Sample contract verification']),
        h('h2', {}, ['Order representation change.']),
        h('p', {}, ['Producer and two consumers in one review scope.']),
      ]),
      staticBadge('bundle incomplete', 'amber'),
    ]),
    h(
      'div',
      { class: 'public-report-targets' },
      targets.map(([title, status, tone, copy]) =>
        h('section', {}, [h('h3', {}, [title]), staticBadge(status, tone), h('p', {}, [copy])]),
      ),
    ),
    h('div', { class: 'public-report-conclusion' }, [
      h('h3', {}, ['What does this mean?']),
      h('p', {}, ['Two fixed results do not make the whole bundle verified. Required proof for one target is still incomplete.']),
      h('h3', {}, ['Next step']),
      h('p', {}, [
        'Complete the inconclusive checks, then review the candidate again. This sample makes no claim of a PR or real execution.',
      ]),
    ]),
  ]);
}

/* --- Live blocks for the fixed pages (textContent-only dynamic text). --- */

async function pricingTiersBlock(host: HTMLElement): Promise<void> {
  try {
    const pricing = await apiGet<PricingSnapshot>('/api/site/pricing');
    const grid = h('div', { class: 'public-info-grid' }, []);
    for (const tier of pricing.tiers) {
      const start = h('a', { class: 'modern-button primary', href: '#/register' }, ['Start free']);
      start.appendChild(iconSvg('arrow'));
      grid.appendChild(
        h('article', { class: 'public-price-feature public-info-card' }, [
          staticBadge('Starter plan', 'green'),
          h('h2', {}, [tier.name]),
          h('p', {}, [tier.notes]),
          h('ul', {}, [
            h('li', {}, ['Cost estimate before the run.']),
            h('li', {}, ['Reservation matching the chosen budget.']),
            h('li', {}, ['Actual usage and remaining reservation recorded.']),
          ]),
          start,
        ]),
      );
    }
    const details = h('article', { class: 'public-price-details' }, [
      h('span', { class: 'section-eyebrow' }, ['How it works']),
      h('h2', {}, ['Your budget stays in your control.']),
      publicSteps([
        ['Review the estimate', 'Check targets and expected usage before submitting a run.'],
        ['Set limits', 'Pick credit, time, and scope caps that fit the task.'],
        ['Compare usage', 'Contrast reservations with actual usage after the run ends.'],
      ]),
    ]);
    host.appendChild(h('div', { class: 'public-pricing-grid' }, [grid, details]));
    host.appendChild(
      h('p', { class: 'muted' }, [`Pricing version ${pricing.pricingVersion} · ${pricing.currency}`]),
    );
  } catch (error) {
    host.appendChild(errorState('Pricing unavailable', apiMessage(error)));
  }
}

async function faqSearchBlock(host: HTMLElement): Promise<void> {
  // Mockup help page (2422): live-filtered disclosure list over the API faqs.
  const input = h('input', {
    type: 'search',
    'data-public-search': 'faq',
    placeholder: 'Example: repository access or budget',
    'aria-label': 'Search help questions',
  });
  const list = h('div', { class: 'public-faq-list' }, []);
  const empty = h('p', { class: 'public-no-results', hidden: 'hidden' }, [
    'No matching questions. Try other words or read the documentation.',
  ]);
  host.appendChild(h('label', { class: 'field public-search' }, ['Search questions', input]));
  host.appendChild(list);
  host.appendChild(empty);
  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase();
    let visible = 0;
    for (const item of list.querySelectorAll('.public-faq')) {
      const hit = item.textContent.toLowerCase().includes(query);
      if (item instanceof HTMLElement) {
        if (hit) item.removeAttribute('hidden');
        else item.setAttribute('hidden', 'hidden');
      }
      if (hit) visible += 1;
    }
    if (visible > 0) empty.setAttribute('hidden', 'hidden');
    else empty.removeAttribute('hidden');
  });
  try {
    const faqs = await apiGet<readonly PublicFaq[]>('/api/site/faqs');
    for (const faq of faqs) {
      list.appendChild(
        h('details', { class: 'public-faq' }, [
          h('summary', {}, [faq.question]),
          h('p', {}, [faq.answer]),
        ]),
      );
    }
  } catch (error) {
    list.replaceChildren(errorState('Questions unavailable', apiMessage(error)));
  }
}

const TEMPLATE_ICONS: readonly IconName[] = ['git', 'projects', 'usage', 'search', 'graph', 'book'];

async function templatesGridBlock(host: HTMLElement): Promise<void> {
  try {
    const templates = await apiGet<readonly PublicTemplate[]>('/api/site/templates');
    const grid = h('div', { class: 'public-info-grid' }, []);
    templates.forEach((template, index) => {
      const detail = h('details', { class: 'public-template-detail' }, [
        h('summary', {}, ['See plan contents']),
      ]);
      for (const item of template.fields) {
        detail.append(h('p', {}, [h('strong', {}, [item.label]), ` — ${item.help}`]));
      }
      detail.appendChild(h('p', {}, ['Review scope and budget before running verification.']));
      const use = h('a', { href: '#/register' }, ['Create an account to use templates']);
      use.appendChild(iconSvg('arrow'));
      detail.appendChild(use);
      grid.appendChild(
        h('article', { class: 'public-info-card' }, [
          pillIcon(TEMPLATE_ICONS[index % TEMPLATE_ICONS.length] ?? 'projects'),
          h('h2', {}, [template.title]),
          h('p', {}, [template.description]),
          detail,
        ]),
      );
    });
    host.appendChild(grid);
  } catch (error) {
    host.appendChild(errorState('Templates unavailable', apiMessage(error)));
  }
}

async function samplesGridBlock(host: HTMLElement): Promise<void> {
  try {
    const samples = await apiGet<readonly SampleReport[]>('/api/site/samples');
    const grid = h('div', { class: 'public-info-grid' }, []);
    for (const sample of samples) {
      const open = h('a', { href: `#/p/samples/${sample.id}` }, ['Open sample']);
      open.appendChild(iconSvg('arrow'));
      grid.appendChild(
        h('article', { class: 'public-info-card' }, [
          pillIcon('evidence'),
          h('h2', {}, [sample.title]),
          h('p', {}, [sample.summary]),
          h('p', { class: 'muted' }, [sample.provenance.label]),
          open,
        ]),
      );
    }
    host.appendChild(grid);
  } catch (error) {
    host.appendChild(errorState('Samples unavailable', apiMessage(error)));
  }
}

async function healthBlock(host: HTMLElement): Promise<void> {
  try {
    const health = await apiGet<HealthData>('/api/health');
    host.appendChild(
      infoGrid([
        { icon: 'check', title: 'API health', copy: `The service reports ${health.status.toUpperCase()}.` },
        { icon: 'file', title: 'Content manifest', copy: `Published contracts at version ${health.contentVersion}.` },
        { icon: 'shield', title: 'Verdict authority', copy: 'Deterministic policy over verifier evidence only.' },
        { icon: 'lock', title: 'Tenant boundary', copy: 'Every view checks current grants before it renders.' },
      ]),
    );
  } catch (error) {
    host.appendChild(errorState('Status unavailable', apiMessage(error)));
  }
}

async function changelogBlock(host: HTMLElement): Promise<void> {
  try {
    const log = await apiGet<{ design: readonly ChangelogEntry[]; releases: readonly ChangelogEntry[] }>(
      '/api/site/changelog',
    );
    const group = (label: string, entries: readonly ChangelogEntry[], tone: '' | 'green'): void => {
      host.appendChild(h('span', { class: 'section-eyebrow' }, [label]));
      if (entries.length === 0) {
        host.appendChild(h('p', { class: 'muted' }, ['Nothing published here yet.']));
        return;
      }
      for (const entry of entries) {
        host.appendChild(
          h('div', { class: 'public-release' }, [
            h('div', {}, [
              staticBadge(entry.version ?? (tone === '' ? 'Design' : 'Release'), tone),
              h('p', {}, [entry.date]),
            ]),
            h('article', {}, [h('h2', {}, [entry.title]), h('p', {}, [entry.body])]),
          ]),
        );
      }
    };
    // Design notes and shipped releases stay visibly separate (FR3-37).
    group('Releases', log.releases, 'green');
    group('Design notes', log.design, '');
  } catch (error) {
    host.appendChild(errorState('Changelog unavailable', apiMessage(error)));
  }
}

async function roadmapBlock(host: HTMLElement): Promise<void> {
  try {
    const items = await apiGet<readonly RoadmapItem[]>('/api/site/roadmap');
    const grid = h('div', { class: 'public-info-grid' }, []);
    for (const item of items) {
      const tone = item.status === 'supported' ? 'green' : item.status === 'in-qualification' ? 'amber' : 'blue';
      const card = h('article', { class: 'public-info-card' }, [
        staticBadge(item.status, tone),
        h('h2', {}, [item.title]),
      ]);
      if (item.evidenceRef !== undefined) card.appendChild(h('p', { class: 'muted' }, [`Evidence: ${item.evidenceRef}`]));
      grid.appendChild(card);
    }
    host.appendChild(grid);
  } catch (error) {
    host.appendChild(errorState('Roadmap unavailable', apiMessage(error)));
  }
}

function contactFormBlock(): HTMLElement {
  const categories: readonly (readonly [string, string])[] = [
    ['question', 'Question'],
    ['bug', 'Bug report'],
    ['incident', 'Incident'],
    ['access', 'Access request'],
  ];
  const category = h('select', { id: 'contact-category', name: 'contact-category' }, []);
  for (const [value, label] of categories) category.appendChild(h('option', { value }, [label]));
  const { wrap: summaryWrap, input: summary } = field({ id: 'contact-summary', label: 'Summary' });
  const context = h('textarea', { id: 'contact-context', name: 'contact-context' }, []);
  const contextWrap = h('label', { class: 'field' }, [
    'What should we know? (no secrets or production credentials)',
    context,
  ]);
  const note = h('div', { 'aria-live': 'polite' }, []);
  const submit = h('button', { class: 'button primary', type: 'submit' }, ['Send message']);
  const form = h('form', { class: 'form-section' }, [
    h('label', { class: 'field' }, ['Category', category]),
    summaryWrap,
    contextWrap,
    submit,
    note,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const summaryText = summary.value.trim();
    const contextText = context.value.trim();
    summary.removeAttribute('aria-invalid');
    form.querySelector('.error-text')?.remove();
    if (summaryText === '' || contextText === '') {
      summary.setAttribute('aria-invalid', 'true');
      note.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, ['Summary and context are both required.']));
      summary.focus();
      return;
    }
    submit.disabled = true;
    void apiPost<SupportTicket>('/api/support/tickets', {
      category: category.value,
      summary: summaryText,
      context: contextText,
    })
      .then((filed) => {
        note.replaceChildren(document.createTextNode(`Ticket ${filed.ticketId} filed as ${filed.status}.`));
        summary.value = '';
        context.value = '';
      })
      .catch((error: unknown) => {
        note.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [apiMessage(error)]));
      })
      .finally(() => {
        submit.disabled = false;
      });
  });
  return h('article', { class: 'public-info-card' }, [
    pillIcon('mail'),
    h('h2', {}, ['Send a message']),
    h('p', {}, ['A support ticket goes to the team queue. Anything you write here is handled as untrusted input.']),
    form,
  ]);
}

/* --- Fixed page bodies (static structure + live blocks). --- */

type PageBody = (host: HTMLElement) => void | Promise<void>;

function staticBody(...nodes: readonly HTMLElement[]): PageBody {
  return (host) => {
    for (const node of nodes) host.appendChild(node);
  };
}

const FIXED_BODIES: Readonly<Record<string, PageBody>> = {
  '/product': staticBody(
    infoGrid([
      { icon: 'graph', title: 'Understand the impact', copy: 'Trace contract changes, component links, and cross-repository scope.', link: '#/impact-overview' },
      { icon: 'shield', title: 'Review the candidate', copy: 'Separate a proposed fix from an independently checked result.', link: '#/verification' },
      { icon: 'evidence', title: 'Inspect the evidence', copy: 'Read per-target results, limits, and the basis for publication.', link: '#/evidence-overview' },
      { icon: 'team', title: 'Bring context to the team', copy: 'Learn roles, project grants, and repository access.', link: '#/collaboration' },
    ]),
    productPreview(),
    publicNote('Meet the product before signing in', 'This preview uses illustrative data. Project and run access starts after sign-in.'),
  ),
  '/how-it-works': staticBody(
    publicSteps([
      ['Create an account and workspace', 'Register, verify your email, then set up an organization for your team.'],
      ['Choose GitHub access', 'Signing in with GitHub proves identity. The App installation decides which repositories are reachable.'],
      ['Shape the project', 'Pick the relevant producers and consumers, then review readiness and baselines.'],
      ['Plan the run', 'Set intent, scope, invariants, checks, and budget limits before starting.'],
      ['Review the candidate and evidence', 'Read the diff, per-target results, unknowns, and proof scope before deciding.'],
      ['Choose the next step', 'Incomplete evidence stays visible. Publishing a candidate needs review; merge and deploy stay with maintainers.'],
    ]),
    publicNote('Green alone is not enough', 'Coverage, source identity, required proof, and the pinned scope still need checking.'),
  ),
  '/tutorials': (host) => {
    const start = h('a', { class: 'modern-button primary', href: '#/register' }, ['Start by creating an account']);
    start.appendChild(iconSvg('arrow'));
    host.append(
      publicSteps([
        ['Create an account and workspace', 'Register, verify your email, then set up an organization for your team.'],
        ['Choose GitHub access', 'Signing in with GitHub proves identity. The App installation decides which repositories are reachable.'],
        ['Shape the project', 'Pick the relevant producers and consumers, then review readiness and baselines.'],
        ['Plan the run', 'Set intent, scope, invariants, checks, and budget limits before starting.'],
        ['Review the candidate and evidence', 'Read the diff, per-target results, unknowns, and proof scope before deciding.'],
        ['Choose the next step', 'Incomplete evidence stays visible. Publishing a candidate needs review; merge and deploy stay with maintainers.'],
      ]),
      start,
    );
  },
  '/pricing': async (host) => {
    await pricingTiersBlock(host);
    host.appendChild(
      publicNote('Prices and quotas', 'Paid plan pricing is not set yet. Quota figures in mockups are illustrative, not an offer or service promise.'),
    );
  },
  '/documentation': async (host) => {
    host.appendChild(
      infoGrid([
        { icon: 'github', title: 'Start with GitHub', copy: 'Learn identity, App installation, and repository selection.', link: '#/integrations', linkLabel: 'Read the guide' },
        { icon: 'book', title: 'First steps', copy: 'Follow account, project, run, and evidence review.', link: '#/tutorials', linkLabel: 'See tutorial' },
        { icon: 'projects', title: 'Pick a template', copy: 'Learn inputs, invariants, and plan limits before verifying.', link: '#/templates', linkLabel: 'Explore templates' },
        { icon: 'evidence', title: 'Read a report', copy: 'Understand per-target results and why a bundle can stay incomplete.', link: '#/sample-report', linkLabel: 'Open a sample' },
        { icon: 'key', title: 'Team and access', copy: 'Learn the difference between membership, project grants, and GitHub permissions.', link: '#/collaboration', linkLabel: 'Read the guide' },
        { icon: 'support', title: 'Common questions', copy: 'Find answers about usage and product boundaries.', link: '#/help', linkLabel: 'Open help' },
      ]),
    );
    await faqSearchBlock(host);
  },
  '/guides': async (host) => {
    host.appendChild(
      infoGrid([
        { icon: 'github', title: 'Start with GitHub', copy: 'Learn identity, App installation, and repository selection.', link: '#/integrations', linkLabel: 'Read the guide' },
        { icon: 'book', title: 'First steps', copy: 'Follow account, project, run, and evidence review.', link: '#/tutorials', linkLabel: 'See tutorial' },
        { icon: 'projects', title: 'Pick a template', copy: 'Learn inputs, invariants, and plan limits before verifying.', link: '#/templates', linkLabel: 'Explore templates' },
        { icon: 'evidence', title: 'Read a report', copy: 'Understand per-target results and why a bundle can stay incomplete.', link: '#/sample-report', linkLabel: 'Open a sample' },
        { icon: 'key', title: 'Team and access', copy: 'Learn the difference between membership, project grants, and GitHub permissions.', link: '#/collaboration', linkLabel: 'Read the guide' },
        { icon: 'support', title: 'Common questions', copy: 'Find answers about usage and product boundaries.', link: '#/help', linkLabel: 'Open help' },
      ]),
    );
    await faqSearchBlock(host);
  },
  '/help': async (host) => {
    await faqSearchBlock(host);
    host.appendChild(
      infoGrid([
        { icon: 'book', title: 'Public guides', copy: 'Follow the workflow explanation without opening a workspace.', link: '#/guides', linkLabel: 'Read documentation' },
        { icon: 'user', title: 'Account help', copy: 'Sign in for help related to your team account or runs.', link: '#/login', linkLabel: 'Sign in' },
      ]),
    );
  },
  '/security': staticBody(
    infoGrid([
      { icon: 'shield', title: 'Isolated execution', copy: 'Customer code runs in a per-job guest boundary, never on the host or web process.' },
      { icon: 'key', title: 'No secrets outward', copy: 'Guests receive no credentials; model and provider access goes through brokers.' },
      { icon: 'lock', title: 'Tenant isolation', copy: 'Every access checks current grants; identifiers alone grant nothing.' },
      { icon: 'eye', title: 'Auditable trail', copy: 'Decisions link to evidence, configuration, and the account that made them.' },
    ]),
    publicNote('Responsible disclosure', 'Found a weakness? Contact us with a minimal reproduction and no customer data.'),
  ),
  '/enterprise': staticBody(
    infoGrid([
      { icon: 'user', title: 'Single sign-on', copy: 'Connect SAML identity providers with organization-scoped roles.' },
      { icon: 'team', title: 'Provisioning', copy: 'Manage SCIM tokens and membership lifecycle from your directory.' },
      { icon: 'key', title: 'Your own keys', copy: 'Register broker key references without handing material to the product.' },
      { icon: 'file', title: 'Audit exports', copy: 'Keep decision trails and evidence manifests for compliance review.' },
    ]),
    publicNote('Talk to sales', 'Enterprise setup starts with a conversation. Contact us with your identity and repository providers.'),
  ),
  '/self-hosted': staticBody(
    publicSteps([
      ['Check prerequisites', 'Provision the database, object storage, and runner hosts the release notes name.'],
      ['Install the release', 'Deploy the versioned bundle; every component ships in one release.'],
      ['Connect providers', 'Configure identity, source hosting, and model brokers through typed settings.'],
      ['Verify the install', 'Run the qualification checks before pointing the system at real repositories.'],
    ]),
    publicNote('Same evidence bar', 'Self-hosted installs enforce the same oracle, isolation, and policy rules as the hosted service.'),
  ),
  '/templates': async (host) => {
    await templatesGridBlock(host);
    host.appendChild(
      publicNote('Plan examples', 'Public templates create no runs and touch no repositories. Applying happens in the workspace after sign-in.'),
    );
  },
  '/integrations': staticBody(
    publicSteps([
      ['Sign in with GitHub', 'Confirm the account identity. This grants no automatic repository access.'],
      ['Choose repositories', 'Review the App installation permissions and pick only the needed scope.'],
      ['Connect the change', 'Use pull request changes as analysis and review context.'],
      ['Review before publishing', 'Candidates and evidence need review. Nothing here grants merge, admin, or deploy rights.'],
    ]),
    publicNote('Start when ready', 'This page explains the integration. To install access and manage repos, create an account or sign in first.'),
  ),
  '/sample-report': async (host) => {
    host.append(
      publicNote('Sample report · illustrative data', 'This sample is static. It reads no workspace data, runs no checks, and publishes no pull request.'),
      sampleReportSummary(),
    );
    await samplesGridBlock(host);
  },
  '/status': async (host) => {
    await healthBlock(host);
    host.appendChild(
      publicNote('What this page says', 'This status reflects the API behind this dashboard only. It says nothing about any repair verdict.'),
    );
  },
  '/changelog': async (host) => {
    host.appendChild(
      publicNote('Preview notes', 'This page records design progress. It is not a production service release announcement.'),
    );
    await changelogBlock(host);
  },
  '/roadmap': async (host) => {
    host.appendChild(
      publicNote('Direction, not a support promise', 'Plans or frameworks named here are not automatically certified. Actual support needs verification on specific versions, adapters, and workloads.'),
    );
    await roadmapBlock(host);
  },
  '/about': staticBody(
    publicProse([
      ['Why ChangeProof exists', 'At some point, software change becomes too risky to guess. ChangeProof organizes every decision around one thing: evidence.'],
      ['What we will not do', 'No verdicts from the model about its own work, no silent fallbacks, no obstacle disguised as success.'],
    ]),
    infoGrid([
      { icon: 'evidence', title: 'Evidence first', copy: 'A business workflow restored with evidence is the unit of value.' },
      { icon: 'shield', title: 'Honest limits', copy: 'Unknowns stay visible; assurance is withheld when proof is missing.' },
    ]),
  ),
  '/contact': staticBody(
    contactFormBlock(),
    publicNote('Response window', 'We read every ticket. Urgent production incidents should use your incident channel, not this form.'),
  ),
  '/privacy': staticBody(
    publicNote('Privacy preview', 'Final service policy, processing locations, subprocessors, and provider terms need to be set before production use. This page explains the design.'),
    infoGrid([
      { icon: 'key', title: 'Chosen access', copy: 'Private repositories need the relevant permission. Workspace membership alone replaces no current repository right.', link: '#/integrations' },
      { icon: 'shield', title: 'Data limits', copy: 'The flow uses selected sources, diffs, intent, and needed diagnostics. Never upload secrets or production credentials.', link: '#/guides' },
      { icon: 'user', title: 'Team control', copy: 'Roles, project grants, and publication choices limit access to the task.', link: '#/collaboration' },
      { icon: 'evidence', title: 'Samples stay separate', copy: 'Public samples come from a static dataset, never from customer workspaces.', link: '#/help' },
    ]),
    publicProse([
      ['Browser storage', 'The dashboard keeps theme, sidebar state, and certain non-secret drafts locally. Never file bytes, passwords, sessions, or tokens.'],
      ['Retention and model providers', 'No zero-retention or no-training claim stands for providers that are not verified. Example retention figures are not final policy.'],
    ]),
  ),
  '/privacy-policy': staticBody(
    publicNote('Privacy preview', 'Final service policy, processing locations, subprocessors, and provider terms need to be set before production use. This page explains the design.'),
    infoGrid([
      { icon: 'key', title: 'Chosen access', copy: 'Private repositories need the relevant permission. Workspace membership alone replaces no current repository right.', link: '#/integrations' },
      { icon: 'shield', title: 'Data limits', copy: 'The flow uses selected sources, diffs, intent, and needed diagnostics. Never upload secrets or production credentials.', link: '#/guides' },
      { icon: 'user', title: 'Team control', copy: 'Roles, project grants, and publication choices limit access to the task.', link: '#/collaboration' },
      { icon: 'evidence', title: 'Samples stay separate', copy: 'Public samples come from a static dataset, never from customer workspaces.', link: '#/help' },
    ]),
    publicProse([
      ['Browser storage', 'The dashboard keeps theme, sidebar state, and certain non-secret drafts locally. Never file bytes, passwords, sessions, or tokens.'],
      ['Retention and model providers', 'No zero-retention or no-training claim stands for providers that are not verified. Example retention figures are not final policy.'],
    ]),
  ),
  '/impact-overview': staticBody(
    infoGrid([
      { icon: 'git', title: 'Start from the contract', copy: 'Compare the shape of the change before drawing conclusions about impact.' },
      { icon: 'graph', title: 'Follow the relationships', copy: 'Map producers, consumers, and the edges that need checking.' },
      { icon: 'search', title: 'Keep unknowns visible', copy: 'Unknowns remain visible and are never silently dropped from scope.' },
      { icon: 'shield', title: 'Separate analysis and proof', copy: 'Impact findings guide the investigation; verification results determine the claim.' },
    ]),
    publicSteps([
      ['Select the change', 'Define the source as well as the old and new versions.'],
      ['Map the targets', 'Review relationships and why each target belongs in scope.'],
      ['Plan the checks', 'Decide what must be proven for every target.'],
    ]),
  ),
  '/verification': staticBody(
    publicSteps([
      ['Ensure the baseline is valid', 'Initial behavior must be proven before judging a regression.'],
      ['Reproduce the change impact', 'Apply the new contract to real consumers under the same invariants.'],
      ['Review the candidate proposal', 'AI proposes a fix inside the bounded scope.'],
      ['Verify independently', 'Required checks, source integrity, and proof scope determine the outcome.'],
      ['Report results with their limits', 'Unknown, unsupported, or incomplete evidence continues to withhold positive claims.'],
    ]),
    publicNote('Green alone is not enough', 'Coverage, source identity, required proof, and the pinned scope still need checking.'),
  ),
  '/evidence-overview': staticBody(
    infoGrid([
      { icon: 'evidence', title: 'Evidence manifest', copy: 'Connect the outcome to the inspected source, candidate, and configuration.' },
      { icon: 'clock', title: 'Audit trail', copy: 'Review the sequence of decisions together with their context.' },
      { icon: 'user', title: 'Human review', copy: 'Understand per-target results and limitations before choosing publication.' },
      { icon: 'git', title: 'Scoped publication', copy: 'Incomplete bundles remain labeled incomplete; merge and deploy stay separate.' },
    ]),
    publicNote('Sample, not workspace data', 'Public reports show the shape of evidence. Project artifacts are available only after signing in with access.'),
  ),
  '/collaboration': staticBody(
    infoGrid([
      { icon: 'team', title: 'Invite the team', copy: 'Shape membership with clear responsibilities.' },
      { icon: 'key', title: 'Set project grants', copy: 'Scope project access to each member’s work.' },
      { icon: 'github', title: 'Check repository rights', copy: 'Private repository access always follows current GitHub permissions.' },
      { icon: 'book', title: 'Share review context', copy: 'Separate shareable summaries from internal discussion.' },
    ]),
    publicNote('Access is still required', 'This public page never displays workspace members, invitations, or repositories.'),
  ),
  '/terms': staticBody(
    publicProse([
      ['Use of this site', 'This site demonstrates product flows with illustrative data. Forms, sign-in state, runs, and publication are local behavior against documented APIs.'],
      ['Result limits', 'Sample results are not evidence of real execution or a promise about production software. Every claim needs its scope and evidence.'],
      ['Data you provide', 'Use sample data and avoid secrets, production credentials, or sensitive information.'],
      ['AI-assisted features', 'Some ChangeProof features use AI models to help map impact, phrase hypotheses, and propose candidate fixes. Models can be wrong, invent reasons, or miss context. Model analysis and proposals are not verdicts. Verification results come from the independent verifier and deterministic policy over executed evidence, and every limit ships with the result.'],
      ['Age and permitted use', 'The service is not for users under 18. Forbidden uses include competing-model training, non-consensual deepfakes, unlawful biometric surveillance, emotion recognition at work or school, model weight extraction, API key resale, and offensive cyber operations.'],
      ['AI output labels', 'Model-generated output, including watermarks, labels, and provenance metadata, must not be removed, altered, or obscured when results reach end users.'],
      ['High-stakes decisions', 'Irreversible, destructive, production-affecting, legally binding, merge, or deploy actions always ask a human first. The agent has no standing authority to take them.'],
      ['Before using the service', 'Final terms of use and the service privacy policy must be available before production use. No subscription or payment commitment is made through this site.'],
    ]),
  ),
};

const FIXED_PAGES: readonly FixedPageDef[] = [
  { path: '/product', title: 'Product', eyebrow: 'Product', hero: 'Clear changes. Calm decisions.', sub: 'Meet the ChangeProof flow, from contract change to review-ready evidence.', related: ['/integrations', '/templates', '/sample-report'] },
  { path: '/how-it-works', title: 'How it works', eyebrow: 'How it works', hero: 'From change to evidence.', sub: 'Six bounded steps from intent to an independently checked result.', related: ['/product', '/sample-report', '/pricing'] },
  { path: '/tutorials', title: 'Tutorials', eyebrow: 'Tutorials', hero: 'From first step to review.', sub: 'Learn the workflow through public guides without opening workspace data.', related: ['/integrations', '/templates', '/sample-report'] },
  { path: '/pricing', title: 'Pricing', eyebrow: 'Pricing', hero: 'Start small. Stay in control.', sub: 'See estimates, reservations, and usage before starting verification.', related: ['/product', '/help'] },
  { path: '/documentation', title: 'Documentation', eyebrow: 'Documentation', hero: 'Learn the flow. Find answers.', sub: 'Public guides for meeting ChangeProof before connecting a workspace.', related: ['/product', '/roadmap'] },
  { path: '/guides', title: 'Documentation', eyebrow: 'Documentation', hero: 'Learn the flow. Find answers.', sub: 'Public guides for meeting ChangeProof before connecting a workspace.', related: ['/product', '/roadmap'] },
  { path: '/help', title: 'Help center', eyebrow: 'Help center', hero: 'How can we help?', sub: 'Find answers about accounts, repository access, budgets, and verification outcomes.', related: ['/tutorials', '/privacy-policy'] },
  { path: '/security', title: 'Security', eyebrow: 'Security', hero: 'Isolation first. Secrets never.', sub: 'How the platform keeps customer code, credentials, and tenants apart.', related: ['/privacy', '/terms', '/enterprise'] },
  { path: '/enterprise', title: 'Enterprise', eyebrow: 'Enterprise', hero: 'Governance for regulated teams.', sub: 'Identity, provisioning, keys, and audit for organizations with obligations.', related: ['/security', '/privacy', '/contact'] },
  { path: '/self-hosted', title: 'Self-hosted', eyebrow: 'Self-hosted', hero: 'Run the evidence plane yourself.', sub: 'The same release, operated inside your own boundary.', related: ['/security', '/documentation', '/pricing'] },
  { path: '/templates', title: 'Templates', eyebrow: 'Templates', hero: 'Start with the right question.', sub: 'Example plans for understanding a change. Pick a template before creating a run.', related: ['/tutorials', '/verification'] },
  { path: '/integrations', title: 'GitHub integration', eyebrow: 'GitHub integration', hero: 'Connect change context.', sub: 'Learn the difference between signing in with GitHub and granting repository access.', related: ['/product', '/tutorials', '/privacy-policy'] },
  { path: '/sample-report', title: 'Sample report', eyebrow: 'Sample report', hero: 'See what evidence looks like.', sub: 'Static samples for recognizing results, verification limits, and next decisions.', related: ['/verification', '/evidence-overview', '/guides'] },
  { path: '/status', title: 'Status', eyebrow: 'Status', hero: 'Is ChangeProof reachable?', sub: 'Live service health behind this dashboard, refreshed on every visit.', related: ['/contact', '/documentation'] },
  { path: '/changelog', title: 'Changelog', eyebrow: 'Changelog', hero: 'Follow ChangeProof as it grows.', sub: 'Design notes and product direction, with statuses kept visible.', related: ['/roadmap', '/guides'] },
  { path: '/roadmap', title: 'Roadmap', eyebrow: 'Roadmap', hero: 'Clear direction. Open limits.', sub: 'See the product focus and what still needs proof.', related: ['/changelog', '/help'] },
  { path: '/about', title: 'About', eyebrow: 'About', hero: 'Evidence, not guesses.', sub: 'Why ChangeProof organizes every decision around verifiable results.', related: ['/contact', '/security'] },
  { path: '/contact', title: 'Contact', eyebrow: 'Contact', hero: 'Talk to a human.', sub: 'Send a support ticket; a team member reads every one.', related: ['/documentation', '/status'] },
  { path: '/privacy', title: 'Privacy', eyebrow: 'Privacy', hero: 'Understand how data is used.', sub: 'Public information about data limits and access control in the ChangeProof design.', related: ['/terms', '/help'] },
  { path: '/privacy-policy', title: 'Privacy', eyebrow: 'Privacy', hero: 'Understand how data is used.', sub: 'Public information about data limits and access control in the ChangeProof design.', related: ['/terms', '/help'] },
  { path: '/impact-overview', title: 'Analysis', eyebrow: 'Analysis', hero: 'Every impact, in one map.', sub: 'Learn how to read producer, consumer, and unresolved relationships.', related: ['/verification', '/sample-report', '/templates'] },
  { path: '/verification', title: 'Verification', eyebrow: 'Verification', hero: 'Do not trust. Prove it.', sub: 'Learn how candidates are checked before outcomes are used to make decisions.', related: ['/sample-report', '/evidence-overview'] },
  { path: '/evidence-overview', title: 'Evidence', eyebrow: 'Evidence', hero: 'Every decision has a basis.', sub: 'Learn manifests, audit trails, and review before publishing a candidate.', related: ['/sample-report', '/verification', '/collaboration'] },
  { path: '/collaboration', title: 'Collaboration', eyebrow: 'Collaboration', hero: 'One context for the whole team.', sub: 'Understand roles and access before inviting members to a workspace.', related: ['/integrations', '/privacy-policy', '/guides'] },
  { path: '/terms', title: 'Terms', eyebrow: 'Terms', hero: 'Clear usage boundaries.', sub: 'Usage preview for this site and the ChangeProof service design.', related: ['/privacy', '/contact'] },
];

async function renderFixedPage(outlet: HTMLElement, def: FixedPageDef): Promise<void> {
  stopActiveGhost();
  const host = h('div', {}, [h('p', { class: 'muted' }, ['Loading…'])]);
  outlet.replaceChildren(pageShell(def, [host]));
  const body = FIXED_BODIES[def.path];
  host.replaceChildren();
  if (body === undefined) {
    host.replaceChildren(h('p', { class: 'muted' }, ['This page is not published yet.']));
    return;
  }
  await body(host);
}

/* Manifest-driven #/p/... pages (T-43 behavior, kept intact). The fixed
 * routes above are canonical; these render whatever the live manifest
 * publishes so deep links keep working. */

function pageHead(route: PublicRoute): HTMLElement {
  const canvas = h('canvas', { class: 'cp-ghost-fibers', 'aria-hidden': 'true' }, []);
  const shade = h('div', { class: 'cp-ghost-shade', 'aria-hidden': 'true' }, []);
  const pill = h('div', { class: 'modern-release' }, [
    h('b', {}, [route.section.toUpperCase()]),
    h('span', {}, ['Live published manifest · deterministic verification']),
  ]);
  const hero = h('section', { class: 'cp-identity-hero' }, [
    canvas,
    shade,
    pill,
    h('h1', {}, [route.title]),
    h('p', { class: 'modern-hero-sub' }, [route.summary]),
    ...(route.ctas.length > 0 ? [ctaRow(route.ctas)] : []),
  ]);
  queueMicrotask(() => {
    stopActiveGhost();
    activeGhost = initGhostFibers();
  });
  return hero;
}

function renderPublicNav(activeManifestPath: string): HTMLElement {
  const items: readonly { readonly path: string; readonly label: string }[] = [
    { path: '/', label: 'Overview' },
    { path: '/product', label: 'Product' },
    { path: '/how-it-works', label: 'How it works' },
    { path: '/templates', label: 'Templates' },
    { path: '/sample-report', label: 'Sample reports' },
    { path: '/pricing', label: 'Pricing' },
    { path: '/roadmap', label: 'Roadmap' },
    { path: '/changelog', label: 'Changelog' },
    { path: '/help', label: 'Help & FAQ' },
  ];
  const bar = h('div', { class: 'public-page-nav', role: 'group', 'aria-label': 'Public site sections' }, []);
  for (const item of items) {
    const link = h('a', { href: `#/p${item.path}` }, [item.label]);
    if (item.path === activeManifestPath) {
      link.setAttribute('aria-current', 'page');
    }
    bar.appendChild(link);
  }
  return bar;
}

async function renderFaqBlock(host: HTMLElement): Promise<void> {
  const results = h('div', { 'aria-live': 'polite' }, []);
  const { wrap, input } = field({ id: 'faq-q', label: 'Search frequently asked questions' });
  const button = h('button', { class: 'button primary', type: 'submit' }, ['Search']);
  const form = h('form', { class: 'search-form', role: 'search' }, [wrap, button]);
  const list = h('div', {}, []);
  host.appendChild(h('section', { class: 'card' }, [h('h2', {}, ['Questions and answers']), form, results, list]));

  const renderFaqs = (faqs: readonly PublicFaq[]): void => {
    list.replaceChildren();
    for (const faq of faqs) {
      list.appendChild(
        h('article', { class: 'faq-item' }, [
          h('h3', {}, [faq.question]),
          h('p', {}, [faq.answer]),
          h('p', { class: 'muted' }, [`Topics: ${faq.topics.join(', ')} · Updated ${faq.updatedAt}`]),
        ]),
      );
    }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = input.value.trim();
    input.removeAttribute('aria-invalid');
    form.querySelector('.error-text')?.remove();
    if (query === '') {
      input.setAttribute('aria-invalid', 'true');
      const errorId = 'faq-q-error';
      input.setAttribute('aria-describedby', errorId);
      wrap.appendChild(h('p', { class: 'error-text', id: errorId }, ['Type at least one word to search.']));
      input.focus();
      return;
    }
    void (async () => {
      try {
        const found = await apiGet<{ results: readonly PublicFaq[]; recovery: string }>(
          `/api/site/faq?q=${encodeURIComponent(query)}`,
        );
        results.replaceChildren(
          h('p', { class: 'muted' }, [
            found.results.length === 0 ? found.recovery : `${found.results.length} matching answers:`,
          ]),
        );
        renderFaqs(found.results);
      } catch (error) {
        const message = error instanceof ApiRequestError ? error.failure.message : 'Search failed.';
        results.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [message]));
      }
    })();
  });

  try {
    renderFaqs(await apiGet<readonly PublicFaq[]>('/api/site/faqs'));
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'FAQ list failed to load.';
    list.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [message]));
  }
}

async function renderTemplatesBlock(host: HTMLElement): Promise<void> {
  try {
    const templates = await apiGet<readonly PublicTemplate[]>('/api/site/templates');
    const cards = h('div', { class: 'grid3' }, []);
    for (const template of templates) {
      cards.appendChild(
        h('article', { class: 'card' }, [
          h('div', { class: 'eyebrow' }, ['Starter Template']),
          h('h2', {}, [template.title]),
          h('p', {}, [template.description]),
          h('p', {}, [h('a', { class: 'button primary', href: `#/p/templates/${template.id}` }, ['Open template'])]),
        ]),
      );
    }
    host.appendChild(h('section', {}, [h('h2', {}, ['Available templates']), cards]));
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'Template list failed to load.';
    host.appendChild(errorState('Templates unavailable', message));
  }
}

async function renderSamplesBlock(host: HTMLElement): Promise<void> {
  try {
    const samples = await apiGet<readonly SampleReport[]>('/api/site/samples');
    const cards = h('div', { class: 'grid2' }, []);
    for (const sample of samples) {
      cards.appendChild(
        h('article', { class: 'card' }, [
          h('p', {}, [badge('info', 'Synthetic sample')]),
          h('h2', {}, [sample.title]),
          h('p', {}, [sample.summary]),
          h('p', {}, [h('a', { class: 'button primary', href: `#/p/samples/${sample.id}` }, ['Open sample'])]),
        ]),
      );
    }
    host.appendChild(h('section', {}, [h('h2', {}, ['Sample reports']), cards]));
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'Sample list failed to load.';
    host.appendChild(errorState('Samples unavailable', message));
  }
}

async function renderChangelogBlock(host: HTMLElement): Promise<void> {
  try {
    const log = await apiGet<{ design: readonly ChangelogEntry[]; releases: readonly ChangelogEntry[] }>(
      '/api/site/changelog',
    );
    const group = (title: string, entries: readonly ChangelogEntry[]): HTMLElement => {
      const section = h('section', { class: 'card' }, [h('h2', {}, [title])]);
      if (entries.length === 0) {
        section.appendChild(h('p', { class: 'muted' }, ['Nothing published here yet.']));
        return section;
      }
      for (const entry of entries) {
        section.appendChild(
          h('article', { class: 'faq-item' }, [
            h('h3', {}, [entry.version === undefined ? entry.title : `${entry.title} (${entry.version})`]),
            h('p', {}, [entry.body]),
            h('p', { class: 'muted' }, [entry.date]),
          ]),
        );
      }
      return section;
    };
    // Design notes and shipped releases stay visibly separate (FR3-37).
    host.appendChild(h('div', { class: 'split' }, [group('Design notes', log.design), group('Releases', log.releases)]));
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'Changelog failed to load.';
    host.appendChild(errorState('Changelog unavailable', message));
  }
}

async function renderRoadmapBlock(host: HTMLElement): Promise<void> {
  try {
    const items = await apiGet<readonly RoadmapItem[]>('/api/site/roadmap');
    const grid = h('div', { class: 'grid2' }, []);
    for (const item of items) {
      const tone = item.status === 'supported' ? 'ok' : item.status === 'in-qualification' ? 'warn' : 'info';
      grid.appendChild(
        h('article', { class: 'faq-item' }, [
          h('h3', {}, [item.title]),
          h('p', {}, [badge(tone, item.status)]),
          ...(item.evidenceRef === undefined ? [] : [h('p', { class: 'muted' }, [`Evidence: ${item.evidenceRef}`])]),
        ]),
      );
    }
    const section = h('section', { class: 'card' }, [h('h2', {}, ['Qualification status']), grid]);
    host.appendChild(section);
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'Roadmap failed to load.';
    host.appendChild(errorState('Roadmap unavailable', message));
  }
}

async function renderPricingBlock(host: HTMLElement): Promise<void> {
  try {
    const pricing = await apiGet<PricingSnapshot>('/api/site/pricing');
    const grid = h('div', { class: 'grid3' }, []);
    for (const tier of pricing.tiers) {
      grid.appendChild(
        h('article', { class: 'faq-item' }, [
          h('div', { class: 'eyebrow' }, ['Plan Tier']),
          h('h3', {}, [tier.name]),
          h('p', {}, [tier.notes]),
        ]),
      );
    }
    const section = h('section', { class: 'card' }, [
      h('h2', {}, ['Plans']),
      h('p', { class: 'muted' }, [`Pricing version ${pricing.pricingVersion} · ${pricing.currency}`]),
      grid,
    ]);
    host.appendChild(section);
  } catch (error) {
    const message = error instanceof ApiRequestError ? error.failure.message : 'Pricing failed to load.';
    host.appendChild(errorState('Pricing unavailable', message));
  }
}

const SECTION_BLOCKS: Readonly<Record<string, (host: HTMLElement) => Promise<void>>> = {
  '/help': renderFaqBlock,
  '/templates': renderTemplatesBlock,
  '/sample-report': renderSamplesBlock,
  '/changelog': renderChangelogBlock,
  '/roadmap': renderRoadmapBlock,
  '/pricing': renderPricingBlock,
};

async function renderPublicPage(outlet: HTMLElement, manifestPath: string): Promise<void> {
  stopActiveGhost();
  await load(
    outlet,
    () => apiGet<PublicRoute>(`/api/site/routes?path=${encodeURIComponent(manifestPath)}`),
    async (route) => {
      outlet.replaceChildren(renderPublicNav(manifestPath), pageHead(route));
      const block = SECTION_BLOCKS[manifestPath];
      if (block !== undefined) await block(outlet);
    },
  );
}

interface ApplyGate {
  readonly requiresLogin: boolean;
  readonly loginThenReturnTo: string;
}

function gateOf(error: unknown): ApplyGate | undefined {
  if (!(error instanceof ApiRequestError) || error.failure.status !== 401) return undefined;
  const detail = error.failure.detail as { gate?: { requiresLogin?: unknown; loginThenReturnTo?: unknown } } | undefined;
  const gate = detail?.gate;
  if (gate?.requiresLogin !== true || typeof gate.loginThenReturnTo !== 'string') return undefined;
  return { requiresLogin: true, loginThenReturnTo: gate.loginThenReturnTo };
}

async function renderTemplateDetail(outlet: HTMLElement, id: string): Promise<void> {
  stopActiveGhost();
  await load(
    outlet,
    () => apiGet<PublicTemplate>(`/api/site/templates/${encodeURIComponent(id)}`),
    (template) => {
      renderTemplateBody(outlet, template);
    },
  );
}

function renderTemplateBody(outlet: HTMLElement, template: PublicTemplate): void {
  const apply = h('button', { class: 'button primary', type: 'button' }, ['Apply this template']);
  const notice = h('div', { 'aria-live': 'polite' }, []);
  apply.addEventListener('click', () => {
    apply.disabled = true;
    apply.textContent = 'Applying…';
    void (async () => {
      try {
        await apiPost(`/api/site/templates/${encodeURIComponent(template.id)}/apply`, {});
        notice.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, ['Unexpected answer; please retry.']));
        apply.disabled = false;
        apply.textContent = 'Apply this template';
      } catch (error) {
        const gate = gateOf(error);
        if (gate !== undefined) {
          window.location.hash = `#/login?return=${encodeURIComponent(gate.loginThenReturnTo)}`;
          return;
        }
        const message = error instanceof ApiRequestError ? error.failure.message : 'Apply failed.';
        notice.replaceChildren(h('p', { class: 'error-text', role: 'alert' }, [message]));
        apply.disabled = false;
        apply.textContent = 'Apply this template';
      }
    })();
  });
  const fields = h('dl', { class: 'detail-list' }, []);
  for (const item of template.fields) {
    fields.append(h('dt', {}, [item.label]), h('dd', {}, [item.help]));
  }
  outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, [template.title]),
      h('p', {}, [template.description]),
      h('p', { class: 'muted' }, ['Applying a template needs a login; guests are sent to the login step.']),
      apply,
      notice,
    ]),
    h('section', { class: 'card' }, [h('h2', {}, ['What you will provide']), fields]),
  );
}

async function renderSampleDetail(outlet: HTMLElement, id: string): Promise<void> {
  stopActiveGhost();
  await load(
    outlet,
    () => apiGet<SampleReport>(`/api/site/samples/${encodeURIComponent(id)}`),
    (sample) => {
      outlet.replaceChildren(
    h('section', { class: 'card' }, [
      h('h1', {}, [sample.title]),
      h('p', {}, [badge('info', sample.provenance.label)]),
      h('p', {}, [sample.summary]),
      h('dl', { class: 'detail-list' }, [
        h('dt', {}, ['Dataset']),
        h('dd', {}, [`${sample.provenance.datasetId} v${sample.provenance.datasetVersion}`]),
        h('dt', {}, ['Captured']),
        h('dd', {}, [sample.provenance.capturedAt]),
        h('dt', {}, ['Source']),
        h('dd', {}, [sample.provenance.source]),
      ]),
      h('p', { class: 'muted' }, ['Samples show the report layout only; they are not customer results.']),
      ]),
    );
  },
  );
}

/**
 * Register the fixed public routes plus one route per manifest path and the
 * template/sample detail routes. /login is owned by the auth module.
 */
export function registerPublicPages(routes: readonly PublicRoute[], templateIds: readonly string[], sampleIds: readonly string[]): void {
  initPublicChrome();
  registerRoute({
    path: '/',
    title: 'ChangeProof AI',
    navLabel: 'Home',
    navSection: 'public',
    render: (outlet) => renderLanding(outlet),
  });
  registerRoute({
    path: '/landing',
    title: 'ChangeProof AI',
    render: (outlet) => renderLanding(outlet),
  });
  for (const def of FIXED_PAGES) {
    registerRoute({
      path: def.path,
      title: def.title,
      render: (outlet) => renderFixedPage(outlet, def),
    });
  }
  for (const route of routes) {
    const manifestPath = route.path;
    registerRoute({
      path: `/p${manifestPath === '/' ? '/' : manifestPath}`,
      title: route.title,
      navLabel: manifestPath === '/' ? 'Start' : route.title,
      navSection: 'public',
      render: (outlet) => renderPublicPage(outlet, manifestPath),
    });
  }
  for (const id of templateIds) {
    registerRoute({
      path: `/p/templates/${id}`,
      title: 'Template',
      render: (outlet) => renderTemplateDetail(outlet, id),
    });
  }
  for (const id of sampleIds) {
    registerRoute({
      path: `/p/samples/${id}`,
      title: 'Sample report',
      render: (outlet) => renderSampleDetail(outlet, id),
    });
  }
}
