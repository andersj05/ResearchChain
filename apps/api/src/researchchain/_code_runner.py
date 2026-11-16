"""Private subprocess entry point. Never expose Python callbacks to JavaScript."""

import json
import sys

import quickjs  # type: ignore[import-untyped]


def main() -> None:
    try:
        request = json.loads(sys.stdin.buffer.read(2000000))
        context = quickjs.Context()
        context.set_memory_limit(32 * 1024 * 1024)
        context.set_max_stack_size(256 * 1024)
        context.set_time_limit(request["timeout_seconds"])
        context.set("__source", request["source"])
        context.set("__inputs", json.dumps(request["inputs"], ensure_ascii=True))
        # Keep trusted serialization outside owner scope. An owner function receives
        # only JSON data, with no host functions, modules, network or file objects.
        result = context.eval(
            "(function() { const stringify = JSON.stringify; const parse = JSON.parse; "
            "const execute = new Function('inputs', '\"use strict\";\\n' + __source); "
            "const input = parse(__inputs); delete globalThis.__source; "
            "delete globalThis.__inputs; const output = execute(Object.freeze(input)); "
            "if (!output || typeof output !== 'object' || "
            "typeof output.text !== 'string' || typeof output.number !== 'number' || "
            "!Number.isFinite(output.number) || output.text.length > 24000 || "
            "Object.keys(output).some(key => key !== 'text' && key !== 'number')) "
            "throw new Error('Return {text: string (up to 24,000 characters), "
            "number: finite number}.'); "
            "return stringify({text: output.text, number: output.number}); })()"
        )
        if not isinstance(result, str) or len(result) > 200000:
            raise ValueError("Code output exceeded its serialized size limit.")
        response = {"output": json.loads(result)}
    except Exception as error:
        response = {"error": str(error)[:2000] or "JavaScript memory limit exceeded."}
    sys.stdout.write(json.dumps(response, ensure_ascii=True))


if __name__ == "__main__":
    main()
