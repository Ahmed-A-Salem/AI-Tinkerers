/** Jira REST v3 takes ADF, not markdown, everywhere a rich-text field appears. */
export interface Adf {
  type: 'doc';
  version: 1;
  content: unknown[];
}

export function toAdf(text: string): Adf {
  const paras = (text || '_empty_')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content: paras.map((p) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: p.slice(0, 3000) }],
    })),
  };
}

/** Flatten ADF back to text so the LLM sees prose, not a node tree. */
export function fromAdf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text') return n.text ?? '';
  const inner = (n.content ?? []).map(fromAdf).join('');
  return n.type === 'paragraph' || n.type === 'heading' ? inner + '\n\n' : inner;
}
