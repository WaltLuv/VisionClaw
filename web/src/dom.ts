// Minimal element builder. Everything the employee, a website, an incoming
// message or a worker card produces is untrusted text, so this module has no
// innerHTML path at all -- content is only ever set through textContent. That
// makes injection impossible by construction rather than by remembering to
// escape at each call site.

type Attrs = Record<string, string | number | boolean | undefined | EventListener>;
export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'value' && el instanceof HTMLInputElement) el.value = String(value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

export function clear(node: Element) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function mount(node: Element, ...children: Child[]) {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}
