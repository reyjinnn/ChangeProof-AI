/* Original SVG diagrams explain a workflow; they never represent a real run. */
import './pilot.css';
import { h, svgEl } from './components.js';

function text(x: number, y: number, copy: string, className: string): SVGElement {
  const node = svgEl('text', { x: String(x), y: String(y), class: className });
  node.textContent = copy;
  return node;
}

export function workflowMap(kind: 'landing' | 'overview'): HTMLElement {
  const landing = kind === 'landing';
  const marker = `pilot-arrow-${kind}`;
  const node = (x: number, y: number, title: string, note: string, variant = ''): SVGElement => svgEl('g', { class: `pilot-map-node ${variant}` }, [
    svgEl('rect', { x: String(x), y: String(y), width: '164', height: '72', rx: '12' }),
    svgEl('circle', { cx: String(x + 19), cy: String(y + 22), r: '3' }),
    text(x + 31, y + 26, title, 'pilot-map-title'), text(x + 18, y + 50, note, 'pilot-map-note'),
  ]);
  const path = (d: string, gap = false): SVGElement => svgEl('path', { d, class: gap ? 'pilot-map-edge is-gap' : 'pilot-map-edge', 'marker-end': `url(#${marker})` });
  const diagram = svgEl('svg', { viewBox: '0 0 640 350', 'aria-hidden': 'true', focusable: 'false' }, [
    svgEl('defs', {}, [svgEl('marker', { id: marker, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' }, [svgEl('path', { d: 'M0 0 10 5 0 10z', fill: 'currentColor' })])]),
    path('M190 174 C226 174 218 83 252 83'), path('M190 174 C226 174 218 265 252 265', true),
    path('M416 83 C453 83 440 174 472 174'), path('M416 265 C453 265 440 174 472 174', true),
    node(26, 138, landing ? 'orders-service' : 'Change intent', landing ? 'Source contract' : 'Intent and scope', 'is-source'),
    node(252, 47, landing ? 'storefront' : 'Impact scope', landing ? 'Consumer relationship' : 'Map relationships'),
    node(252, 229, landing ? 'Unresolved edge' : 'Required checks', landing ? 'Keep the gap visible' : 'Independent checks', 'is-gap'),
    svgEl('g', { class: 'pilot-map-end' }, [svgEl('rect', { x: '472', y: '138', width: '142', height: '72', rx: '12' }), text(489, 165, landing ? 'Check scope' : 'Evidence', 'pilot-map-title'), text(489, 189, 'No result claimed', 'pilot-map-note')]),
    text(260, 183, 'CHANGE → EVIDENCE', 'pilot-map-axis'),
  ]);
  diagram.classList.add('pilot-map-wide');
  const compact = svgEl('svg', { class: 'pilot-map-compact', viewBox: '0 0 320 430', 'aria-hidden': 'true', focusable: 'false' }, [
    path('M150 92 C150 112 94 104 94 124'), path('M242 56 C300 56 226 208 226 228', true),
    path('M94 196 C20 196 26 332 78 368'), path('M226 300 C226 320 160 312 160 332', true),
    node(78, 20, landing ? 'orders-service' : 'Change intent', landing ? 'Source contract' : 'Intent and scope', 'is-source'),
    node(12, 124, landing ? 'storefront' : 'Impact scope', landing ? 'Consumer relationship' : 'Map relationships'),
    node(144, 228, landing ? 'Unresolved edge' : 'Required checks', landing ? 'Keep the gap visible' : 'Independent checks', 'is-gap'),
    node(78, 332, landing ? 'Check scope' : 'Evidence', 'No result claimed'),
  ]);
  return h('figure', { class: 'pilot-map', role: 'img', 'aria-label': 'Illustrative change-to-evidence workflow. Unknown relationships and required checks remain visible; no live run is shown.', ...(landing ? { 'data-pilot-graph': '' } : { 'data-overview-map': '' }) }, [
    h('figcaption', {}, [h('span', { class: 'pilot-eyebrow' }, [landing ? 'RELATIONSHIP EXPLORER' : 'THE PATH TO PROOF']), h('span', { class: 'pilot-illustration-label' }, ['Illustrative workflow'])]), diagram, compact,
    h('p', { class: 'pilot-map-foot' }, [h('span', { class: 'pilot-gap-key' }, ['Dashed path: still needs evidence']), h('span', {}, ['No execution or repair result'])]),
  ]);
}
