/**
 * Hand-written mirror of `supabase/migrations/0001_init.sql`.
 *
 * When a real Supabase project exists, replace this with generated types
 * (`supabase gen types typescript`) — the shape is kept intentionally
 * close to the generator's output so that swap is a diff, not a rewrite.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          email: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          slug: string;
          created_by: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          created_by: string;
          created_at?: string;
        };
        Update: Partial<{
          id: string;
          name: string;
          slug: string;
          created_by: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      workspace_memberships: {
        Row: {
          workspace_id: string;
          user_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          workspace_id: string;
          user_id: string;
          role: string;
          created_at?: string;
        };
        Update: Partial<{
          workspace_id: string;
          user_id: string;
          role: string;
          created_at: string;
        }>;
        Relationships: [];
      };
      repositories: {
        Row: {
          id: string;
          workspace_id: string;
          provider: string;
          external_repository_id: string | null;
          github_installation_id: string | null;
          name: string;
          full_name: string;
          default_branch: string;
          connected_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          provider: string;
          external_repository_id?: string | null;
          github_installation_id?: string | null;
          name: string;
          full_name: string;
          // Column has `default 'main'` — genuinely optional on insert,
          // not just here for convenience (see upsertRepository in
          // src/server/github/writes.ts, which omits it entirely when
          // the source payload doesn't carry a default_branch).
          default_branch?: string;
          connected_at?: string;
        };
        Update: Partial<{
          id: string;
          workspace_id: string;
          provider: string;
          external_repository_id: string | null;
          github_installation_id: string | null;
          name: string;
          full_name: string;
          default_branch: string;
          connected_at: string;
        }>;
        Relationships: [];
      };
      github_installations: {
        Row: {
          id: string;
          installation_id: string;
          account_login: string;
          account_type: string;
          workspace_id: string | null;
          suspended: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          installation_id: string;
          account_login: string;
          account_type: string;
          workspace_id?: string | null;
          suspended?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          id: string;
          installation_id: string;
          account_login: string;
          account_type: string;
          workspace_id: string | null;
          suspended: boolean;
          created_at: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      github_webhook_deliveries: {
        Row: {
          delivery_id: string;
          event: string;
          received_at: string;
        };
        Insert: {
          delivery_id: string;
          event: string;
          received_at?: string;
        };
        Update: Partial<{
          delivery_id: string;
          event: string;
          received_at: string;
        }>;
        Relationships: [];
      };
      pull_requests: {
        Row: {
          id: string;
          repository_id: string;
          external_pull_request_id: string | null;
          number: number;
          title: string;
          source_branch: string;
          target_branch: string;
          author_login: string;
          changed_files: unknown;
          diff_text: string;
          head_sha: string;
          base_sha: string;
          opened_at: string;
        };
        Insert: {
          id?: string;
          repository_id: string;
          external_pull_request_id?: string | null;
          number: number;
          title: string;
          source_branch: string;
          target_branch: string;
          author_login: string;
          changed_files: unknown;
          diff_text: string;
          head_sha: string;
          base_sha: string;
          opened_at?: string;
        };
        Update: Partial<{
          id: string;
          repository_id: string;
          external_pull_request_id: string | null;
          number: number;
          title: string;
          source_branch: string;
          target_branch: string;
          author_login: string;
          changed_files: unknown;
          diff_text: string;
          head_sha: string;
          base_sha: string;
          opened_at: string;
        }>;
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          pull_request_id: string;
          status: string;
          verdict: string | null;
          summary: string | null;
          failure_reason: string | null;
          reviewed_head_sha: string;
          reviewed_base_sha: string | null;
          rule_version: string;
          prompt_version: string | null;
          started_at: string | null;
          completed_at: string | null;
          diff_truncated: boolean;
          changed_files_truncated: boolean;
          queued_at: string;
        };
        Insert: {
          id?: string;
          pull_request_id: string;
          status: string;
          verdict?: string | null;
          summary?: string | null;
          failure_reason?: string | null;
          reviewed_head_sha: string;
          reviewed_base_sha?: string | null;
          rule_version?: string;
          prompt_version?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          diff_truncated?: boolean;
          changed_files_truncated?: boolean;
          queued_at?: string;
        };
        Update: Partial<{
          id: string;
          pull_request_id: string;
          status: string;
          verdict: string | null;
          summary: string | null;
          failure_reason: string | null;
          reviewed_head_sha: string;
          reviewed_base_sha: string | null;
          rule_version: string;
          prompt_version: string | null;
          started_at: string | null;
          completed_at: string | null;
          diff_truncated: boolean;
          changed_files_truncated: boolean;
          queued_at: string;
        }>;
        Relationships: [];
      };
      reviewer_runs: {
        Row: {
          id: string;
          review_id: string;
          reviewer: string;
          status: string;
          summary: string | null;
          error_message: string | null;
          provider: string | null;
          model: string | null;
          request_id: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          latency_ms: number | null;
          attempt: number;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          review_id: string;
          reviewer: string;
          status: string;
          summary?: string | null;
          error_message?: string | null;
          provider?: string | null;
          model?: string | null;
          request_id?: string | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          latency_ms?: number | null;
          attempt?: number;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: Partial<{
          id: string;
          review_id: string;
          reviewer: string;
          status: string;
          summary: string | null;
          error_message: string | null;
          provider: string | null;
          model: string | null;
          request_id: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          latency_ms: number | null;
          attempt: number;
          started_at: string | null;
          completed_at: string | null;
        }>;
        Relationships: [];
      };
      findings: {
        Row: {
          id: string;
          reviewer_run_id: string;
          severity: string;
          title: string;
          description: string;
          file_path: string | null;
          line_start: number | null;
          line_end: number | null;
          category: string;
          recommendation: string;
          confidence: number;
        };
        Insert: {
          id?: string;
          reviewer_run_id: string;
          severity: string;
          title: string;
          description: string;
          file_path?: string | null;
          line_start?: number | null;
          line_end?: number | null;
          category: string;
          recommendation: string;
          confidence: number;
        };
        Update: Partial<{
          id: string;
          reviewer_run_id: string;
          severity: string;
          title: string;
          description: string;
          file_path: string | null;
          line_start: number | null;
          line_end: number | null;
          category: string;
          recommendation: string;
          confidence: number;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
