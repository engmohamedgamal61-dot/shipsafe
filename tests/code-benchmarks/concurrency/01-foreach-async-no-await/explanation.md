# concurrency-01-foreach-async-no-await

`Array.prototype.forEach` invokes its callback for each element and
ignores whatever the callback returns — it has no concept of promises
at all. Passing an `async (id) => { await sendNotification(id); }`
callback means each call starts a notification and its returned promise
is immediately discarded; `forEach` itself returns before any of them
settle. The `console.log("all subscribers notified")` on the next line
therefore always runs first, and if any `sendNotification` call
rejects, nothing in this function ever observes it — it surfaces as an
unhandled promise rejection instead.

The fix (using `for...of` with `await`, or `Promise.all(subscriberIds.map(...))`)
is well-known; this fixture tests recognition of the anti-pattern
itself, which is common enough in real code to be a high-value target
for a Code Reviewer.
