"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

type View = "overview" | "fleet" | "incidents" | "automation";
type NodeStatus = "healthy" | "watch" | "critical";
type Severity = "critical" | "high" | "medium";
type ConnectionMode = "demo" | "connecting" | "live" | "error";

type FleetNode = {
  id: string;
  name: string;
  role: string;
  platform: string;
  location: string;
  status: NodeStatus;
  cpu: number;
  memory: number;
  disk: number;
  latency: number;
  uptime: string;
  lastSeen: string;
  x: number;
  y: number;
};

type Incident = {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  nodeId: string;
  openedAt: string;
  acknowledged: boolean;
};

type AuditEvent = {
  id: string;
  occurredAt: string;
  action: string;
  target: string;
  detail: Record<string, string | number | boolean | null>;
};

type ControlPlaneSnapshot = {
  generatedAt: string;
  devices: Array<{
    deviceId: string;
    lastSeen: string;
    state: NodeStatus;
    telemetry: {
      platform: "linux" | "win32" | "darwin" | "other";
      architecture: string;
      sequence: number;
      metrics: {
        cpuUsedPercent: number;
        memoryUsedPercent: number;
        diskUsedPercent: number;
        uptimeSeconds: number;
      };
      checks: Array<{ name: string; state: "up" | "down" | "degraded"; latencyMs?: number }>;
    };
  }>;
  incidents: Array<{
    id: string;
    title: string;
    detail: string;
    severity: Severity;
    deviceId: string;
    openedAt: string;
    acknowledged: boolean;
  }>;
  auditEvents: AuditEvent[];
};

const DEMO_BASE_TIME = "2026-01-15T09:00:00.000Z";

const demoFleet: FleetNode[] = [
  { id: "edge-gw-01", name: "edge-gw-01", role: "Ingress gateway", platform: "Linux", location: "Primary edge", status: "healthy", cpu: 38, memory: 54, disk: 41, latency: 18, uptime: "31d 08h", lastSeen: DEMO_BASE_TIME, x: 18, y: 50 },
  { id: "control-api-01", name: "control-api-01", role: "Control API", platform: "Linux", location: "Core zone", status: "watch", cpu: 67, memory: 71, disk: 52, latency: 43, uptime: "12d 17h", lastSeen: DEMO_BASE_TIME, x: 42, y: 28 },
  { id: "telemetry-db-01", name: "telemetry-db-01", role: "Telemetry store", platform: "Linux", location: "Data zone", status: "healthy", cpu: 29, memory: 62, disk: 68, latency: 22, uptime: "42d 03h", lastSeen: DEMO_BASE_TIME, x: 69, y: 25 },
  { id: "endpoint-win-07", name: "endpoint-win-07", role: "Managed endpoint", platform: "Windows", location: "Remote site A", status: "critical", cpu: 82, memory: 89, disk: 94, latency: 71, uptime: "6d 11h", lastSeen: DEMO_BASE_TIME, x: 48, y: 72 },
  { id: "endpoint-win-12", name: "endpoint-win-12", role: "Managed endpoint", platform: "Windows", location: "Remote site B", status: "healthy", cpu: 24, memory: 46, disk: 37, latency: 36, uptime: "2d 09h", lastSeen: DEMO_BASE_TIME, x: 77, y: 68 },
  { id: "runner-linux-03", name: "runner-linux-03", role: "Test runner", platform: "Linux", location: "Lab segment", status: "healthy", cpu: 45, memory: 51, disk: 44, latency: 29, uptime: "4d 22h", lastSeen: DEMO_BASE_TIME, x: 91, y: 43 },
];

const demoIncidents: Incident[] = [
  { id: "INC-2047", title: "Storage threshold crossed", detail: "System volume reached 94%. Cleanup policy did not recover space.", severity: "critical", nodeId: "endpoint-win-07", openedAt: new Date(Date.now() - 3 * 60_000).toISOString(), acknowledged: false },
  { id: "INC-2046", title: "Heartbeat cadence degraded", detail: "Three telemetry intervals arrived outside the expected window.", severity: "high", nodeId: "control-api-01", openedAt: new Date(Date.now() - 11 * 60_000).toISOString(), acknowledged: false },
  { id: "INC-2044", title: "TLS response-time drift", detail: "Rolling latency is above the fictional seven-day demo baseline.", severity: "medium", nodeId: "edge-gw-01", openedAt: new Date(Date.now() - 28 * 60_000).toISOString(), acknowledged: false },
];

const demoAuditEvents: AuditEvent[] = [
  { id: "demo-audit-1", occurredAt: new Date(Date.now() - 3 * 60_000).toISOString(), action: "incident.opened", target: "INC-2047", detail: { rule: "disk-pressure" } },
  { id: "demo-audit-2", occurredAt: new Date(Date.now() - 4 * 60_000).toISOString(), action: "telemetry.verified", target: "endpoint-win-07", detail: {} },
  { id: "demo-audit-3", occurredAt: new Date(Date.now() - 22 * 60_000).toISOString(), action: "baseline.completed", target: "demo", detail: {} },
];

const detectionRules = [
  { name: "Disk pressure", condition: "Disk used ≥ 90%", action: "Open critical incident", severity: "critical" as const },
  { name: "Lost heartbeat", condition: "No signal for 120s", action: "Open high incident", severity: "high" as const },
  { name: "Service unavailable", condition: "Explicit check reports down", action: "Open high incident", severity: "high" as const },
  { name: "Memory saturation", condition: "Memory used ≥ 92%", action: "Open high incident", severity: "high" as const },
];

type IconName = "grid" | "server" | "alert" | "bolt" | "search" | "bell" | "activity" | "shield" | "chevron" | "check" | "pause" | "play" | "clock" | "terminal" | "x";

const navItems: Array<{ id: View; label: string; icon: IconName }> = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "fleet", label: "Fleet", icon: "server" },
  { id: "incidents", label: "Incidents", icon: "alert" },
  { id: "automation", label: "Rules", icon: "bolt" },
];

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></>,
    alert: <><path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    bolt: <path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z"/>, search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>, activity: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>, chevron: <path d="m9 18 6-6-6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>, pause: <><path d="M9 5v14M15 5v14"/></>, play: <path d="m8 5 11 7-11 7V5Z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, terminal: <><path d="m4 17 6-5-6-5M12 19h8"/></>, x: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function StatusDot({ status }: { status: NodeStatus }) {
  return <span className={`oa-status-dot is-${status}`} aria-label={status}/>;
}

function MetricBar({ value, tone = "blue" }: { value: number; tone?: "blue" | "amber" | "red" }) {
  return <span className="oa-metric-bar" aria-label={`${value} percent`}><span className={`oa-metric-fill is-${tone}`} style={{ width: `${Math.min(value, 100)}%` }}/></span>;
}

function CompassMark() {
  return <span className="oa-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 2.8 21 11l8.2 5-8.2 5-5 8.2-5-8.2-8.2-5 8.2-5 5-8.2Z"/><circle cx="16" cy="16" r="3.2"/></svg></span>;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days}d ${String(hours).padStart(2, "0")}h` : `${hours}h ${String(Math.floor((seconds % 3_600) / 60)).padStart(2, "0")}m`;
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (elapsed < 60_000) return `${Math.max(1, Math.floor(elapsed / 1_000))}s`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function positionFor(deviceId: string, index: number): { x: number; y: number } {
  let hash = 17;
  for (const character of deviceId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { x: 12 + ((hash + index * 19) % 77), y: 17 + (((hash >>> 8) + index * 23) % 65) };
}

function platformLabel(platform: ControlPlaneSnapshot["devices"][number]["telemetry"]["platform"]): string {
  return platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : "Other";
}

function mapSnapshot(snapshot: ControlPlaneSnapshot): { fleet: FleetNode[]; incidents: Incident[] } {
  const fleet = snapshot.devices.map((device, index) => {
    const latencyValues = device.telemetry.checks.flatMap((check) => typeof check.latencyMs === "number" ? [check.latencyMs] : []);
    const latency = latencyValues.length > 0 ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length) : 0;
    return {
      id: device.deviceId,
      name: device.deviceId,
      role: "Enrolled endpoint",
      platform: platformLabel(device.telemetry.platform),
      location: `${device.telemetry.architecture} agent`,
      status: device.state,
      cpu: Math.round(device.telemetry.metrics.cpuUsedPercent),
      memory: Math.round(device.telemetry.metrics.memoryUsedPercent),
      disk: Math.round(device.telemetry.metrics.diskUsedPercent),
      latency,
      uptime: formatDuration(device.telemetry.metrics.uptimeSeconds),
      lastSeen: device.lastSeen,
      ...positionFor(device.deviceId, index),
    };
  });
  const incidents = snapshot.incidents.map((incident) => ({
    id: incident.id,
    title: incident.title,
    detail: incident.detail,
    severity: incident.severity,
    nodeId: incident.deviceId,
    openedAt: incident.openedAt,
    acknowledged: incident.acknowledged,
  }));
  return { fleet, incidents };
}

function isSnapshot(value: unknown): value is ControlPlaneSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ControlPlaneSnapshot>;
  return typeof candidate.generatedAt === "string" && Array.isArray(candidate.devices) && Array.isArray(candidate.incidents) && Array.isArray(candidate.auditEvents);
}

function Topology({ nodes, selected, onSelect }: { nodes: FleetNode[]; selected: string; onSelect: (id: string) => void }) {
  const edges = nodes.slice(1).map((node, index) => [nodes[Math.floor(index / 2)] ?? nodes[0], node] as const);
  return <div className="oa-topology" role="group" aria-label="Fleet topology map">
    <div className="oa-map-grid" aria-hidden="true"/>
    {nodes.length === 0 ? <div className="oa-empty-state"><Icon name="server"/><strong>No telemetry yet</strong><span>Enroll an agent to populate the live map.</span></div> : <>
      <svg className="oa-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{edges.map(([from, to]) => <line key={`${from.id}-${to.id}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={from.status === "critical" || to.status === "critical" ? "is-alert" : ""}/>)}</svg>
      {nodes.map((node) => <button className={`oa-map-node is-${node.status} ${selected === node.id ? "is-selected" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} key={node.id} onClick={() => onSelect(node.id)} aria-pressed={selected === node.id} aria-label={`${node.name}, ${node.status}`}><span className="oa-node-pulse"/><span className="oa-node-core"><Icon name={node.platform === "Windows" ? "grid" : "terminal"} size={15}/></span><span className="oa-node-label"><strong>{node.name}</strong><small>{node.latency} ms</small></span></button>)}
    </>}
    <div className="oa-map-legend"><span><i className="is-healthy"/> Healthy</span><span><i className="is-watch"/> Watch</span><span><i className="is-critical"/> Critical</span></div>
  </div>;
}

function FleetTable({ nodes, onSelect }: { nodes: FleetNode[]; onSelect: (id: string) => void }) {
  return <div className="oa-table-wrap"><table className="oa-table">
    <thead><tr><th>Node</th><th>State</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Latency</th><th/></tr></thead>
    <tbody>{nodes.length === 0 ? <tr><td colSpan={7}><div className="oa-table-empty">Waiting for the first signed telemetry payload.</div></td></tr> : nodes.map((node) => <tr key={node.id}>
      <td><button className="oa-node-name" onClick={() => onSelect(node.id)}><StatusDot status={node.status}/><span><strong>{node.name}</strong><small>{node.role}</small></span></button></td>
      <td><span className={`oa-state-label is-${node.status}`}>{node.status}</span></td>
      <td><span className="oa-value-pair"><MetricBar value={node.cpu} tone={node.cpu > 80 ? "red" : "blue"}/>{node.cpu}%</span></td>
      <td><span className="oa-value-pair"><MetricBar value={node.memory} tone={node.memory > 85 ? "amber" : "blue"}/>{node.memory}%</span></td>
      <td><span className="oa-value-pair"><MetricBar value={node.disk} tone={node.disk >= 90 ? "red" : "blue"}/>{node.disk}%</span></td>
      <td className="oa-mono">{node.latency} ms</td><td><button className="oa-row-action" onClick={() => onSelect(node.id)} aria-label={`Inspect ${node.name}`}><Icon name="chevron" size={16}/></button></td>
    </tr>)}</tbody>
  </table></div>;
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState(demoFleet[3].id);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [demoAcknowledged, setDemoAcknowledged] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>("demo");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:4318");
  const [dashboardToken, setDashboardToken] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [snapshot, setSnapshot] = useState<ControlPlaneSnapshot | null>(null);
  const restoredConnection = useRef(false);

  const fetchSnapshot = useCallback(async (targetEndpoint = endpoint, token = dashboardToken) => {
    const normalized = targetEndpoint.trim().replace(/\/$/, "");
    const response = await fetch(`${normalized}/api/v1/state`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(response.status === 401 ? "Dashboard token was rejected." : `Control plane returned HTTP ${response.status}.`);
    if (!isSnapshot(body)) throw new Error("Control plane returned an unexpected response.");
    setSnapshot(body);
    setTick((value) => value + 1);
    return body;
  }, [dashboardToken, endpoint]);

  const connect = async (event?: FormEvent) => {
    event?.preventDefault();
    setConnectionMode("connecting");
    setConnectionError("");
    try {
      const url = new URL(endpoint.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Use an HTTP or HTTPS control-plane URL.");
      await fetchSnapshot(url.toString().replace(/\/$/, ""), dashboardToken);
      setEndpoint(url.toString().replace(/\/$/, ""));
      setConnectionMode("live");
      setConnectionOpen(false);
      window.sessionStorage.setItem("opsatlas-connection", JSON.stringify({ endpoint: url.toString().replace(/\/$/, ""), dashboardToken }));
    } catch (error) {
      setConnectionMode("error");
      setConnectionError(error instanceof Error ? error.message : "Connection failed.");
    }
  };

  const disconnect = () => {
    setConnectionMode("demo");
    setSnapshot(null);
    setConnectionError("");
    setConnectionOpen(false);
    setSelectedNodeId(demoFleet[3].id);
    window.sessionStorage.removeItem("opsatlas-connection");
  };

  useEffect(() => {
    if (restoredConnection.current) return;
    restoredConnection.current = true;
    const timer = window.setTimeout(() => {
      const saved = window.sessionStorage.getItem("opsatlas-connection");
      if (!saved) return;
      try {
        const connection = JSON.parse(saved) as { endpoint?: unknown; dashboardToken?: unknown };
        if (typeof connection.endpoint !== "string" || typeof connection.dashboardToken !== "string") return;
        setEndpoint(connection.endpoint);
        setDashboardToken(connection.dashboardToken);
        setConnectionMode("connecting");
        void fetchSnapshot(connection.endpoint, connection.dashboardToken).then(() => setConnectionMode("live")).catch(() => { setConnectionMode("error"); setConnectionOpen(true); });
      } catch { window.sessionStorage.removeItem("opsatlas-connection"); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSnapshot]);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (connectionMode === "live") void fetchSnapshot().catch((error) => { setConnectionMode("error"); setConnectionError(error instanceof Error ? error.message : "Connection lost."); });
      else setTick((value) => value + 1);
    }, connectionMode === "live" ? 5_000 : 3_000);
    return () => window.clearInterval(timer);
  }, [connectionMode, fetchSnapshot, paused]);

  const mapped = useMemo(() => snapshot ? mapSnapshot(snapshot) : { fleet: demoFleet, incidents: demoIncidents }, [snapshot]);
  const query = search.trim().toLowerCase();
  const fleet = mapped.fleet.filter((node) => !query || `${node.name} ${node.role} ${node.platform} ${node.location}`.toLowerCase().includes(query));
  const incidents = mapped.incidents.filter((incident) => !query || `${incident.title} ${incident.detail} ${incident.nodeId} ${incident.id}`.toLowerCase().includes(query));
  const selectedNode = mapped.fleet.find((node) => node.id === selectedNodeId) ?? mapped.fleet[0];
  const isAcknowledged = (incident: Incident) => incident.acknowledged || demoAcknowledged.includes(incident.id);
  const actionCount = incidents.filter((incident) => !isAcknowledged(incident)).length;
  const visibleIncidents = incidents.filter((incident) => filter === "all" || incident.severity === filter);
  const signalRate = snapshot ? mapped.fleet.length : 1184 + (tick % 6) * 7;
  const averageLatency = fleet.length > 0 ? Math.round(fleet.reduce((sum, node) => sum + node.latency, 0) / fleet.length) : 0;
  const criticalCount = incidents.filter((incident) => incident.severity === "critical" && !isAcknowledged(incident)).length;
  const elevatedCount = incidents.filter((incident) => incident.severity !== "critical" && !isAcknowledged(incident)).length;
  const clock = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const selectNode = (id: string) => { setSelectedNodeId(id); setPanelOpen(true); };

  const acknowledgeIncident = async (incident: Incident) => {
    if (connectionMode !== "live") {
      setDemoAcknowledged((items) => items.includes(incident.id) ? items.filter((id) => id !== incident.id) : [...items, incident.id]);
      return;
    }
    if (incident.acknowledged) return;
    try {
      const response = await fetch(`${endpoint}/api/v1/incidents/${encodeURIComponent(incident.id)}/ack`, { method: "POST", headers: { Authorization: `Bearer ${dashboardToken}` } });
      if (!response.ok) throw new Error(`Acknowledge returned HTTP ${response.status}.`);
      await fetchSnapshot();
    } catch (error) { setConnectionError(error instanceof Error ? error.message : "Could not acknowledge incident."); }
  };

  const timeline = snapshot?.auditEvents.slice(0, 4) ?? demoAuditEvents;

  const connectionLabel = connectionMode === "live" ? "LIVE DATA" : connectionMode === "connecting" ? "CONNECTING" : connectionMode === "error" ? "OFFLINE" : "DEMO DATA";

  return <main className="oa-shell">
    <aside className="oa-sidebar">
      <div className="oa-brand"><CompassMark/><span><strong>OpsAtlas</strong><small>COMMAND CONSOLE</small></span></div>
      <nav className="oa-nav" aria-label="Primary navigation"><p>WORKSPACE</p>{navItems.map((item) => <button key={item.id} className={view === item.id ? "is-active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "incidents" && actionCount > 0 && <b>{actionCount}</b>}</button>)}</nav>
      <div className="oa-side-spacer"/>
      <section className={`oa-collector-card is-${connectionMode}`}><div><span className="oa-live-dot"/><strong>{connectionMode === "live" ? "Control plane linked" : connectionMode === "demo" ? "Demo simulator" : "Collector unavailable"}</strong></div><p>{connectionMode === "live" ? "Last snapshot" : "Safe sample data"}<span>{snapshot ? `${relativeTime(snapshot.generatedAt)} ago` : "local"}</span></p><div className="oa-collector-line"><span style={{ width: `${72 + (tick % 4) * 5}%` }}/></div></section>
      <div className="oa-user"><span>OP</span><div><strong>Local operator</strong><small>Browser session</small></div><button aria-label="Connection settings" onClick={() => setConnectionOpen(true)}>•••</button></div>
    </aside>

    <section className="oa-workspace">
      <header className="oa-topbar">
        <div className="oa-mobile-brand"><CompassMark/><strong>OpsAtlas</strong></div>
        <label className="oa-search"><Icon name="search" size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search nodes and incidents" placeholder="Search fleet or incident…"/><kbd>⌘ K</kbd></label>
        <div className="oa-top-actions"><button className={`oa-demo-badge is-${connectionMode}`} onClick={() => setConnectionOpen(true)}>{connectionLabel}</button><button className={`oa-live-toggle ${!paused ? "is-live" : ""}`} onClick={() => setPaused((value) => !value)} aria-pressed={!paused}><Icon name={paused ? "play" : "pause"} size={14}/>{paused ? "Resume" : "Syncing"}</button><button className="oa-icon-button" aria-label="Open incidents" onClick={() => setView("incidents")}><Icon name="bell" size={18}/>{actionCount > 0 && <i/>}</button></div>
      </header>

      <div className="oa-content">
        <div className="oa-heading"><div><p>OPERATIONS / {view.toUpperCase()}</p><h1>{view === "overview" ? "System overview" : view === "fleet" ? "Fleet inventory" : view === "incidents" ? "Incident command" : "Detection rules"}</h1><span>{view === "overview" ? "A verified readout of the systems that need attention." : view === "fleet" ? "Every enrolled node, one operational picture." : view === "incidents" ? "Triage, acknowledge and follow the response trail." : "Deterministic thresholds. Visible outcomes."}</span></div><div className="oa-clock"><Icon name="clock" size={15}/><span suppressHydrationWarning>{clock}</span><small>LOCAL</small></div></div>

        {view === "overview" && <>
          <section className="oa-kpis" aria-label="Key metrics">
            <article><div className="oa-kpi-icon is-green"><Icon name="server"/></div><div><p>Nodes reporting</p><strong>{fleet.length}</strong><span className="is-good">signed telemetry</span></div></article>
            <article><div className="oa-kpi-icon is-red"><Icon name="alert"/></div><div><p>Needs action</p><strong>{actionCount}</strong><span className={criticalCount > 0 ? "is-bad" : "is-good"}>{criticalCount} critical</span></div></article>
            <article><div className="oa-kpi-icon is-blue"><Icon name="activity"/></div><div><p>{snapshot ? "Verified agents" : "Signals / min"}</p><strong>{signalRate.toLocaleString()}</strong><span className="is-good">{snapshot ? "live snapshot" : "fictional demo"}</span></div></article>
            <article><div className="oa-kpi-icon is-violet"><Icon name="shield"/></div><div><p>Mean check latency</p><strong>{averageLatency} <small>ms</small></strong><span>explicit probes only</span></div></article>
          </section>
          <section className="oa-dashboard-grid">
            <article className="oa-card oa-map-card"><div className="oa-card-head"><div><p>{snapshot ? "LIVE TOPOLOGY" : "DEMO TOPOLOGY"}</p><h2>Operational map</h2></div><span className="oa-signal"><i/> {fleet.length} reporting nodes</span></div><Topology nodes={fleet} selected={selectedNodeId} onSelect={selectNode}/></article>
            <article className="oa-card oa-incident-card"><div className="oa-card-head"><div><p>RESPONSE QUEUE</p><h2>Active incidents</h2></div><button onClick={() => setView("incidents")}>View all <Icon name="chevron" size={13}/></button></div><div className="oa-incident-list">
              {incidents.length === 0 ? <div className="oa-list-empty"><Icon name="shield"/><span>No active incidents</span></div> : incidents.slice(0, 4).map((incident) => { const acknowledged = isAcknowledged(incident); return <button key={incident.id} className={`oa-incident is-${incident.severity} ${acknowledged ? "is-ack" : ""}`} onClick={() => { selectNode(incident.nodeId); setView("incidents"); }}><span className="oa-severity-rail"/><span className="oa-incident-main"><span><b>{incident.severity}</b><time>{relativeTime(incident.openedAt)}</time></span><strong>{incident.title}</strong><small>{incident.nodeId} · {incident.id.slice(0, 12)}</small></span><Icon name={acknowledged ? "check" : "chevron"} size={15}/></button>; })}
            </div><div className="oa-incident-foot"><span><i className="is-critical"/>Critical <b>{criticalCount}</b></span><span><i className="is-watch"/>Elevated <b>{elevatedCount}</b></span><span>{snapshot ? "Durable audit enabled" : "Fictional scenario"}</span></div></article>
          </section>
          <article className="oa-card oa-fleet-card"><div className="oa-card-head"><div><p>FLEET HEALTH</p><h2>Recent telemetry</h2></div><button onClick={() => setView("fleet")}>Full inventory <Icon name="chevron" size={13}/></button></div><FleetTable nodes={fleet} onSelect={selectNode}/></article>
        </>}

        {view === "fleet" && <section className="oa-stack"><article className="oa-card oa-map-card is-wide"><div className="oa-card-head"><div><p>NETWORK VIEW</p><h2>Node relationships</h2></div><span className="oa-signal"><i/> {fleet.length} {snapshot ? "live" : "demo"} nodes</span></div><Topology nodes={fleet} selected={selectedNodeId} onSelect={selectNode}/></article><article className="oa-card oa-fleet-card"><div className="oa-card-head"><div><p>INVENTORY</p><h2>Enrolled nodes</h2></div><span className="oa-muted">Showing {fleet.length}</span></div><FleetTable nodes={fleet} onSelect={selectNode}/></article></section>}

        {view === "incidents" && <section className="oa-incident-view">
          <article className="oa-card oa-queue-full"><div className="oa-card-head"><div><p>OPEN QUEUE</p><h2>Needs attention</h2></div><div className="oa-filters">{(["all", "critical", "high", "medium"] as const).map((item) => <button key={item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="oa-detailed-incidents">
            {visibleIncidents.length === 0 ? <div className="oa-list-empty is-large"><Icon name="shield"/><span>No incidents match this view.</span></div> : visibleIncidents.map((incident) => { const acknowledged = isAcknowledged(incident); return <article key={incident.id} className={`oa-detailed-incident is-${incident.severity}`}><span className="oa-severity-rail"/><div className="oa-detailed-copy"><div><b>{incident.severity}</b><span>{incident.id.slice(0, 16)}</span><time>{relativeTime(incident.openedAt)} ago</time></div><h3>{incident.title}</h3><p>{incident.detail}</p><button className="oa-link-button" onClick={() => selectNode(incident.nodeId)}>{incident.nodeId}<Icon name="chevron" size={13}/></button></div><button className={`oa-ack-button ${acknowledged ? "is-done" : ""}`} disabled={connectionMode === "live" && acknowledged} onClick={() => void acknowledgeIncident(incident)}><Icon name="check" size={15}/>{acknowledged ? "Acknowledged" : "Acknowledge"}</button></article>; })}
          </div></article>
          <aside className="oa-card oa-timeline"><div className="oa-card-head"><div><p>RESPONSE LOG</p><h2>Latest activity</h2></div></div><ol>{timeline.length === 0 ? <li><i className="is-dim"/><div><strong>No audit events yet</strong><p>Operational changes will appear here.</p></div></li> : timeline.map((event) => <li key={event.id}><i className={event.action.includes("resolved") ? "is-dim" : ""}/><div><strong>{event.action.replaceAll(".", " ")}</strong><p>{event.target.slice(0, 32)}</p><time>{relativeTime(event.occurredAt)} ago</time></div></li>)}</ol></aside>
        </section>}

        {view === "automation" && <section className="oa-rule-grid">
          {detectionRules.map((rule, index) => { const hits = incidents.filter((incident) => incident.severity === rule.severity).length; return <article className="oa-card oa-rule" key={rule.name}><div className={`oa-rule-icon ${hits > 0 ? "is-triggered" : ""}`}><Icon name={hits > 0 ? "alert" : "bolt"}/></div><div className="oa-rule-copy"><p>RULE {String(index + 1).padStart(2, "0")}</p><h2>{rule.name}</h2><dl><div><dt>When</dt><dd>{rule.condition}</dd></div><div><dt>Then</dt><dd>{rule.action}</dd></div></dl></div><footer><span className={hits > 0 ? "is-triggered" : ""}><i/>{hits > 0 ? "Triggered" : "Armed"}</span><b>{hits} active hit{hits === 1 ? "" : "s"}</b></footer></article>; })}
          <article className="oa-card oa-rule-note"><Icon name="shield" size={24}/><div><strong>Rules run in the control plane</strong><p>Agents report bounded health signals. They cannot execute remote commands or collect file contents.</p></div></article>
        </section>}
      </div>
    </section>

    {panelOpen && selectedNode && <aside className="oa-inspector" aria-label={`Details for ${selectedNode.name}`}>
      <div className="oa-inspector-head"><div><StatusDot status={selectedNode.status}/><span><p>NODE DETAIL</p><h2>{selectedNode.name}</h2></span></div><button onClick={() => setPanelOpen(false)} aria-label="Close node details"><Icon name="x"/></button></div>
      <div className="oa-node-summary"><span className={`oa-node-avatar is-${selectedNode.status}`}><Icon name={selectedNode.platform === "Windows" ? "grid" : "terminal"} size={22}/></span><div><strong>{selectedNode.role}</strong><p>{selectedNode.platform} · {selectedNode.location}</p></div></div>
      <dl className="oa-facts"><div><dt>State</dt><dd className={`is-${selectedNode.status}`}><StatusDot status={selectedNode.status}/>{selectedNode.status}</dd></div><div><dt>Last signal</dt><dd>{snapshot ? `${relativeTime(selectedNode.lastSeen)} ago` : paused ? "Paused" : "Demo stream"}</dd></div><div><dt>Uptime</dt><dd>{selectedNode.uptime}</dd></div><div><dt>Round trip</dt><dd>{selectedNode.latency} ms</dd></div></dl>
      <section className="oa-inspector-metrics"><h3>Resource pressure</h3>{[{ label: "CPU", value: selectedNode.cpu }, { label: "Memory", value: selectedNode.memory }, { label: "Disk", value: selectedNode.disk }].map((metric) => <div key={metric.label}><span><b>{metric.label}</b><strong>{metric.value}%</strong></span><MetricBar value={metric.value} tone={metric.value >= 90 ? "red" : metric.value >= 80 ? "amber" : "blue"}/></div>)}</section>
      <section className="oa-signal-log"><div><h3>Signal trail</h3><span>visual trend</span></div><svg viewBox="0 0 260 64" preserveAspectRatio="none" aria-label="Recent metric trend"><defs><linearGradient id="signal-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#54d5ff" stopOpacity=".3"/><stop offset="1" stopColor="#54d5ff" stopOpacity="0"/></linearGradient></defs><path className="oa-area" d="M0 50 C20 48 26 30 44 34 S75 45 90 28 120 44 136 27 165 16 180 25 210 40 225 20 246 18 260 12 V64 H0Z"/><path d="M0 50 C20 48 26 30 44 34 S75 45 90 28 120 44 136 27 165 16 180 25 210 40 225 20 246 18 260 12"/></svg></section>
      {selectedNode.status === "critical" ? <div className="oa-inspector-alert"><Icon name="alert"/><div><strong>Critical condition</strong><p>One or more deterministic health rules currently require attention.</p></div></div> : <div className="oa-inspector-ok"><Icon name="shield"/><div><strong>Telemetry verified</strong><p>{snapshot ? "The recent payload passed signature and freshness checks." : "This is clearly labeled, fictional portfolio data."}</p></div></div>}
      <p className="oa-privacy-note">{snapshot ? "Live workspace · bounded system health only" : "Demo workspace · fictional infrastructure · no personal data"}</p>
    </aside>}

    {connectionOpen && <div className="oa-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setConnectionOpen(false); }}><section className="oa-connect-modal" role="dialog" aria-modal="true" aria-labelledby="connection-title">
      <div className="oa-connect-head"><div><p>DATA SOURCE</p><h2 id="connection-title">Connect a control plane</h2></div><button onClick={() => setConnectionOpen(false)} aria-label="Close connection settings"><Icon name="x"/></button></div>
      <form onSubmit={(event) => void connect(event)}><label>Control-plane URL<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="http://127.0.0.1:4318" required/></label><label>Dashboard token<input value={dashboardToken} onChange={(event) => setDashboardToken(event.target.value)} type="password" autoComplete="off" placeholder="Required outside loopback"/></label><p className="oa-connect-note"><Icon name="shield" size={15}/>Credentials stay in this browser tab&apos;s session storage and are never committed to source.</p>{connectionError && <p className="oa-connect-error">{connectionError}</p>}<div className="oa-connect-actions">{connectionMode !== "demo" && <button type="button" className="is-secondary" onClick={disconnect}>Use demo</button>}<button type="submit" disabled={connectionMode === "connecting"}>{connectionMode === "connecting" ? "Connecting…" : "Connect live"}</button></div></form>
    </section></div>}
  </main>;
}
