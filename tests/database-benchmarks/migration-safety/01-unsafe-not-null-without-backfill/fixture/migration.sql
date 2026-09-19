-- Track which review rule-set version last ran for each repository.

alter table public.repositories
  add column active_rule_version text not null;
