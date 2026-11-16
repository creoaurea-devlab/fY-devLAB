import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { ApplicationError, AgentTrafficSnapshotSchema, ProjectIdSchema, RulesSnapshotSchema, type AgentTrafficSnapshot, type RulesSnapshot } from '@devlab/contracts';

const execute = promisify(execFile);
const reader = fileURLToPath(new URL('./read-memory.py', import.meta.url));

/** Only this installed reader executes. The selected project's runtime and check strings are data. */
async function readSnapshot(root: string, projectId: string, signal?: AbortSignal, activity = false): Promise<unknown> {
  ProjectIdSchema.parse(projectId);
  const python = process.env.DEVLAB_PYTHON ?? (process.platform === 'linux' ? '/usr/bin/python3' : 'python3');
  if (process.env.DEVLAB_PYTHON !== undefined && !isAbsolute(python)) {
    throw new ApplicationError('SERVICE_UNAVAILABLE', 'DEVLAB_PYTHON must name an absolute trusted host Python executable with PyYAML installed.');
  }
  try {
const result = await execute(python, ['-I', '-B', reader, root, projectId, ...(activity ? ['activity'] : [])], {
      timeout: 6000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', signal,
    });
return JSON.parse(result.stdout);
  } catch (error) {
    throw new ApplicationError('SERVICE_UNAVAILABLE', `Rules inspection could not complete safely using ${python} (requires PyYAML; configure DEVLAB_PYTHON for another trusted host interpreter): ` +
      String((error as { stderr?: string }).stderr || (error as Error).message).slice(0, 500));
  }
}
export async function readRulesSnapshot(root: string, projectId: string, signal?: AbortSignal): Promise<RulesSnapshot> {
  return RulesSnapshotSchema.parse(await readSnapshot(root, projectId, signal));
}
export async function readAgentTraffic(root: string, projectId: string, signal?: AbortSignal): Promise<AgentTrafficSnapshot> {
  return AgentTrafficSnapshotSchema.parse(await readSnapshot(root, projectId, signal, true));
}
