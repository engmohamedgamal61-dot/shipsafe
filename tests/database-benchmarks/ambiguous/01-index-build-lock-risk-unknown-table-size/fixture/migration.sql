-- Speeds up lookups of reviews by their verdict for the dashboard filter.

create index if not exists reviews_verdict_idx on public.reviews (verdict);
