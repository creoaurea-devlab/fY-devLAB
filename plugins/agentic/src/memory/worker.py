"""One private stdio worker, one immutable host binding; Memory Node owns all SQL."""
import hashlib
import json
import sys

MAXIMUM = 65536


def receive():
    line = sys.stdin.buffer.readline(MAXIMUM + 1)
    if not line:
        return None
    if len(line) > MAXIMUM or not line.endswith(b"\n"):
        raise ValueError("Memory message exceeds 64 KiB")
    value = json.loads(line)
    if not isinstance(value, dict):
        raise ValueError("Memory message must be an object")
    return value


def send(value):
    line = json.dumps(value, ensure_ascii=True, allow_nan=False)
    if len(line.encode()) > MAXIMUM:
        line = json.dumps({"id": value.get("id"), "error": {"code": "result_too_large", "message": "Narrow the memory query"}})
    print(line, flush=True)


def main():
    startup = receive()
    if not startup or startup.get("version") != 1:
        raise ValueError("Memory binding protocol mismatch")
    # Module location is trusted process configuration, never an operation argument.
    sys.path.insert(0, startup["moduleRoot"])
    from memory_node import Access, Memory, MemoryError
    from memory_node.adapters.tools import AgentTools
    binding = startup["binding"]
    required = {"installation", "owner", "project", "profile", "session"}
    if set(binding) != required or any(not isinstance(v, str) or not 1 <= len(v) <= 100 for v in binding.values()):
        raise ValueError("Invalid host memory binding")
    namespace_values = {key: binding[key] for key in sorted(required - {"session"})}
    namespace = "ab:" + hashlib.sha256(json.dumps(namespace_values, sort_keys=True).encode()).hexdigest()
    grants = frozenset({("agent", binding["profile"]), ("session", binding["session"])})
    access = Access(namespace, "session:" + binding["session"], grants, grants)
    memory = Memory(startup["database"])
    tools = AgentTools(memory, access)
    send({"id": "ready", "version": 1, "namespace": namespace})
    while True:
        message = receive()
        if message is None:
            return
        request_id = message.get("id")
        try:
            if set(message) != {"id", "operation", "arguments"} or not isinstance(request_id, str) or len(request_id) > 120:
                raise MemoryError("Invalid operation envelope")
            operation, arguments = message["operation"], message["arguments"]
            if not isinstance(arguments, dict):
                raise MemoryError("Arguments must be an object")
            if any(key in arguments for key in ("access", "binding", "namespace", "actor", "grants", "moduleRoot", "database")):
                raise MemoryError("Host binding cannot be replaced")
            if operation in {"remember", "forget", "compact"} and not arguments.get("request_id"):
                raise MemoryError("Mutations require a stable request_id")
            # Review is deliberately unavailable to an agent's write-only binding.
            result = tools.call(operation, arguments)
            send({"id": request_id, "result": result})
        except MemoryError as error:
            send({"id": request_id, "error": {"code": error.code, "message": str(error)}})
        except Exception:
            send({"id": request_id, "error": {"code": "memory_unavailable", "message": "Memory operation failed; retry the same mutation ID"}})


if __name__ == "__main__":
    try:
        main()
    except Exception:
        send({"id": "ready", "error": {"code": "binding_failed", "message": "Invalid or unavailable host memory configuration"}})
        sys.exit(1)
