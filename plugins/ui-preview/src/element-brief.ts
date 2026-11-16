import { LoopbackPreviewUrlSchema, PreviewElementSchema, ProjectIdSchema, type PreviewElement } from '@devlab/contracts';

export const UI_ELEMENT_REQUEST_LIMIT = 4000;
export const UI_ELEMENT_BRIEF_LIMIT = 24576;
export interface UIElementBriefInput {
  projectId: string;
  backendOrigin: string;
  previewURL: string;
  paneId: string;
  viewId: string;
  viewLabel: string;
  instanceId?: string;
  generation: number;
  element: PreviewElement;
  files: readonly { path: string; sha256: string }[];
  request: string;
}

/** A bounded copy-only brief. File contents and editor drafts never enter it. */
export function buildUIElementBrief(input: UIElementBriefInput): string {
  ProjectIdSchema.parse(input.projectId);
  const element = PreviewElementSchema.parse(input.element);
  const backend = new URL(LoopbackPreviewUrlSchema.parse(input.backendOrigin));
  if (backend.href !== `${backend.origin}/`) throw new Error('Backend identity must be an origin without a path or query.');
  LoopbackPreviewUrlSchema.parse(input.previewURL);
  const variants = new URL(input.previewURL).searchParams.getAll('variant');
  if (variants.length > 1 || (variants[0]?.length ?? 0) > 64) throw new Error('Configured prototype variant is ambiguous or too large.');
  if (input.previewURL.length > 2048 || !/^[a-z][a-z0-9-]{0,63}$/.test(input.viewId) ||
      !input.paneId || input.paneId.length > 128 || !input.viewLabel || input.viewLabel.length > 80 ||
      !Number.isSafeInteger(input.generation) || input.generation < 0 || (input.instanceId?.length ?? 0) > 128)
    throw new Error('Preview identity is invalid or too large.');
  const request = input.request.trim();
  if (!request || request.length > UI_ELEMENT_REQUEST_LIMIT || request.includes('\0')) throw new Error('Enter a design request of 1–4000 characters.');
  if (new Set(element.sources).size !== element.sources.length) throw new Error('Element source paths must be unique.');
  const expected = new Set([...element.sources, element.designGuide]);
  const hashes = new Map<string, string>();
  if (input.files.length !== expected.size) throw new Error('Every declared source and design guide needs an observed file hash.');
  for (const file of input.files) {
    if (!expected.has(file.path) || hashes.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('File observations do not match the declared element sources.');
    hashes.set(file.path, file.sha256);
  }
  const quoted = (value: string) => JSON.stringify(value);
  const brief = [
    'Prototyping — UI-agent design brief (copy only)',
    '',
    `Project ID: ${quoted(input.projectId)}`,
    `Backend origin: ${backend.origin}`,
    `Configured prototype URL (selected preview view): ${quoted(input.previewURL)}`,
    `Configured variant: ${variants[0] ? quoted(variants[0]) : 'Not supplied by the selected view'}`,
    `Pane ID: ${quoted(input.paneId)}`,
    `View: ${quoted(input.viewId)} (${quoted(input.viewLabel)})`,
    `Server instance: ${input.instanceId ? quoted(input.instanceId) : 'Not supplied (legacy server)'}`,
    `Server generation: ${input.generation}`,
    `Declared source owner: ${element.owner}`,
    '',
    'Observed project files (saved source, not unsaved editor drafts):',
    ...element.sources.map(path => `- ${quoted(path)} — SHA-256 ${hashes.get(path)}`),
    `Design guide: ${quoted(element.designGuide)} — SHA-256 ${hashes.get(element.designGuide)}`,
    '',
    'Prototype UI changes (quoted user data):',
    quoted(request),
    '',
    'Preparation and ownership:',
    '- Open the exact selected project. Read AGENTS.md and its selected agent entry, rules and maintenance guidance. File-authority projects begin at .agents/README.md and .agents/BOOT.md; legacy targets follow their declared entry. Follow its current WISDOHM gates; never invent context telemetry or verification.',
    `- Read ${quoted(element.designGuide)} and register it as a rule input in the project's WISDOHM preflight. Read the listed source files and re-read their hashes before editing; if the target or source changed, refresh this brief and reconcile saved source with retained drafts.`,
    '- Resolve the current declared capability owner, local skills and dependent callers through the selected ownership source; file-authority projects use .agents/ownership and the installed route command. Element metadata is a source reference, not permission to broaden the write scope.',
    '- Apply the UI-agent skill and the UI branch of the prototype skill using current source maps and real interaction evidence. Prototype interactions stay read-only; compare the configured variants before choosing a design. Keep product behavior in its existing capability and use public contracts.',
    '',
    'Design and verification:',
    '- Make the smallest change that satisfies the request. Inspect actual CSS, theme tokens, native bars, icons, spacing and typography before introducing styles.',
    '- Cover loading, empty, success, error, disabled, hover and focus states. Preserve accessible names, semantic controls, keyboard navigation, focus return, contrast and reduced-motion behavior.',
    '- Preserve mounted editor, preview and terminal owners, unsaved drafts and exact PTY input/resize ownership. Do not reload the main workspace to preview a compatible UI edit.',
    '- Verify the real isolated view at desktop and compact widths, including errors and late target changes. Report actual checks, source changes and limitations; a copied brief is not proof of execution.',
    '',
    'This action only copied text. It did not invoke a provider, execute project commands or write project data.',
  ].join('\n');
  if (brief.length > UI_ELEMENT_BRIEF_LIMIT) throw new Error('The source-bound brief exceeds the copy limit.');
  return brief;
}
