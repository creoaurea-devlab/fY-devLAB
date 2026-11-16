import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { ApplicationError, ProjectIdSchema, TerminalCreateSchema, TerminalInputSchema, TerminalSizeSchema, type TerminalService } from '@devlab/contracts';
type TerminalRequest = {
    request: IncomingMessage;
    response: ServerResponse;
    url: URL;
    terminals: TerminalService | undefined;
    streams: Set<() => void>;
    body: (request: IncomingMessage, limit?: number) => Promise<unknown>;
    json: (response: ServerResponse, status: number, value: unknown) => void;
    projectAction: <T>(id: string, action: () => Promise<T>) => Promise<T>;
};
/** The transport owns admission and disposal; this handler owns terminal protocol/streams. */
export async function terminalRequest({ request, response, url, terminals, streams, body, json, projectAction }: TerminalRequest): Promise<void> {
    if (!terminals)
        throw new ApplicationError('SERVICE_UNAVAILABLE', 'Terminal capability is not enabled');
    if (url.pathname === '/api/terminals/ownerships' && request.method === 'GET') {
        json(response, 200, await terminals.ownerships(ProjectIdSchema.parse(url.searchParams.get('projectId'))));
        return;
    }
    if (url.pathname === '/api/terminals/events' && request.method === 'GET') {
        const raw = url.searchParams.get('streams');
        if (!raw || raw.length > 8192)
            throw new ApplicationError('INVALID_INPUT', 'Terminal streams parameter must contain at most 8192 characters');
        let input: unknown;
        try {
            input = JSON.parse(raw);
        }
        catch {
            throw new ApplicationError('INVALID_INPUT', 'Invalid terminal streams JSON');
        }
        const selected = z.array(z.object({
            id: z.string().uuid(), after: z.number().int().nonnegative().safe(),
        }).strict()).min(1).parse(input);
        if (new Set(selected.map(value => value.id)).size !== selected.length)
            throw new ApplicationError('INVALID_INPUT', 'Terminal stream IDs must be unique');
        const entries = selected.map(value => ({ ...value, signature: '', error: '',
            unsubscribe: () => { } }));
        let disposed = false, blocked = false, started = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        let blockTimer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
            if (disposed)
                return;
            disposed = true;
            clearInterval(heartbeat);
            clearTimeout(blockTimer);
            response.removeListener('drain', drain);
            for (const entry of entries)
                entry.unsubscribe();
            streams.delete(cleanup);
            if (!response.writableEnded && !response.destroyed)
                response.end();
        };
        const send = (data: string) => {
            const accepted = response.write(data);
            if (!accepted) {
                blocked = true;
                blockTimer = setTimeout(() => { response.destroy(); cleanup(); }, 5000);
                blockTimer.unref();
                response.once('drain', drain);
            }
            return accepted;
        };
        const pump = () => {
            if (!started || disposed || blocked)
                return;
            try {
                for (const entry of entries) {
                    if (entry.error) {
                        if (entry.signature === 'error')
                            continue;
                        const ready = send(`event: terminal-error\ndata: ${JSON.stringify({ id: entry.id, code: entry.error })}\n\n`);
                        entry.signature = 'error';
                        if (!ready)
                            break;
                        continue;
                    }
                    try {
                        const replay = terminals.read(entry.id, entry.after);
                        const signature = JSON.stringify(replay.session);
                        if (!replay.reset && !replay.chunks.length && entry.signature === signature)
                            continue;
                        const ready = send(`event: terminal\ndata: ${JSON.stringify(replay)}\n\n`);
                        // write(false) still accepted this frame into Node's bounded stream buffer.
                        entry.after = replay.session.cursor;
                        entry.signature = signature;
                        if (!ready)
                            break;
                    }
                    catch (error) {
                        entry.error = error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR';
                        entry.unsubscribe();
                        entry.unsubscribe = () => { };
                        const ready = send(`event: terminal-error\ndata: ${JSON.stringify({ id: entry.id, code: entry.error })}\n\n`);
                        entry.signature = 'error';
                        if (!ready)
                            break;
                    }
                }
            }
            catch {
                response.destroy();
                cleanup();
            }
        };
        function drain() { clearTimeout(blockTimer); blocked = false; pump(); }
        for (const entry of entries) {
            try {
                terminals.inspect(entry.id);
                entry.unsubscribe = terminals.subscribe(entry.id, pump);
            }
            catch (error) {
                entry.error = error instanceof ApplicationError ? error.code : 'INTERNAL_ERROR';
            }
        }
        response.on('close', cleanup);
        streams.add(cleanup);
        if (response.destroyed) {
            cleanup();
            return;
        }
        response.writeHead(200, {
            'content-type': 'text/event-stream', 'cache-control': 'no-store',
            'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff',
        });
        started = true;
        heartbeat = setInterval(() => {
            if (blocked || disposed)
                return;
            try {
                send(': heartbeat\n\n');
            }
            catch {
                response.destroy();
                cleanup();
            }
        }, 15000);
        heartbeat.unref();
        pump();
        return;
    }
    if (url.pathname === '/api/terminals') {
        if (request.method === 'GET') {
            json(response, 200, terminals.list(ProjectIdSchema.parse(url.searchParams.get('projectId'))));
            return;
        }
        if (request.method === 'POST') {
            const input = TerminalCreateSchema.parse(await body(request));
            json(response, 200, await projectAction(input.projectId, () => terminals.create(input)));
            return;
        }
    }
    const terminalMatch = /^\/api\/terminals\/([a-f0-9-]{36})(?:\/(input|resize|close|events))?$/.exec(url.pathname);
    if (terminalMatch) {
        const id = z.string().uuid().parse(terminalMatch[1]);
        if (request.method === 'GET' && !terminalMatch[2]) {
            const after = z.coerce
                .number()
                .int()
                .nonnegative()
                .safe()
                .parse(url.searchParams.get('after') ?? 0);
            json(response, 200, terminals.read(id, after));
            return;
        }
        if (request.method === 'GET' && terminalMatch[2] === 'events') {
            let after = z.coerce
                .number()
                .int()
                .nonnegative()
                .safe()
                .parse(request.headers['last-event-id'] ??
                url.searchParams.get('after') ??
                0);
            terminals.inspect(id);
            let disposed = false, blocked = false;
            let blockTimer: ReturnType<typeof setTimeout> | undefined;
            let timer: ReturnType<typeof setInterval> | undefined;
            let unsubscribe = () => { };
            const cleanup = () => {
                if (disposed)
                    return;
                disposed = true;
                clearInterval(timer);
                clearTimeout(blockTimer);
                unsubscribe();
                streams.delete(cleanup);
                response.end();
            };
            const pump = () => {
                if (disposed || blocked)
                    return;
                try {
                    const replay = terminals.read(id, after);
                    after = replay.session.cursor;
                    if (!response.write(`id: ${after}\nevent: terminal\ndata: ${JSON.stringify(replay)}\n\n`)) {
                        blocked = true;
                        blockTimer = setTimeout(() => {
                            response.destroy();
                            cleanup();
                        }, 5000);
                        response.once('drain', () => {
                            clearTimeout(blockTimer);
                            blocked = false;
                            pump();
                        });
                    }
                }
                catch {
                    response.destroy();
                    cleanup();
                }
            };
            // Subscribe before sending headers so subscription errors stay JSON.
            unsubscribe = terminals.subscribe(id, pump);
            response.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-store',
                'x-accel-buffering': 'no',
                'x-content-type-options': 'nosniff',
            });
            response.on('close', cleanup);
            streams.add(cleanup);
            timer = setInterval(() => {
                if (blocked || disposed)
                    return;
                if (!response.write(': heartbeat\n\n')) {
                    response.destroy();
                    cleanup();
                }
            }, 15000);
            timer.unref();
            pump();
            return;
        }
        if (request.method === 'POST') {
            if (terminalMatch[2] === 'input') {
                terminals.write(id, TerminalInputSchema.parse(await body(request, 400000)).data);
                json(response, 200, terminals.inspect(id));
                return;
            }
            if (terminalMatch[2] === 'resize') {
                terminals.resize(id, TerminalSizeSchema.parse(await body(request)));
                json(response, 200, terminals.inspect(id));
                return;
            }
            if (terminalMatch[2] === 'close') {
                z.object({})
                    .strict()
                    .parse(await body(request));
                json(response, 200, await terminals.close(id));
                return;
            }
        }
    }
    throw new ApplicationError('NOT_FOUND', 'Route not found');
}
