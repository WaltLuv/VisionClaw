import {liveFrameSources} from "./employee/browser.js";
/** The phone app's page policy. No inline script; the only thing it may frame is a live view of the employee's browser. */
export const appContentSecurityPolicy = (): string =>
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' wss:; frame-src ${liveFrameSources()}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`;
