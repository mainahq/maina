# mitt — Tiny Event Emitter

## Requirements

Implement a tiny functional event emitter with the following API:

### Types

- `EventType` = `string | symbol`
- `Handler<T>` = `(event: T) => void`
- `WildcardHandler<T>` = `(type: string | symbol, event: T) => void`
- `Emitter<Events>` — the returned object with `all`, `on`, `off`, `emit`

### Factory Function

`mitt<Events>(all?: Map): Emitter<Events>`

- Creates a new emitter instance
- Optionally accepts an existing `Map` of event handlers to pre-populate
- Returns an `Emitter` object

### Emitter.all

- Exposes the internal handler `Map`
- Allows external read/write access (e.g., `.all.clear()`)

### Emitter.on(type, handler)

- Registers a handler for the given event type
- Wildcard type `'*'` registers a handler that fires on every event
- Handlers are appended in registration order (FIFO)
- Duplicate registrations of the same handler reference are allowed
- Case-sensitive: `'FOO'` and `'foo'` are different types
- Works with `Symbol` event types
- Works with reserved property names like `'constructor'`

### Emitter.off(type, handler?)

- If handler is provided: removes the first matching instance from the handler array
- If handler is omitted: removes ALL handlers for that type (sets to empty array)
- Silently does nothing if the type has no registered handlers
- Case-sensitive
- When a handler is registered multiple times, `off()` removes only one instance

### Emitter.emit(type, event?)

- Invokes all handlers registered for the given type, in registration order
- After type-specific handlers, invokes all wildcard `'*'` handlers with `(type, event)` signature
- The handler array is copied before iteration, so handlers can safely unregister during emit
- Event parameter is optional (passes `undefined` if omitted)

## Constraints

- No dependencies
- Should be under 200 lines
- Must work with TypeScript strict mode
- Must handle edge cases: empty handler lists, symbol types, reserved property names
