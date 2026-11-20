import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, BrainCircuit,
  CheckCircle2, ChevronDown, CircleHelp, Cloud, Database, FileText, Filter, Gauge, LayoutDashboard,
  LoaderCircle, Menu, RefreshCw, Search, Server, ShieldAlert, ShieldCheck, Sparkles, UploadCloud,
  X, Zap
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  BarChart, Bar
} from 'recharts'
import { checkHealth, fetchLogs, fetchSummary, fetchUploads, generateDemo, uploadLogs } from './api'
import type { LogRow, Summary, UploadItem } from './types'

type Page = 'overview' | 'logs' | 'insights' | 'history'
const COLORS: Record<string,string> = { INFO:'#6d9eff', DEBUG:'#8994aa', WARNING:'#f5b84b', WARN:'#f5b84b', ERROR:'#ff657a', CRITICAL:'#d946ef', OTHER:'#73809a', NOTICE:'#46d7c1', TRACE:'#73809a' }
const fmt = (n:number) => new Intl.NumberFormat('en-US').format(n || 0)
const dateTime = (s:string) => { try { return new Date(s).toLocaleString([], {month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'}) } catch { return s } }
const shortTime = (s:string) => { try { return new Date(s).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) } catch { return s } }

export default function App() {
  const [page,setPage] = useState<Page>('overview')
  const [summary,setSummary] = useState<Summary | null>(null)
  const [uploads,setUploads] = useState<UploadItem[]>([])
  const [logs,setLogs] = useState<LogRow[]>([])
  const [logTotal,setLogTotal] = useState(0)
  const [selectedUpload,setSelectedUpload] = useState<number | undefined>()
  const [level,setLevel] = useState('')
  const [service,setService] = useState('')
  const [search,setSearch] = useState('')
  const [file,setFile] = useState<File | null>(null)
  const [busy,setBusy] = useState(false)
  const [loading,setLoading] = useState(true)
  const [apiHealthy,setApiHealthy] = useState(false)
  const [notice,setNotice] = useState<{kind:'success'|'error';text:string}|null>(null)
  const [mobileNav,setMobileNav] = useState(false)

  const refresh = useCallback(async (uploadId?:number) => {
    setLoading(true)
    try {
      const [s,u,h] = await Promise.all([fetchSummary(uploadId),fetchUploads(),checkHealth()])
      setSummary(s.empty ? null : s); setUploads(u.uploads); setApiHealthy(h.status === 'healthy')
      const id = uploadId ?? s.upload_id
      if (id) setSelectedUpload(id)
    } catch (e) { setApiHealthy(false); setNotice({kind:'error',text:e instanceof Error ? e.message : 'Could not connect to API'}) }
    finally { setLoading(false) }
  }, [])
  const refreshLogs = useCallback(async () => {
    try {
      const result = await fetchLogs({uploadId:selectedUpload,level:level || undefined,service:service || undefined,search:search || undefined})
      setLogs(result.logs); setLogTotal(result.total)
    } catch (e) { setNotice({kind:'error',text:e instanceof Error ? e.message : 'Could not load logs'}) }
  }, [selectedUpload,level,service,search])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { if (summary) void refreshLogs() }, [summary,refreshLogs])

  const runUpload = async () => {
    if (!file) { setNotice({kind:'error',text:'Choose a .csv, .log or .txt file first.'}); return }
    setBusy(true); setNotice(null)
    try {
      const result = await uploadLogs(file)
      setSelectedUpload(result.upload_id); setSummary(result); setPage('overview')
      setNotice({kind:'success',text:`Processed ${fmt(result.total_logs)} log records. ${result.parse_warning_count || 0} parser warning(s).`})
      setFile(null); await refresh(result.upload_id)
    } catch(e) { setNotice({kind:'error',text:e instanceof Error ? e.message : 'Upload failed'}) }
    finally { setBusy(false) }
  }
  const runDemo = async () => {
    setBusy(true); setNotice(null)
    try {
      const result = await generateDemo()
      setSelectedUpload(result.upload_id); setSummary(result); setPage('overview')
      setNotice({kind:'success',text:`Demo incident generated and analyzed (${fmt(result.total_logs)} records).`})
      await refresh(result.upload_id)
    } catch(e) { setNotice({kind:'error',text:e instanceof Error ? e.message : 'Demo generation failed'}) }
    finally { setBusy(false) }
  }
  const chooseUpload = async (id:number) => { setSelectedUpload(id); await refresh(id); setPage('overview') }
  const navItems = [
    {id:'overview' as Page,label:'Overview',icon:LayoutDashboard},
    {id:'logs' as Page,label:'Log explorer',icon:FileText},
    {id:'insights' as Page,label:'AI insights',icon:BrainCircuit},
    {id:'history' as Page,label:'Upload history',icon:Database},
  ]
  const timeline = useMemo(() => (summary?.timeline || []).map(p => ({...p, time:shortTime(p.timestamp)})), [summary])
  const pieData = useMemo(() => Object.entries(summary?.severity_counts || {}).map(([name,value])=>({name,value})), [summary])
  const barData = useMemo(() => Object.entries(summary?.service_counts || {}).slice(0,8).map(([service,count])=>({service:service.length>14?service.slice(0,14)+'…':service,count})), [summary])
  const isEmpty = !summary || summary.total_logs === 0

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={21}/></div><div><div className="brand-name">signal<span>ops</span></div><div className="brand-caption">LOG INTELLIGENCE</div></div><button className="icon-button nav-close" onClick={()=>setMobileNav(false)} aria-label="Close navigation"><X size={18}/></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <button className="workspace-switch"><div className="workspace-avatar">S</div><div className="workspace-copy"><strong>System observability</strong><span>Personal workspace</span></div><ChevronDown size={15}/></button>
      <div className="nav-label">MONITORING</div>
      <nav className="nav-list">{navItems.map(item=><button key={item.id} className={`nav-item ${page===item.id?'active':''}`} onClick={()=>{setPage(item.id);setMobileNav(false)}}><item.icon size={18}/><span>{item.label}</span>{item.id==='insights'&&summary?.anomaly_windows ? <span className="nav-count">{summary.anomaly_windows}</span>:null}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="cloud-card"><div className="cloud-card-icon"><Cloud size={17}/></div><div><strong>Cloud pipeline</strong><span><i className={apiHealthy?'status-dot':'status-dot offline'}/>{apiHealthy?'API connected':'API unavailable'}</span></div><button onClick={()=>void refresh(selectedUpload)} className="mini-icon" title="Refresh connection"><RefreshCw size={14}/></button></div>
        <div className="sidebar-footer"><div className="user-avatar">SO</div><div className="user-meta"><strong>SignalOps Admin</strong><span>Observability team</span></div><CircleHelp size={17}/></div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-scrim" onClick={()=>setMobileNav(false)} aria-label="Close menu"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={20}/></button><div className="breadcrumb">Workspace <span>/</span> <strong>{navItems.find(n=>n.id===page)?.label}</strong></div></div><div className="topbar-actions"><div className="live-pill"><i className={apiHealthy?'status-dot':'status-dot offline'}/>{apiHealthy?'API operational':'API offline'}</div><button className="icon-button notification" title="Notifications"><Bell size={18}/><i/></button><div className="top-avatar">SO</div></div></header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> OBSERVABILITY CENTER</div><h1>{page==='overview'?'Log intelligence overview':page==='logs'?'Log explorer':page==='insights'?'AI insights':'Upload history'}</h1><p>{page==='overview'?'A real-time view of application health, log activity, and detected anomalies.':page==='logs'?'Search, filter, and investigate parsed application events.':page==='insights'?'Machine-learning signals and actionable investigation guidance.':'Review previous datasets and revisit analysis results.'}</p></div><div className="heading-actions"><button className="button button-secondary" onClick={()=>void refresh(selectedUpload)} disabled={loading}><RefreshCw size={15} className={loading?'spin':''}/> Refresh</button><button className="button button-primary" onClick={runDemo} disabled={busy}><Sparkles size={16}/>{busy?'Working…':'Generate demo logs'}</button></div></div>
        {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind==='success'?<CheckCircle2 size={17}/>:<AlertTriangle size={17}/>}</span><div>{notice.text}</div><button className="mini-icon" onClick={()=>setNotice(null)} aria-label="Dismiss"><X size={15}/></button></div>}
        <section className="ingest-panel">
          <div className="ingest-icon"><UploadCloud size={21}/></div><div className="ingest-copy"><strong>Ingest log data</strong><span>Upload a CSV or plain-text log file to run parsing, anomaly detection and AI insights.</span></div>
          <label className="file-picker"><input type="file" accept=".csv,.log,.txt" onChange={e=>setFile(e.target.files?.[0]||null)}/><FileText size={15}/><span>{file?file.name:'Choose log file'}</span></label>
          <button className="button button-primary upload-button" onClick={runUpload} disabled={busy||!file}><UploadCloud size={15}/>{busy?'Analyzing…':'Upload & analyze'}</button>
        </section>
        {page==='overview' && <Overview summary={summary} timeline={timeline} pieData={pieData} barData={barData} loading={loading} onOpenInsights={()=>setPage('insights')} onOpenLogs={()=>setPage('logs')}/>}
        {page==='logs' && <section className="panel log-panel"><div className="panel-heading"><div><h2>Event stream</h2><p>{fmt(logTotal)} matching records · latest upload</p></div><span className="panel-tag"><span className="status-dot"/> PARSED EVENTS</span></div><div className="filter-row"><div className="search-box"><Search size={16}/><input placeholder="Search messages…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button onClick={()=>setSearch('')}><X size={14}/></button>}</div><div className="select-wrap"><Filter size={14}/><select value={level} onChange={e=>setLevel(e.target.value)}><option value="">All severities</option>{['CRITICAL','ERROR','WARNING','INFO','DEBUG','OTHER'].map(x=><option key={x}>{x}</option>)}</select></div><div className="search-box service-filter"><Server size={15}/><input placeholder="Filter service…" value={service} onChange={e=>setService(e.target.value)}/></div><button className="button button-secondary compact" onClick={()=>{setLevel('');setService('');setSearch('')}}>Clear</button></div><LogTable logs={logs}/></section>}
        {page==='insights' && <InsightsPage summary={summary} onOpenLogs={()=>setPage('logs')}/>}
        {page==='history' && <section className="panel history-panel"><div className="panel-heading"><div><h2>Recent uploads</h2><p>Choose a dataset to view its stored analysis.</p></div><span className="panel-tag">{uploads.length} DATASETS</span></div>{uploads.length===0?<EmptyState title="No uploads yet" text="Upload a log file or generate demo data to begin."/>:<div className="history-list">{uploads.map(u=><button className={`history-row ${selectedUpload===u.id?'selected':''}`} key={u.id} onClick={()=>void chooseUpload(u.id)}><div className="history-file"><div className="history-file-icon"><FileText size={18}/></div><div><strong>{u.filename}</strong><span>{dateTime(u.created_at)} · ID #{u.id}</span></div></div><div className="history-metric"><strong>{fmt(u.rows_processed)}</strong><span>LOGS</span></div><div className="history-metric errors"><strong>{fmt(u.errors)}</strong><span>ERRORS</span></div><div className="history-metric anomalies"><strong>{fmt(u.anomaly_windows)}</strong><span>ANOMALIES</span></div><span className="history-open">View analysis ↗</span></button>)}</div>}</section>}
        <footer className="page-footer"><span>SignalOps <b>v2.0</b> · Log intelligence platform</span><span><i className={apiHealthy?'status-dot':'status-dot offline'}/>{apiHealthy?'Backend connected':'Backend connection issue'} <span className="footer-divider">·</span> ML engine: Isolation Forest</span></footer>
      </div>
    </main>
  </div>
}

function Overview({summary,timeline,pieData,barData,loading,onOpenInsights,onOpenLogs}:{summary:Summary|null;timeline:any[];pieData:any[];barData:any[];loading:boolean;onOpenInsights:()=>void;onOpenLogs:()=>void}) {
  if (!summary || summary.empty) return <div className="empty-dashboard"><div className="empty-art"><Activity size={36}/><span/><span/><span/></div><h2>Your observability workspace is ready</h2><p>Generate a simulated incident or upload your own log data to populate analytics and AI insights.</p><div className="empty-actions"><button className="button button-primary" onClick={onOpenLogs}>Open log explorer <ArrowUpRight size={15}/></button></div></div>
  const cards = [
    {label:'Total log events',value:summary.total_logs,icon:Activity,tone:'blue',meta:'Validated records',delta:'INGESTION'},
    {label:'Error events',value:summary.errors,icon:AlertOctagon,tone:'red',meta:'ERROR + CRITICAL',delta:summary.errors?'NEEDS REVIEW':'HEALTHY'},
    {label:'Warnings',value:summary.warnings,icon:AlertTriangle,tone:'amber',meta:'Potential degradation',delta:'SIGNALS'},
    {label:'Anomaly windows',value:summary.anomaly_windows,icon:BrainCircuit,tone:'purple',meta:'Isolation Forest',delta:summary.model_status==='trained'?'MODEL ACTIVE':'DATA CHECK'},
  ]
  return <div className="dashboard-body">
    <div className="section-kicker"><span>KEY PERFORMANCE INDICATORS</span><span className="muted-label">CURRENT DATASET · #{summary.upload_id}</span></div>
    <div className="kpi-grid">{cards.map((c,i)=><div className="kpi-card" key={c.label}><div className="kpi-top"><span>{c.label}</span><div className={`kpi-icon ${c.tone}`}><c.icon size={18}/></div></div><div className="kpi-value">{fmt(c.value)}</div><div className="kpi-bottom"><span>{c.meta}</span><span className={`kpi-status ${c.tone}`}>{c.delta}</span></div><div className={`kpi-accent ${c.tone}`}/></div>)}</div>
    <div className="chart-grid"><section className="panel timeline-panel"><div className="panel-heading"><div><h2>Log activity</h2><p>Event volume and error spikes over time</p></div><span className="panel-tag"><i className="status-dot"/> TIME SERIES</span></div><div className="chart-legend"><span><i className="legend-dot total"/>Total logs</span><span><i className="legend-dot errors"/>Errors</span><span><i className="legend-dot warnings"/>Warnings</span></div><div className="chart-area">{timeline.length?<ResponsiveContainer width="100%" height="100%"><AreaChart data={timeline} margin={{top:12,right:8,left:-18,bottom:0}}><defs><linearGradient id="totalFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6d9eff" stopOpacity={0.25}/><stop offset="100%" stopColor="#6d9eff" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#242c40" strokeDasharray="4 5" vertical={false}/><XAxis dataKey="time" tick={{fill:'#77839c',fontSize:10}} axisLine={false} tickLine={false} minTickGap={28}/><YAxis tick={{fill:'#77839c',fontSize:10}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#11182a',border:'1px solid #29334b',borderRadius:10,color:'#edf2ff',fontSize:12}}/><Area type="monotone" dataKey="total" name="Total logs" stroke="#6d9eff" strokeWidth={2} fill="url(#totalFill)"/><Area type="monotone" dataKey="errors" name="Errors" stroke="#ff657a" strokeWidth={2} fill="transparent"/><Area type="monotone" dataKey="warnings" name="Warnings" stroke="#f5b84b" strokeWidth={1.5} fill="transparent"/></AreaChart></ResponsiveContainer>:<ChartEmpty/>}</div></section>
    <section className="panel severity-panel"><div className="panel-heading"><div><h2>Severity distribution</h2><p>Breakdown of parsed events</p></div><div className="panel-heading-icon"><Gauge size={17}/></div></div><div className="donut-wrap">{pieData.length?<ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="88%" paddingAngle={3} stroke="none">{pieData.map(d=><Cell key={d.name} fill={COLORS[d.name]||COLORS.OTHER}/>)}</Pie><Tooltip contentStyle={{background:'#11182a',border:'1px solid #29334b',borderRadius:10,color:'#edf2ff',fontSize:12}}/></PieChart></ResponsiveContainer>:<ChartEmpty/>}<div className="donut-center"><strong>{fmt(summary.total_logs)}</strong><span>EVENTS</span></div></div><div className="severity-legend">{pieData.slice(0,5).map(d=><div key={d.name}><span><i style={{background:COLORS[d.name]||COLORS.OTHER}}/>{d.name}</span><strong>{fmt(d.value)}</strong><small>{summary.total_logs?Math.round(d.value/summary.total_logs*100):0}%</small></div>)}</div></section></div>
    <div className="lower-grid"><section className="panel service-panel"><div className="panel-heading"><div><h2>Top services by log volume</h2><p>Services generating the most events</p></div><button className="text-action" onClick={onOpenLogs}>View logs <ArrowUpRight size={14}/></button></div><div className="service-chart">{barData.length?<ResponsiveContainer width="100%" height="100%"><BarChart data={barData} layout="vertical" margin={{top:2,right:20,left:5,bottom:0}}><CartesianGrid stroke="#242c40" strokeDasharray="4 5" horizontal={false}/><XAxis type="number" tick={{fill:'#77839c',fontSize:10}} axisLine={false} tickLine={false}/><YAxis type="category" dataKey="service" width={105} tick={{fill:'#a9b4ca',fontSize:11}} axisLine={false} tickLine={false}/><Tooltip contentStyle={{background:'#11182a',border:'1px solid #29334b',borderRadius:10,color:'#edf2ff',fontSize:12}}/><Bar dataKey="count" name="Log events" fill="#7c8dff" radius={[0,5,5,0]} barSize={15}/></BarChart></ResponsiveContainer>:<ChartEmpty/>}</div></section>
    <section className="panel insight-preview"><div className="panel-heading"><div><h2><Sparkles size={16}/> AI findings</h2><p>Patterns worth investigating</p></div><button className="text-action" onClick={onOpenInsights}>All insights <ArrowUpRight size={14}/></button></div>{summary.insights.slice(0,3).length?summary.insights.slice(0,3).map((ins,i)=><div className="mini-insight" key={i}><div className={`insight-indicator ${ins.severity}`}><BrainCircuit size={15}/></div><div className="mini-insight-copy"><strong>{ins.title}</strong><p>{ins.details}</p></div><span className={`severity-pill ${ins.severity}`}>{ins.severity}</span></div>):<EmptyState title="No findings" text="No insight records were returned for this dataset."/>}</section></div>
    <section className="panel pipeline-panel"><div className="panel-heading"><div><h2>Cloud ingestion pipeline</h2><p>Processing stages for the selected dataset</p></div><span className="panel-tag">PIPELINE STATUS</span></div><div className="pipeline-steps"><PipelineStep icon={<UploadCloud size={17}/>} title="Ingestion" detail="File received" status="complete"/><span className="pipeline-connector"/><PipelineStep icon={<FileText size={17}/>} title="Normalization" detail={`${fmt(summary.total_logs)} records parsed`} status="complete"/><span className="pipeline-connector"/><PipelineStep icon={<BrainCircuit size={17}/>} title="ML analysis" detail={summary.model_status==='trained'?'Isolation Forest run':'More data may be needed'} status={summary.model_status==='trained'?'complete':'warning'}/><span className="pipeline-connector"/><PipelineStep icon={<Database size={17}/>} title="Persistence" detail="Results stored" status="complete"/></div></section>
  </div>
}
function PipelineStep({icon,title,detail,status}:{icon:React.ReactNode;title:string;detail:string;status:string}) {return <div className="pipeline-step"><div className={`pipeline-icon ${status}`}>{icon}</div><div><strong>{title}</strong><span>{detail}</span></div><CheckCircle2 size={15} className={status==='complete'?'pipeline-check':'pipeline-warn'}/></div>}
function LogTable({logs}:{logs:LogRow[]}) {
  if(!logs.length) return <EmptyState title="No matching events" text="Upload a dataset or adjust the filters to view log records."/>
  return <div className="table-scroll"><table className="log-table"><thead><tr><th>TIMESTAMP</th><th>SEVERITY</th><th>SERVICE</th><th>MESSAGE</th><th>HTTP</th><th>LATENCY</th></tr></thead><tbody>{logs.map(log=><tr key={log.id}><td className="timestamp-cell">{dateTime(log.timestamp)}</td><td><span className={`level-tag ${log.level.toLowerCase()}`}><i/>{log.level}</span></td><td><span className="service-name">{log.service}</span></td><td className="message-cell" title={log.message}>{log.message}</td><td className="code-cell">{log.status_code??'—'}</td><td className="latency-cell">{log.response_ms!=null?`${Math.round(log.response_ms)} ms`:'—'}</td></tr>)}</tbody></table></div>
}
function InsightsPage({summary,onOpenLogs}:{summary:Summary|null;onOpenLogs:()=>void}) {
  if(!summary || !summary.insights.length) return <div className="panel"><EmptyState title="No AI insights yet" text="Generate demo logs or upload a dataset to run Isolation Forest and rule-based analysis."/></div>
  return <div className="insights-layout"><div className="insights-intro panel"><div className="insights-orb"><BrainCircuit size={28}/><span/></div><div><div className="eyebrow">MACHINE LEARNING ENGINE</div><h2>Signals, not assumptions.</h2><p>Isolation Forest identifies unusual five-minute feature windows. Rule-based diagnostics add context from the observed log stream. Findings should be verified against raw events.</p></div><div className="model-stats"><div><span>Model</span><strong>Isolation Forest</strong></div><div><span>Windows flagged</span><strong>{fmt(summary.anomaly_windows)}</strong></div><div><span>Model status</span><strong className={summary.model_status==='trained'?'text-green':'text-amber'}>{summary.model_status==='trained'?'Trained for upload':'More data needed'}</strong></div></div></div><div className="insights-list-heading"><div><h2>Analysis findings</h2><p>{summary.insights.length} findings generated for {summary.filename||'selected dataset'}</p></div><button className="button button-secondary" onClick={onOpenLogs}><FileText size={15}/> Inspect raw logs</button></div><div className="insight-cards">{summary.insights.map((ins,i)=><article className="insight-card" key={`${ins.kind}-${i}`}><div className="insight-card-top"><div className={`insight-large-icon ${ins.severity}`}><insightIcon kind={ins.kind}/></div><span className={`severity-pill ${ins.severity}`}>{ins.severity} priority</span><span className="insight-type">{ins.kind.replaceAll('_',' ')}</span></div><h3>{ins.title}</h3><p>{ins.details}</p><div className="recommendation"><div className="recommendation-icon"><Zap size={15}/></div><div><strong>Recommended investigation</strong><span>{ins.recommendation}</span></div></div></article>)}</div><div className="method-note"><ShieldCheck size={18}/><div><strong>How to interpret these findings</strong><p>Isolation Forest is an unsupervised detector; a flagged window is statistically unusual relative to the uploaded dataset. It does not confirm malicious activity or establish root cause. Validate findings against raw logs, deployment history, and service metrics.</p></div></div></div>
}
function insightIcon({kind}:{kind:string}) { if(kind==='ml_anomaly') return <AlertOctagon size={20}/>; if(kind==='error_pattern') return <ShieldAlert size={20}/>; return <AlertTriangle size={20}/> }
function ChartEmpty() {return <div className="chart-empty"><Activity size={23}/><span>Not enough data to chart</span></div>}
function EmptyState({title,text}:{title:string;text:string}) {return <div className="empty-state"><div className="empty-state-icon"><FileText size={22}/></div><strong>{title}</strong><p>{text}</p></div>}
