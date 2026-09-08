import { api } from "@/api/client";

export interface HrSyncConfiguration {
  ready: boolean;
  checks: {
    database_configured: boolean;
    storage_mounted: boolean;
    app_key_configured: boolean;
    backup_tool_available: boolean;
  };
  from_date: string;
}

export type HrSyncMode = "preflight" | "apply";
export type HrSyncStatus = "queued" | "running" | "succeeded" | "failed";

export interface HrSyncConflict {
  request_no: string;
  hr_expense_request_id: number;
  hr_title: string;
  acc_expense_request_id: string;
  acc_title: string;
  acc_status: string;
}

export interface HrSyncJob {
  id: string;
  mode: HrSyncMode;
  status: HrSyncStatus;
  preflight_job_id: string | null;
  expected_snapshot_sha256: string | null;
  source_snapshot_sha256: string | null;
  source_from_date: string;
  source_counts: Record<string, number>;
  result_counts: Record<string, number>;
  conflicts: HrSyncConflict[];
  backup_file_name: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  requested_by_username: string;
}

export interface HrBundlePreflight {
  staging_token: string;
  bundle_id: string;
  manifest_sha256: string;
  source_created_at: string;
  expires_at: string;
  counts: Record<string, number>;
}

export interface HrBundleApplyResult {
  status: "succeeded";
  backup_file_name: string;
  bundle_id: string;
  manifest_sha256: string;
  source_created_at: string;
  counts: Record<string, number>;
}

export const hrSyncApi = {
  configuration: () =>
    api.get<HrSyncConfiguration>("/hr-sync/configuration").then((response) => response.data),
  jobs: (limit = 20) =>
    api.get<HrSyncJob[]>("/hr-sync/jobs", { params: { limit } }).then((response) => response.data),
  preflight: () => api.post<{ id: string }>("/hr-sync/preflight").then((response) => response.data),
  apply: (preflightJobId: string) =>
    api.post<{ id: string }>("/hr-sync/apply", { preflight_job_id: preflightJobId })
      .then((response) => response.data),
  bundlePreflight: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return api.post<HrBundlePreflight>("/hr-sync/bundle/preflight", body, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((response) => response.data);
  },
  bundleApply: (stagingToken: string) =>
    api.post<HrBundleApplyResult>("/hr-sync/bundle/apply", { staging_token: stagingToken })
      .then((response) => response.data),
};
