// An in-memory stand-in for the gateway, so the real interface can be opened
// and operated without a server. Every route the app calls is answered here
// with the same shapes the gateway returns; the UI, its rules and its styles
// are the application's own, unmodified.
//
// The data below is sample data for a fictional job. It is labelled as such on
// the page and is not anyone's real account.
import type {State} from '../src/api';

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const id = (n: string) => `demo-${n}`;

const offer = (o: Partial<State['offer'][number]> & {supplierId: string; supplier: string; sku: string; product: string; unitPrice: number}) => ({
  id: id(`offer-${o.sku}`), requestId: id('material-1'), method: 'partner_api' as const,
  url: `https://example.test/p/${o.sku}`, specification: '', quantity: 40, currency: 'USD',
  shipping: 0, tax: null, fees: 0, inventory: null, availability: 'unconfirmed',
  pickup: {available: null, eta: '', location: ''}, delivery: {available: null, eta: '', location: ''},
  observedAt: iso(6), matchQuality: 'exact' as const, confidence: 0.9, ...o,
});

function seed(): State {
  return {
    agent: [{id: id('agent'), name: 'Claw', title: 'Your AI employee', instructions: 'Be accurate and concise. Verify anything external before acting.', runtime: 'hermes', avatar: '✦', skills: [id('skill-general'), id('skill-procurement'), id('skill-work')]}],
    skill: [
      {id: id('skill-general'), key: 'general', name: 'General', instructions: 'Research and complete personal or work tasks. Verify sources and actions.'},
      {id: id('skill-work'), key: 'work', name: 'Work & productivity', instructions: 'Research, create documents, organise files and commitments.'},
      {id: id('skill-procurement'), key: 'procurement', name: 'Shopping & materials', instructions: 'Confirm model, dimensions, compatibility, quantities and substitutes. Compare timestamped prices and delivery. Never infer stock.'},
    ],
    run: [
      {id: id('run-1'), task: 'Price M6 × 40mm stainless bolts, 40 of them, for the Oakridge handrail', status: 'completed', runtime: 'hermes', createdAt: iso(7), completedAt: iso(6), conversationId: id('conv-1'), context: {source: 'phone', attachments: [id('art-photo')]},
       result: 'Four suppliers answered. Riverside Building Supply is cheapest delivered at $58.40 for 40, ready for pickup today. Northside Lumber did not answer, so there may be a better local price than these.'},
      {id: id('run-2'), task: 'Order the Riverside bolts for Thursday', status: 'needs_user', runtime: 'hermes', createdAt: iso(2), conversationId: id('conv-2'), context: {source: 'text', attachments: []}},
    ],
    material: [{id: id('material-1'), runId: id('run-1'), description: 'M6 × 40mm stainless bolt, 40 off', specification: 'A4 316 stainless, hex head, full thread', quantity: 40, currency: 'USD', searchedAt: iso(6),
      suppliers: [
        {id: 'home_depot', name: 'The Home Depot', method: 'partner_api', status: 'ok', offers: 1, checkedAt: iso(6)},
        {id: 'lowes', name: "Lowe's", method: 'partner_api', status: 'ok', offers: 1, checkedAt: iso(6)},
        {id: 'walmart', name: 'Walmart', method: 'official_api', status: 'ok', offers: 1, checkedAt: iso(6)},
        {id: 'riverside_supply', name: 'Riverside Building Supply', method: 'partner_api', status: 'ok', offers: 1, checkedAt: iso(6)},
        {id: 'northside_lumber', name: 'Northside Lumber', method: 'partner_api', status: 'failed', offers: 0, checkedAt: iso(6), detail: 'Did not answer'},
        {id: 'amazon', name: 'Amazon', method: 'official_api', status: 'timeout', offers: 0, checkedAt: iso(6), detail: 'Did not answer in time'},
      ]}],
    offer: [
      offer({supplierId: 'riverside_supply', supplier: 'Riverside Building Supply', sku: 'RS-118', product: 'M6 × 40mm A4 stainless hex bolt', specification: 'A4 316, full thread, 40 per box', unitPrice: 1.32, shipping: 0, tax: 5.60, fees: 0, inventory: 360, availability: 'In stock', pickup: {available: true, eta: 'Ready today', location: 'Riverside yard, 4 mi'}, delivery: {available: true, eta: 'Thu, 5 Jun', location: ''}}),
      offer({supplierId: 'home_depot', supplier: 'The Home Depot', sku: 'HD-2291', product: 'M6 × 40mm stainless hex bolt, 25-pack', specification: 'A2 304 stainless — lower grade than requested', unitPrice: 1.58, shipping: 0, tax: 6.70, fees: 0, inventory: 88, availability: 'In stock', pickup: {available: true, eta: 'Ready in 2 hours', location: 'Store #6142'}, delivery: {available: true, eta: 'Fri, 6 Jun', location: ''}, matchQuality: 'candidate', confidence: 0.66}),
      offer({supplierId: 'lowes', supplier: "Lowe's", sku: 'LW-7740', product: 'M6 × 40mm A4 stainless hex bolt', unitPrice: 1.41, shipping: 8.95, tax: 6.00, fees: 0, inventory: 12, availability: 'Low stock', pickup: {available: false, eta: '', location: ''}, delivery: {available: true, eta: 'Mon, 9 Jun', location: ''}}),
      offer({supplierId: 'walmart', supplier: 'Walmart', sku: 'WM-5518', product: 'M6 × 40mm stainless bolt assortment tub', specification: 'Assorted lengths — not a single size', unitPrice: 0.94, shipping: null, tax: null, fees: 0, availability: 'Available online', delivery: {available: true, eta: 'Tue, 10 Jun', location: ''}, matchQuality: 'unverified', confidence: 0.33}),
    ],
    approval: [{id: id('approval-1'), runId: id('run-2'), tool: 'purchase_order', label: 'Place the exact purchase shown for approval', effect: 'financial', status: 'pending', expiresAt: Date.now() + 26 * 60_000,
      details: {supplier: 'Riverside Building Supply', item: 'M6 × 40mm A4 stainless hex bolt', quantity: 40, unitPrice: '$1.32', subtotal: '$52.80', tax: '$5.60', delivery: '$0.00', total: '$58.40', fulfillment: 'Pickup today, Riverside yard', quoteExpires: 'in 26 minutes'}}],
    artifact: [
      {id: id('art-photo'), runId: id('run-1'), kind: 'photo', name: 'Handrail bracket.jpg', mime: 'image/jpeg'},
      {id: id('art-doc'), runId: id('run-1'), kind: 'document', name: 'Task result', text: 'Four suppliers answered.'},
    ],
    contact: [{id: id('contact-1'), name: 'Dana at Riverside', phone: '+15550001111'}],
    memory: [
      {id: id('mem-1'), kind: 'work', text: 'Oakridge job: all exterior fixings must be A4 316 stainless, not A2.'},
      {id: id('mem-2'), kind: 'profile', text: 'Prefers pickup over delivery when the yard is within 10 miles.'},
    ],
    conversation: [{id: id('conv-1'), title: 'Price M6 bolts'}, {id: id('conv-2'), title: 'Order the Riverside bolts'}],
    message: [], communication: [], cart: [], quote: [], order: [], workflow: [], computer: [], policy: [],
    action: [{id: id('action-1'), runId: id('run-1'), name: 'products_search', status: 'completed', effect: 'read'}],
    evidence_link: [{id: id('link-1'), runId: id('run-1'), artifactId: id('art-photo')}],
  };
}

const connections = {
  realtime: false, hermes: true, anthropic: false, sms: false, voice: false, products: true, browser: false,
  suppliers: [
    {id: 'home_depot', name: 'The Home Depot', method: 'partner_api' as const, connected: true, requires: ['HOME_DEPOT_API_KEY']},
    {id: 'lowes', name: "Lowe's", method: 'partner_api' as const, connected: true, requires: ['LOWES_API_KEY']},
    {id: 'amazon', name: 'Amazon', method: 'official_api' as const, connected: true, requires: ['AMAZON_API_KEY']},
    {id: 'walmart', name: 'Walmart', method: 'official_api' as const, connected: true, requires: ['WALMART_API_KEY']},
    {id: 'riverside_supply', name: 'Riverside Building Supply', method: 'partner_api' as const, connected: true, requires: ['RIVERSIDE_TOKEN']},
    {id: 'northside_lumber', name: 'Northside Lumber', method: 'partner_api' as const, connected: false, requires: ['NORTHSIDE_TOKEN']},
  ],
  mcp: [],
};

export function installMockGateway() {
  let state = seed();
  // The preview opens on a working account: an empty sign-in wall would show
  // nothing of what the app does.
  let signedIn = true;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
  const empty = () => new Response(null, {status: 204});

  // A submitted task runs briefly and then answers, so the working and done
  // states are both visible rather than described.
  const runTask = (task: string) => {
    const run = {id: `run-${Date.now()}`, task, status: 'working' as const, runtime: 'hermes', createdAt: new Date().toISOString(), conversationId: id('conv-1'), context: {source: 'text' as const, attachments: []}};
    state.run = [run, ...state.run];
    setTimeout(() => {
      const at = state.run.findIndex(r => r.id === run.id);
      if (at >= 0 && state.run[at]!.status === 'working') {
        state.run[at] = {...state.run[at]!, status: 'completed', completedAt: new Date().toISOString(),
          result: 'This preview answers from sample data rather than a model. On a connected gateway this is where the employee’s result and its evidence appear.'};
        state.artifact = [{id: `art-${run.id}`, runId: run.id, kind: 'document', name: 'Task result', text: 'Sample result'}, ...state.artifact];
      }
    }, 2200);
    return run;
  };

  const routes: [RegExp, (m: RegExpMatchArray, init: RequestInit) => Response][] = [
    [/^\/api\/session$/, () => (signedIn ? json({owner: 'sam', csrf: 'demo-csrf'}) : json({error: {message: 'Sign in to continue.'}}, 401))],
    [/^\/api\/auth\/login$/, () => {signedIn = true; return json({owner: 'sam', csrf: 'demo-csrf'});}],
    [/^\/api\/auth\/logout$/, () => {signedIn = false; state = seed(); return empty();}],
    [/^\/api\/state$/, () => (signedIn ? json(state) : json({error: {message: 'Sign in to continue.'}}, 401))],
    [/^\/api\/connections$/, () => json(connections)],
    [/^\/livekit-token$/, () => json({error: {message: 'Realtime voice is not configured in this preview.'}}, 503)],
    [/^\/api\/execute$/, (_m, init) => json(runTask(JSON.parse(String(init.body ?? '{}')).task ?? 'Task'), 202)],
    [/^\/api\/runs\/([^/]+)\/cancel$/, m => {
      state.run = state.run.map(r => (r.id === decodeURIComponent(m[1]!) ? {...r, status: 'cancelled' as const, completedAt: new Date().toISOString()} : r));
      return empty();
    }],
    [/^\/api\/runs\/([^/]+)\/resume$/, () => empty()],
    [/^\/api\/approvals\/([^/]+)$/, (m, init) => {
      const decision = JSON.parse(String(init.body ?? '{}')).decision;
      const approvalId = decodeURIComponent(m[1]!);
      const approval = state.approval.find(a => a.id === approvalId);
      state.approval = state.approval.map(a => (a.id === approvalId ? {...a, status: decision === 'deny' || decision === 'never' ? 'denied' as const : 'approved' as const} : a));
      if (approval) {
        const done = decision === 'deny' || decision === 'never';
        state.run = state.run.map(r => (r.id === approval.runId ? {...r, status: done ? 'cancelled' as const : 'completed' as const, completedAt: new Date().toISOString(),
          result: done ? undefined : 'Order placed with Riverside Building Supply. Order RS-40188, $58.40, pickup today. Receipt saved as evidence.'} : r));
        if (!done) state.order = [{id: id('order-1'), orderNumber: 'RS-40188', supplier: 'Riverside Building Supply', total: 58.4, currency: 'USD', status: 'ordered'}];
      }
      return empty();
    }],
    [/^\/api\/artifacts$/, () => json({id: `art-${Date.now()}`, kind: 'photo', name: 'Photo.jpg', mime: 'image/jpeg'}, 201)],
    [/^\/api\/memory$/, (_m, init) => {const v = JSON.parse(String(init.body ?? '{}')); const row = {id: `mem-${Date.now()}`, ...v}; state.memory = [row, ...state.memory]; return json(row, 201);}],
    [/^\/api\/memory\/([^/]+)$/, m => {state.memory = state.memory.filter(x => x.id !== decodeURIComponent(m[1]!)); return empty();}],
    [/^\/api\/contacts$/, (_m, init) => {const v = JSON.parse(String(init.body ?? '{}')); const row = {id: `c-${Date.now()}`, ...v}; state.contact = [row, ...state.contact]; return json(row, 201);}],
    [/^\/api\/contacts\/([^/]+)$/, m => {state.contact = state.contact.filter(x => x.id !== decodeURIComponent(m[1]!)); return empty();}],
    [/^\/api\/agent$/, (_m, init) => {const v = JSON.parse(String(init.body ?? '{}')); state.agent = [{...state.agent[0]!, ...v}]; return json(state.agent[0]);}],
    [/^\/api\/employee-data$/, () => {signedIn = false; state = seed(); return empty();}],
  ];

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0]!;
    for (const [pattern, handler] of routes) {
      const match = path.match(pattern);
      if (match) return handler(match, init);
    }
    return realFetch ? realFetch(input as RequestInfo, init) : new Response('', {status: 404});
  }) as typeof fetch;

  // The event stream stays open and quiet; the app re-reads state after each
  // action, which is what it does against the real gateway too.
  class QuietSource extends EventTarget {
    onopen: (() => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {super(); setTimeout(() => this.onopen?.(), 30);}
    close() {}
  }
  globalThis.EventSource = QuietSource as unknown as typeof EventSource;
}

/**
 * A drawn scene stands in for the phone camera, so the preview, freeze and
 * capture controls can be operated in a page that has no camera permission.
 * It is labelled on screen as a sample rather than presented as a real feed.
 */
export function installSampleCamera() {
  const canvas = document.createElement('canvas');
  canvas.width = 720; canvas.height = 960;
  const ctx = canvas.getContext('2d')!;
  let t = 0;
  const draw = () => {
    t += 1;
    const g = ctx.createLinearGradient(0, 0, 0, 960);
    g.addColorStop(0, '#2b3440'); g.addColorStop(1, '#171c23');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 720, 960);
    ctx.strokeStyle = '#46536a'; ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {ctx.beginPath(); ctx.moveTo(0, 120 + i * 70); ctx.lineTo(720, 90 + i * 70); ctx.stroke();}
    ctx.fillStyle = '#8b6b3a'; ctx.fillRect(150, 380, 420, 150);
    ctx.fillStyle = '#b9c4d4'; ctx.fillRect(190, 300, 40, 300); ctx.fillRect(490, 300, 40, 300);
    ctx.fillStyle = '#6ea8ff'; ctx.beginPath(); ctx.arc(360 + Math.sin(t / 30) * 90, 455, 14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 880, 720, 80);
    ctx.fillStyle = '#e9eef6'; ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillText('Sample scene — not a real camera', 24, 930);
    requestAnimationFrame(draw);
  };
  draw();

  const stream = canvas.captureStream(24);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async (c: MediaStreamConstraints) => (c.video ? stream.clone() : stream.clone()),
      enumerateDevices: async () => [{kind: 'videoinput', deviceId: 'front'}, {kind: 'videoinput', deviceId: 'rear'}, {kind: 'audioinput', deviceId: 'mic'}],
    },
  });
}
