# mock-fidelity-01-mock-hides-real-integration-contract

The mock for the Supabase client is built by chaining exactly the
methods (`from().select().in()`) the production code happens to call,
and returning exactly the shape (`pull_request_id`, `status`) the code
destructures. This means the test can never fail due to a real
integration problem — a missing `.order()`/`.limit()` clause in the
real query, a column rename, or a client behavior change would all
still pass, because the mock isn't modeling the real Supabase contract
at all, just echoing back what the code already assumes.

This is the "mocked behavior that hides the real integration contract"
archetype: the mock and the code under test were authored together to
agree with each other, not with reality.
