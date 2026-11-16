# Owner-authored code steps

Select **Add custom code** and write a synchronous JavaScript function body in
**Code**. Choose its text and number inputs from the brief or an earlier step.
Return `{ text: "your result", number: 0 }`. The text can feed a note or model;
the number can drive a condition or become another code step's numeric input.

```javascript
const values = JSON.parse(inputs.text);
const average = values.reduce((sum, value) => sum + value, 0) / values.length;
return { text: `Average: ${average.toFixed(2)}`, number: average };
```

This is a mechanical example, not an agent strategy or research judgment. Supply
your own logic, validation and interpretation. JavaScript floating-point numbers
are not exact decimal arithmetic.

Inputs are `text` (empty if unbound), `number` (zero if unbound), `brief`,
`artifact_count` and `iteration`. An output must be available on every incoming
path before it can be connected. Outputs must have exactly a string `text` (up to
24,000 characters) and finite numeric `number`. Use JSON inside text for structured
data. No automatic model call or evidence fetch occurs.

**Run workflow** saves the code in an immutable revision before execution. In Runs,
expand **Code inputs and outputs** to inspect the actual inputs, both outputs,
execution duration, engine version and source hash. The normal run history pins
the code; editing it only affects a later run. Confirmed code results survive
checkpoints and are not re-executed when resuming a human review. If a worker dies
before checkpointing, the pure transformation may replay during explicit recovery.

The runtime is QuickJS-NG 0.18.0.1 in a disposable Python child process. It receives
JSON only and exposes no Python callbacks, environment variables, filesystem,
network, Node.js modules or package loader. Standard JavaScript Math/JSON/string/
array operations are available; asynchronous work is not supported. Each step has
a configurable 0.05–5 second CPU limit, 32 MB heap and 256 KB stack. An additional
wall-clock deadline kills a stuck child. Workflow execution/time limits still apply;
code steps consume node executions, not model requests. No process or global JS
state is shared between steps.

Syntax, return-type, thrown-error, memory and timeout failures stop the run with an
actionable reason. Edit the code and start a new run; the failed experiment remains
inspectable. These controls support local owner-written transformations. Python,
third-party packages, file access and arbitrary external tools require separate
integrations and are not hidden features of this editor.

`pnpm bootstrap` installs the locked runtime on Windows and Linux. Maintainer
references: [package and resource-limit API](https://pypi.org/project/quickjs-ng/)
and [source repository](https://github.com/genotrance/quickjs-ng). Runtime upgrades
must deliberately update the pinned contract and recovery compatibility.

Verified with real local JavaScript execution and synthetic workflows: host-object
absence, Unicode/JSON inputs, typed wiring, syntax/thrown errors, infinite loops,
recursion, memory/output limits, invalid results, durable failure reasons and review
resume without re-execution. Desktop/mobile browser cases author code, inspect a
saved output, then change the code and confirm the original run is unchanged.
