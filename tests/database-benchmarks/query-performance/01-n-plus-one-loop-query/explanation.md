# query-performance-01-n-plus-one-loop-query

`attachLatestReviewStatus` issues one `reviews` query per pull request
inside a `for` loop — the query call (`supabase.from("reviews")...`) is
directly, visibly inside the loop body, not something that "might"
happen under unseen conditions. This is precisely the "N+1-style
database access pattern where the diff clearly demonstrates it" archetype
requested for this benchmark: concrete evidence, not a speculative
performance guess.

The batched fix is a single `.in("pull_request_id", ...)` call moved
outside the loop — the fact that a one-line structural change eliminates
the defect is itself part of why this is confidently, not speculatively,
a real finding.
