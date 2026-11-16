/** v2 targets are observed browser handles. Legacy locator targets are not accepted. */
export interface ObservedTarget {
  ref: string;
  frameId: string;
  name: string;
  role: string;
}
export interface BrowserObservation {
  version: 2;
  targets: ObservedTarget[];
  partial: boolean;
  content?: { trust: 'untrusted-page-content'; text: string; truncated: boolean };
}
export interface ActionReceipt {
  commandId: string;
  inputDispatched: boolean | 'unknown';
  pageReacted: 'unknown';
  expectedState: 'not_checked';
  mechanism: 'cdp-mouse' | 'cdp-mouse-and-text' | 'cdp-wheel';
}
export interface BrowserPort {
  observe(): Promise<BrowserObservation>;
  click(ref: string, commandId: string): Promise<ActionReceipt>;
  /** Insert into the observed editable node after host approval and pointer focus. */
  type(ref: string, text: string, commandId: string): Promise<ActionReceipt>;
  /** One wheel event at the main viewport center, at most 4000 CSS pixels. */
  scroll(deltaY: number, commandId: string): Promise<ActionReceipt>;
  screenshot(): Promise<string>;
  revoke(): void;
  close(): Promise<void>;
}

/** Validate the private host boundary and strip fields outside the versioned observation DTO. */
export function parseObservation(value: unknown): BrowserObservation {
  const observation = value as Partial<BrowserObservation> | null;
  if (!observation || observation.version !== 2 || typeof observation.partial !== 'boolean' ||
    !Array.isArray(observation.targets) || observation.targets.length > 200) {
    throw new Error('Invalid browser observation v2');
  }
  const targets = observation.targets.map(target => {
    if (!target || !['ref', 'frameId', 'role'].every(key => {
      const field = target[key as keyof ObservedTarget];
      return typeof field === 'string' && field.length > 0 && field.length <= 120;
    }) || typeof target.name !== 'string' || target.name.length > 500) throw new Error('Invalid observed target');
    return { ref: target.ref, frameId: target.frameId, role: target.role, name: target.name };
  });
  let content: BrowserObservation['content'];
  if (observation.content !== undefined) {
    const supplied = observation.content;
    if (!supplied || supplied.trust !== 'untrusted-page-content' || typeof supplied.text !== 'string' ||
      supplied.text.length > 20000 || typeof supplied.truncated !== 'boolean') throw new Error('Invalid untrusted page content');
    content = { trust: 'untrusted-page-content', text: supplied.text, truncated: supplied.truncated };
  }
  return { version: 2, targets, partial: observation.partial, ...(content ? { content } : {}) };
}
