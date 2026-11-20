import type { Summary, LogRow, UploadItem } from './types'
const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '')
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init)
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try { const body = await res.json(); message = body.detail || message } catch {}
    throw new Error(message)
  }
  return res.json()
}
export const fetchSummary = (uploadId?: number) => request<Summary>(`/api/summary${uploadId ? `?upload_id=${uploadId}` : ''}`)
export const fetchUploads = () => request<{uploads: UploadItem[]}>('/api/uploads')
export const fetchLogs = (filters: {uploadId?: number; level?: string; service?: string; search?: string; offset?: number} = {}) => {
  const q = new URLSearchParams()
  if (filters.uploadId) q.set('upload_id', String(filters.uploadId))
  if (filters.level) q.set('level', filters.level)
  if (filters.service) q.set('service', filters.service)
  if (filters.search) q.set('search', filters.search)
  if (filters.offset) q.set('offset', String(filters.offset))
  return request<{logs: LogRow[]; total: number}>(`/api/logs?${q}`)
}
export const uploadLogs = (file: File) => {
  const data = new FormData(); data.append('file', file)
  return request<Summary & {parse_warnings?: string[]; parse_warning_count?: number; storage_uri?: string | null}>('/api/analyze', {method:'POST', body:data})
}
export const generateDemo = () => request<Summary & {upload_id:number}>('/api/demo', {method:'POST'})
export const checkHealth = () => request<{status:string}>('/health')
