/* Public site pages (T-43, FR3-37). Every page renders live API data
 * from the versioned manifest; every CTA resolves to a real in-app
 * destination. Server strings pass through textContent only (NEG3-21
 * content layer; the API boundary stays server-side). */

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

import { apiGet, apiPost, ApiRequestError } from '../api.js';
import { badge, emptyState, errorState, field, h } from '../components.js';
import { registerRoute, type RouteContext } from '../routes.js';

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

function startGhostFibers(canvas: HTMLCanvasElement): void {
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return;
  }
  if (ctx === null) return;
  const context = ctx;
  const width = 960;
  const height = 360;
  canvas.width = width;
  canvas.height = height;
  canvas.setAttribute('aria-hidden', 'true');

  const drawFrame = (t: number): void => {
    context.clearRect(0, 0, width, height);
    const dark = document.documentElement.dataset['theme'] === 'dark';
    const palettes = dark
      ? ['rgba(155, 188, 233, 0.20)', 'rgba(155, 188, 233, 0.17)', 'rgba(155, 188, 233, 0.14)', 'rgba(155, 188, 233, 0.11)']
      : ['rgba(54, 94, 150, 0.14)', 'rgba(54, 94, 150, 0.12)', 'rgba(54, 94, 150, 0.10)', 'rgba(54, 94, 150, 0.08)'];
    for (let i = 0; i < palettes.length; i += 1) {
      context.beginPath();
      context.strokeStyle = palettes[i] ?? 'rgba(54, 94, 150, 0.14)';
      context.lineWidth = 2 + (i % 2);
      const baseY = 95 + i * 48;
      for (let x = 0; x <= width; x += 24) {
        const wave = Math.sin(x * 0.008 + t * 0.0012 + i * 0.9) * 28 + Math.cos(x * 0.004 - t * 0.0008 + i) * 14;
        const y = baseY + wave;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  };

  drawFrame(0);
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }
  let rafId = 0;
  const tick = (now: number): void => {
    if (!canvas.isConnected) {
      cancelAnimationFrame(rafId);
      return;
    }
    drawFrame(now);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

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
    startGhostFibers(canvas);
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

function renderHomeProofStory(): HTMLElement {
  const steps = [
    {
      id: 'impact',
      label: '1. Impact & Scope',
      title: 'Cross-boundary impact graph before any patch is proposed',
      summary: 'Extracts proven, inferred, and unresolved edges across APIs, schemas, migrations, and consumers so hidden blast radius is visible up front.',
      nodes: [
        { k: 'Boundary', v: 'OpenAPI & DB schema' },
        { k: 'Edge status', v: 'Proven · Inferred · Unresolved' },
        { k: 'Fail-closed rule', v: 'Unresolved edges stay visible' },
      ],
    },
    {
      id: 'bundle',
      label: '2. Candidate Bundle',
      title: 'Coordinated multi-target patches under a typed mutation gateway',
      summary: 'Candidate patches are scoped to allowed paths only. Protected oracles, verifier configuration, and policy rules cannot be modified by the candidate.',
      nodes: [
        { k: 'Gateway', v: 'Path & operation allowlist' },
        { k: 'Oracle boundary', v: 'Frozen before execution' },
        { k: 'Identity', v: 'Content-addressed SHA-256' },
      ],
    },
    {
      id: 'verifier',
      label: '3. Independent Verifier',
      title: 'Real execution inside an isolated guest boundary',
      summary: 'Runs native compilers, migrations, services, and fault campaigns against the frozen oracle without exposing host sockets or tenant secrets.',
      nodes: [
        { k: 'Execution', v: 'Isolated guest runner' },
        { k: 'Dimensions', v: 'Correctness · Perf · Resilience · Data' },
        { k: 'Egress', v: 'Closed by default' },
      ],
    },
    {
      id: 'policy',
      label: '4. Deterministic Verdict',
      title: 'Policy computes the verdict from verifier evidence — never the model',
      summary: 'Dimensions are evaluated separately without averaging. If any required proof is missing or incomplete, the verdict withholds assurance honestly.',
      nodes: [
        { k: 'Authority', v: 'Pure deterministic policy' },
        { k: 'Aggregation', v: 'Zero dimension averaging' },
        { k: 'Artifact store', v: 'Digest-verified evidence' },
      ],
    },
  ] as const;

  const stageTitle = h('h3', {}, [steps[0].title]);
  const stageBody = h('p', { class: 'muted' }, [steps[0].summary]);
  const flow = h('div', { class: 'proof-flow' }, []);
  const stagePanel = h(
    'div',
    { class: 'proof-panel', id: 'proof-story-panel', role: 'tabpanel', 'aria-labelledby': `proof-tab-${steps[0].id}` },
    [stageTitle, stageBody, flow],
  );

  const tabList = h('div', { class: 'proof-story-tabs', role: 'tablist', 'aria-label': 'Verification pipeline stages' }, []);
  const buttons: HTMLButtonElement[] = [];

  const selectStep = (index: number): void => {
    const step = steps[index] ?? steps[0];
    buttons.forEach((btn, idx) => {
      btn.setAttribute('aria-selected', idx === index ? 'true' : 'false');
    });
    stagePanel.setAttribute('aria-labelledby', `proof-tab-${step.id}`);
    stageTitle.textContent = step.title;
    stageBody.textContent = step.summary;
    flow.replaceChildren(
      ...step.nodes.map((node) =>
        h('div', { class: 'proof-flow-node' }, [
          h('span', {}, [node.k]),
          h('strong', {}, [node.v]),
        ]),
      ),
    );
  };

  steps.forEach((step, idx) => {
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'tab',
        id: `proof-tab-${step.id}`,
        'aria-controls': 'proof-story-panel',
        'aria-selected': idx === 0 ? 'true' : 'false',
      },
      [step.label],
    );
    btn.addEventListener('click', () => {
      selectStep(idx);
    });
    buttons.push(btn);
    tabList.appendChild(btn);
  });

  selectStep(0);

  const techStrip = h('div', { class: 'cp-tech-strip' }, [
    h('p', {}, ['DETERMINISTIC ASSURANCE PIPELINE · ZERO MODEL VERDICT AUTHORITY']),
    h('div', { class: 'cp-tech-group' }, [
      h('span', { class: 'cp-tech-logo' }, ['Impact Graph']),
      h('span', { class: 'cp-tech-logo' }, ['Coordinated Bundle']),
      h('span', { class: 'cp-tech-logo' }, ['Frozen Oracle']),
      h('span', { class: 'cp-tech-logo' }, ['Isolated Verifier']),
      h('span', { class: 'cp-tech-logo' }, ['Pure Policy Verdict']),
      h('span', { class: 'cp-tech-logo' }, ['SHA-256 Evidence']),
    ]),
  ]);

  const story = h('section', { class: 'proof-story' }, [
    h('div', { class: 'proof-story-layout' }, [
      h('div', {}, [
        h('div', { class: 'eyebrow' }, ['Verification Architecture']),
        h('h2', {}, ['How ChangeProof verifies a software change']),
        h('p', { class: 'muted' }, [
          'Explore each stage of the pipeline. Every verdict comes from deterministic policy over independent verifier receipts.',
        ]),
        tabList,
      ]),
      h('div', { class: 'proof-story-stage' }, [
        h('div', { class: 'proof-stage-top' }, [
          h('span', { class: 'proof-stage-dot' }, []),
          h('span', { class: 'proof-stage-dot' }, []),
          h('span', { class: 'proof-stage-dot' }, []),
          h('span', { class: 'proof-stage-sample' }, [' ARCHITECTURE WALKTHROUGH ']),
        ]),
        stagePanel,
      ]),
    ]),
  ]);

  const wrap = h('div', {}, [techStrip, story]);
  return wrap;
}

function renderPublicFooter(): HTMLElement {
  return h('div', { class: 'modern-footer' }, [
    h('span', {}, ['ChangeProof AI · Evidence-backed software change verification']),
    h('span', {}, ['Deterministic policy · Frozen oracle · Isolated execution']),
  ]);
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
  await load(
    outlet,
    () => apiGet<PublicRoute>(`/api/site/routes?path=${encodeURIComponent(manifestPath)}`),
    async (route) => {
      outlet.replaceChildren(renderPublicNav(manifestPath), pageHead(route));
      if (manifestPath === '/') {
        outlet.appendChild(renderHomeProofStory());
      }
      const block = SECTION_BLOCKS[manifestPath];
      if (block !== undefined) await block(outlet);
      outlet.appendChild(renderPublicFooter());
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

function renderLoginNotice(outlet: HTMLElement, ctx: RouteContext): void {
  const checked = validateReturnTarget(ctx.params.get('return'));
  const card = h('section', { class: 'card' }, [
    h('h1', {}, ['Login is required']),
    checked.valid
      ? h('p', {}, [`This step needs a login. Afterwards you continue to ${checked.target}.`])
      : h('p', {}, ['This step needs a login.']),
    h('p', { class: 'muted' }, ['The login form arrives with the account surface; this notice only holds your place.']),
    h('p', {}, [h('a', { class: 'button', href: '#/p/' }, ['Back to the public site'])]),
  ]);
  outlet.replaceChildren(card);
}

/** Register one route per manifest path plus detail and login routes. */
export function registerPublicPages(routes: readonly PublicRoute[], templateIds: readonly string[], sampleIds: readonly string[]): void {
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
  registerRoute({
    path: '/login',
    title: 'Login is required',
    navLabel: 'Login',
    navSection: 'account',
    render: (outlet, ctx) => {
      renderLoginNotice(outlet, ctx);
    },
  });
}
