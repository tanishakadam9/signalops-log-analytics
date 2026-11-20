export type Insight = { kind: string; severity: string; title: string; details: string; recommendation: string }
export type TimelinePoint = { timestamp: string; total: number; errors: number; warnings: number; failed_logins?: number; avg_response_ms?: number; anomaly?: boolean }
export type Summary = {
  empty?: boolean; upload_id?: number; filename?: string; uploaded_at?: string; total_logs: number; errors: number; warnings: number; critical: number; services: number; anomaly_windows: number; model_status: string;
  severity_counts: Record<string, number>; service_counts: Record<string, number>; timeline: TimelinePoint[]; insights: Insight[];
}
export type LogRow = { id: number; timestamp: string; level: string; service: string; message: string; response_ms?: number | null; status_code?: number | null; failed_login?: number | null }
export type UploadItem = { id: number; filename: string; created_at: string; rows_processed: number; errors: number; warnings: number; anomaly_windows: number; status: string }
