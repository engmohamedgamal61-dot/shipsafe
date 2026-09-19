# ambiguous-01-message-text-changed-tests-not-shown

Only the production function is shown, with an error-message wording
change. Whether this needs a test update depends entirely on whether an
existing test (not shown in this diff) asserts the exact old message
string — genuinely unconfirmable from what's given. This directly tests
the explicit principle: "claim missing coverage when the relevant tests
may exist outside the diff... unless the change clearly requires new
coverage." Contrast with `missing-tests-01`, where the ENTIRE diff is
the untested function — no such ambiguity exists there.
