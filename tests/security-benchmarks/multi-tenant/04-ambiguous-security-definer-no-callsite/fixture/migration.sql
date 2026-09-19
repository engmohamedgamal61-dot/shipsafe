-- Recomputes and writes a workspace's cached billing totals.
-- Runs with the privileges of the function owner (bypasses RLS
-- on workspace_billing) so it can update the cache regardless of
-- which role invokes it.
create function sync_workspace_billing(workspace_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update workspace_billing
  set cached_total_cents = (
    select coalesce(sum(amount_cents), 0)
    from invoices
    where invoices.workspace_id = sync_workspace_billing.workspace_id
  )
  where workspace_billing.workspace_id = sync_workspace_billing.workspace_id;
end;
$$;
