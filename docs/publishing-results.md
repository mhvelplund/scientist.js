# Publishing results

[Back to the documentation index](index.md)

What good is science if you can't publish your results?

You must implement `publish(result)` in your experiment class, and can publish data however you like. For example,
timing data can be sent to a metrics service, and mismatches can be stored in a capped list in Redis for debugging
later.

## The `Result`

`publish` receives an immutable `Result<T>`:

| Member                   | Description                                                      |
|--------------------------|------------------------------------------------------------------|
| `experiment`             | The experiment that ran                                          |
| `experimentName`         | The experiment's name                                            |
| `context`                | The experiment's context (see [Adding context](context.md))      |
| `observations`           | Every `Observation`, **in execution order**                      |
| `control`                | The observation of the requested behavior (normally `"control"`) |
| `candidates`             | Every other observation, in execution order                      |
| `mismatchedObservations` | Candidates that didn't match the control and weren't ignored     |
| `ignoredObservations`    | Candidates that didn't match but were ignored                    |
| `matched()`              | No mismatches and nothing ignored                                |
| `mismatched()`           | At least one unignored mismatch                                  |
| `ignored()`              | At least one ignored mismatch                                    |

## The `Observation`

Each behavior's run is recorded in an immutable `Observation<T>`:

| Member                                               | Description                                                                        |
|------------------------------------------------------|------------------------------------------------------------------------------------|
| `name`                                               | The behavior's name (`"control"`, `"candidate"` or the name given to `try`)        |
| `experiment`                                         | The experiment                                                                     |
| `value`                                              | The returned value (the resolved value in `runAsync`), if it didn't throw          |
| `raised`                                             | `true` if the behavior threw (or its promise rejected)                             |
| `exception`                                          | The thrown value or rejection reason, if `raised`                                  |
| `cleanedValue`                                       | `value` passed through the [cleaner](cleaning-values.md)                           |
| `duration`                                           | Wall-clock time, in seconds                                                        |
| `cpuTime`                                            | Process CPU time (user + system), in seconds; `0` where unavailable, e.g. browsers |
| `equivalentTo(other, comparator?, errorComparator?)` | Compare to another observation                                                     |

## An example publisher

```ts
import { Experiment, type Observation, type Result } from "@mhvelplund/scientist";

class MyExperiment<T = unknown> extends Experiment<T> {
  enabled(): boolean {
    return true;
  }

  publish(result: Result<T>): void {
    const control = result.control;
    // only the first candidate, see "Multiple candidates"
    const candidate = result.candidates[0];

    // Wall time
    statsd.timing(`science.${this.name}.control`, control?.duration);
    statsd.timing(`science.${this.name}.candidate`, candidate?.duration);

    // CPU time
    statsd.timing(`science.cpu.${this.name}.control`, control?.cpuTime);
    statsd.timing(`science.cpu.${this.name}.candidate`, candidate?.cpuTime);

    // and counts for match/ignore/mismatch:
    if (result.matched()) {
      statsd.increment(`science.${this.name}.matched`);
    } else if (result.ignored()) {
      statsd.increment(`science.${this.name}.ignored`);
    } else {
      statsd.increment(`science.${this.name}.mismatched`);
      // Finally, store mismatches so they can be retrieved and examined
      // later on, for debugging and research.
      this.storeMismatchData(result);
    }
  }

  private storeMismatchData(result: Result<T>): void {
    const payload = {
      name: this.name,
      context: this.context(),
      control: observationPayload(result.control),
      candidate: observationPayload(result.candidates[0]),
      executionOrder: result.observations.map((o) => o.name),
    };

    const key = `science.${this.name}.mismatch`;
    redis.lpush(key, JSON.stringify(payload));
    redis.ltrim(key, 0, 1000);
  }
}

function observationPayload<T>(observation: Observation<T> | undefined) {
  if (!observation) return undefined;
  if (observation.raised) {
    const error = observation.exception as Error;
    return { exception: error.name, message: error.message, stack: error.stack };
  }
  // see "Cleaning values"
  return { value: observation.cleanedValue };
}
```

A published payload might look like this:

```json
{
  "name": "widget-permissions",
  "context": { "user": 42 },
  "control": { "value": true },
  "candidate": { "value": false },
  "executionOrder": ["candidate", "control"]
}
```

with the control taking, say, `duration: 0.0123` and `cpuTime: 0.0118` seconds.

## Notes

- `publish` is called after `afterRun`, and before any `MismatchError` is thrown (see [Testing](testing.md)).
- If `publish` throws, the error goes to `raised("publish", error)`.
- `publish` may be `async`. `runAsync` awaits it. A synchronous `run` can't wait for it: it fires and forgets, and a
  rejection is still routed to `raised("publish", error)`.
- CPU time is process-wide. In `runAsync`, other work interleaved on the event loop while a behavior awaits is counted
  too, so treat it as an approximation.
