"use client";

import { useEffect, useState } from "react";

type View = "overview" | "fleet" | "incidents" | "automation";
type NodeStatus = "healthy" | "watch" | "critical";
type Severity = "critical" | "high" | "medium";

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
  x: number;
  y: number;
};

type Incident = {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  nodeId: string;
  age: string;
};

const fleet: FleetNode[] = [
  { id: "core-edge-01", name: "core-edge-01", role: "Ingress gateway", platform: "Linux", location: "Melbourne edge", status: "healthy", cpu: 38, memory: 54, disk: 41, latency: 18, uptime: "31d 08h", x: 18, y: 50 },
  { id: "core-api-01", name: "core-api-01", role: "Control API", platform: "Linux", location: "Melbourne core", status: "watch", cpu: 67, memory: 71, disk: 52, latency: 43, uptime: "12d 17h", x: 42, y: 28 },
  { id: "ops-db-01", name: "ops-db-01", role: "Telemetry store", platform: "Linux", location: "Melbourne core", status: "healthy", cpu: 29, memory: 62, disk: 68, latency: 22, uptime: "42d 03h", x: 69, y: 25 },
  { id: "field-win-07", name: "field-win-07", role: "Field workstation", platform: "Windows", location: "Bendigo branch", status: "critical", cpu: 82, memory: 89, disk: 94, latency: 71, uptime: "6d 11h", x: 48, y: 72 },
  { id: "field-win-12", name: "field-win-12", role: "Field workstation", platform: "Windows", location: "Geelong branch", status: "healthy", cpu: 24, memory: 46, disk: 37, latency: 36, uptime: "2d 09h", x: 77, y: 68 },
  { id: "lab-linux-03", name: "lab-linux-03", role: "Test runner", platform: "Linux", location: "Engineering lab", status: "healthy", cpu: 45, memory: 51, disk: 44, latency: 29, uptime: "4d 22h", x: 91, y: 43 },
];

const incidents: Incident[] = [
  { id: "INC-2047", title: "Storage threshold crossed", detail: "System volume reached 94%. Cleanup policy did not recover space.", severity: "critical", nodeId: "field-win-07", age: "3m" },
  { id: "INC-2046", title: "Heartbeat cadence degraded", detail: "Three telemetry intervals arrived outside the expected window.", severity: "high", nodeId: "core-api-01", age: "11m" },
  { id: "INC-2044", title: "TLS response-time drift", detail: "Rolling latency is 41% above the seven-day baseline.", severity: "medium", nodeId: "core-edge-01", age: "28m" },
];

const rules = [
  { name: "Disk pressure", condition: "Disk used ≥ 90%", action: "Open critical incident", state: "Triggered", hits: 1 },
  { name: "Lost heartbeat", condition: "No signal for 120s", action: "Page on-call", state: "Armed", hits: 0 },
  { name: "Service unavailable", condition: "2 failed checks", action: "Open high incident", state: "Armed", hits: 0 },
  { name: "Memory saturation", condition: "Memory used ≥ 92%", action: "Capture trend window", state: "Armed", hits: 0 },
];

type IconName = "grid" | "server" | "alert" | "bolt" | "search" | "bell" | "activity" | "shield" | "chevron" | "check" | "pause" | "play" | "clock" | "terminal" | "x";

const navItems: { id: View; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "fleet", label: "Fleet", icon: "server" },
  { id: "incidents", label: "Incidents", icon: "alert" },
  { id: "automation", label: "Rules", icon: "bolt" },
];

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></>,
    alert: <><path d="M10.3 3.6 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
    bolt: <path d="m13 2-9 12h8l-1 8 9-12h-8l1-8Z"/>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    activity: <path d="M3 12h4l2-7 4 14 2-7h6"/>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>, check: <path d="m5 12 4 4L19 6"/>, pause: <><path d="M9 5v14M15 5v14"/></>, play: <path d="m8 5 11 7-11 7V5Z"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>, terminal: <><path d="m4 17 6-5-6-5M12 19h8"/></>, x: <><path d="m6 6 12 12M18 6 6 18"/></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function StatusDot({ status }: { status: NodeStatus }) {
  return <span className={`oa-status-dot is-${status}`} aria-label={status} />;
}

function MetricBar({ value, tone = "blue" }: { value: number; tone?: "blue" | "amber" | "red" }) {
  return <span className="oa-metric-bar" aria-label={`${value} percent`}><span className={`oa-metric-fill is-${tone}`} style={{ width: `${Math.min(value, 100)}%` }} /></span>;
}

function CompassMark() {
  return <span className="oa-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 2.8 21 11l8.2 5-8.2 5-5 8.2-5-8.2-8.2-5 8.2-5 5-8.2Z"/><circle cx="16" cy="16" r="3.2"/></svg></span>;
}

function Topology({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const edges: [string, string][] = [["core-edge-01", "core-api-01"], ["core-api-01", "ops-db-01"], ["core-api-01", "field-win-07"], ["ops-db-01", "field-win-12"], ["ops-db-01", "lab-linux-03"], ["field-win-07", "field-win-12"]];
  const byId = Object.fromEntries(fleet.map((node) => [node.id, node]));
  return (
    <div className="oa-topology" role="group" aria-label="Fleet topology map">
      <div className="oa-map-grid" aria-hidden="true" />
      <svg className="oa-map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {edges.map(([from, to]) => <line key={`${from}-${to}`} x1={byId[from].x} y1={byId[from].y} x2={byId[to].x} y2={byId[to].y} className={byId[from].status === "critical" || byId[to].status === "critical" ? "is-alert" : ""}/>) }
      </svg>
      {fleet.map((node) => (
        <button className={`oa-map-node is-${node.status} ${selected === node.id ? "is-selected" : ""}`} style={{ left: `${node.x}%`, top: `${node.y}%` }} key={node.id} onClick={() => onSelect(node.id)} aria-pressed={selected === node.id} aria-label={`${node.name}, ${node.status}`}>
          <span className="oa-node-pulse"/><span className="oa-node-core"><Icon name={node.platform === "Windows" ? "grid" : "terminal"} size={15}/></span><span className="oa-node-label"><strong>{node.name}</strong><small>{node.latency} ms</small></span>
        </button>
      ))}
      <div className="oa-map-legend"><span><i className="is-healthy"/> Healthy</span><span><i className="is-watch"/> Watch</span><span><i className="is-critical"/> Critical</span></div>
    </div>
  );
}

function FleetTable({ onSelect }: { onSelect: (id: string) => void }) {
  return (
    <div className="oa-table-wrap"><table className="oa-table">
      <thead><tr><th>Node</th><th>State</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Latency</th><th /></tr></thead>
      <tbody>{fleet.map((node) => (
        <tr key={node.id}>
          <td><button className="oa-node-name" onClick={() => onSelect(node.id)}><StatusDot status={node.status}/><span><strong>{node.name}</strong><small>{node.role}</small></span></button></td>
          <td><span className={`oa-state-label is-${node.status}`}>{node.status}</span></td>
          <td><span className="oa-value-pair"><MetricBar value={node.cpu} tone={node.cpu > 80 ? "red" : "blue"}/>{node.cpu}%</span></td>
          <td><span className="oa-value-pair"><MetricBar value={node.memory} tone={node.memory > 85 ? "amber" : "blue"}/>{node.memory}%</span></td>
          <td><span className="oa-value-pair"><MetricBar value={node.disk} tone={node.disk >= 90 ? "red" : "blue"}/>{node.disk}%</span></td>
          <td className="oa-mono">{node.latency} ms</td><td><button className="oa-row-action" onClick={() => onSelect(node.id)} aria-label={`Inspect ${node.name}`}><Icon name="chevron" size={16}/></button></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [selectedNodeId, setSelectedNodeId] = useState("field-win-07");
  const [live, setLive] = useState(true);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<"all" | Severity>("all");
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => { if (!live) return; const timer = window.setInterval(() => setTick((value) => value + 1), 3000); return () => window.clearInterval(timer); }, [live]);

  const selectedNode = fleet.find((node) => node.id === selectedNodeId) ?? fleet[0];
  const visibleIncidents = incidents.filter((incident) => filter === "all" || incident.severity === filter);
  const signalRate = 1184 + (tick % 6) * 7;
  const clock = new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Australia/Melbourne" });
  const selectNode = (id: string) => { setSelectedNodeId(id); setPanelOpen(true); };

  return (
    <main className="oa-shell">
      <aside className="oa-sidebar">
        <div className="oa-brand"><CompassMark/><span><strong>OpsAtlas</strong><small>COMMAND CONSOLE</small></span></div>
        <nav className="oa-nav" aria-label="Primary navigation"><p>WORKSPACE</p>{navItems.map((item) => <button key={item.id} className={view === item.id ? "is-active" : ""} onClick={() => setView(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "incidents" && <b>{incidents.length - acknowledged.length}</b>}</button>)}</nav>
        <div className="oa-side-spacer"/>
        <section className="oa-collector-card"><div><span className="oa-live-dot"/><strong>Collector online</strong></div><p>Last packet <span>{tick % 2 === 0 ? "now" : "2s ago"}</span></p><div className="oa-collector-line"><span style={{ width: `${72 + (tick % 4) * 5}%` }}/></div></section>
        <div className="oa-user"><span>RS</span><div><strong>Reed</strong><small>Workspace owner</small></div><button aria-label="Account settings">•••</button></div>
      </aside>

      <section className="oa-workspace">
        <header className="oa-topbar">
          <div className="oa-mobile-brand"><CompassMark/><strong>OpsAtlas</strong></div>
          <label className="oa-search"><Icon name="search" size={17}/><input aria-label="Search nodes and incidents" placeholder="Search fleet or incident…"/><kbd>⌘ K</kbd></label>
          <div className="oa-top-actions"><span className="oa-demo-badge">DEMO DATA</span><button className={`oa-live-toggle ${live ? "is-live" : ""}`} onClick={() => setLive((value) => !value)} aria-pressed={live}><Icon name={live ? "pause" : "play"} size={14}/>{live ? "Live" : "Paused"}</button><button className="oa-icon-button" aria-label="Notifications"><Icon name="bell" size={18}/><i/></button></div>
        </header>

        <div className="oa-content">
          <div className="oa-heading"><div><p>OPERATIONS / {view.toUpperCase()}</p><h1>{view === "overview" ? "System overview" : view === "fleet" ? "Fleet inventory" : view === "incidents" ? "Incident command" : "Detection rules"}</h1><span>{view === "overview" ? "A live readout of the systems that need your attention." : view === "fleet" ? "Every enrolled node, one operational picture." : view === "incidents" ? "Triage, acknowledge and follow the response trail." : "Deterministic thresholds. Visible outcomes."}</span></div><div className="oa-clock"><Icon name="clock" size={15}/><span suppressHydrationWarning>{clock}</span><small>AEST</small></div></div>

          {view === "overview" && <>
            <section className="oa-kpis" aria-label="Key metrics">
              <article><div className="oa-kpi-icon is-green"><Icon name="server"/></div><div><p>Nodes online</p><strong>24 <small>/ 25</small></strong><span className="is-good">↑ 1 recovered</span></div></article>
              <article><div className="oa-kpi-icon is-red"><Icon name="alert"/></div><div><p>Open incidents</p><strong>{incidents.length - acknowledged.length}</strong><span className="is-bad">1 critical</span></div></article>
              <article><div className="oa-kpi-icon is-blue"><Icon name="activity"/></div><div><p>Signals / min</p><strong>{signalRate.toLocaleString()}</strong><span className="is-good">↑ 3.2%</span></div></article>
              <article><div className="oa-kpi-icon is-violet"><Icon name="shield"/></div><div><p>Response latency</p><strong>34 <small>ms</small></strong><span>p95 · 71 ms</span></div></article>
            </section>
            <section className="oa-dashboard-grid">
              <article className="oa-card oa-map-card"><div className="oa-card-head"><div><p>LIVE TOPOLOGY</p><h2>Operational map</h2></div><span className="oa-signal"><i/> {signalRate.toLocaleString()} signals/min</span></div><Topology selected={selectedNodeId} onSelect={selectNode}/></article>
              <article className="oa-card oa-incident-card"><div className="oa-card-head"><div><p>RESPONSE QUEUE</p><h2>Active incidents</h2></div><button onClick={() => setView("incidents")}>View all <Icon name="chevron" size={13}/></button></div><div className="oa-incident-list">
                {incidents.map((incident) => { const isAck = acknowledged.includes(incident.id); return <button key={incident.id} className={`oa-incident is-${incident.severity} ${isAck ? "is-ack" : ""}`} onClick={() => { selectNode(incident.nodeId); setView("incidents"); }}><span className="oa-severity-rail"/><span className="oa-incident-main"><span><b>{incident.severity}</b><time>{incident.age}</time></span><strong>{incident.title}</strong><small>{incident.nodeId} · {incident.id}</small></span><Icon name={isAck ? "check" : "chevron"} size={15}/></button>; })}
              </div><div className="oa-incident-foot"><span><i className="is-critical"/>Critical <b>1</b></span><span><i className="is-watch"/>Elevated <b>2</b></span><span>Median acknowledge <b>6m 12s</b></span></div></article>
            </section>
            <article className="oa-card oa-fleet-card"><div className="oa-card-head"><div><p>FLEET HEALTH</p><h2>Recent telemetry</h2></div><button onClick={() => setView("fleet")}>Full inventory <Icon name="chevron" size={13}/></button></div><FleetTable onSelect={selectNode}/></article>
          </>}

          {view === "fleet" && <section className="oa-stack"><article className="oa-card oa-map-card is-wide"><div className="oa-card-head"><div><p>NETWORK VIEW</p><h2>Node relationships</h2></div><span className="oa-signal"><i/> 6 demo nodes</span></div><Topology selected={selectedNodeId} onSelect={selectNode}/></article><article className="oa-card oa-fleet-card"><div className="oa-card-head"><div><p>INVENTORY</p><h2>Enrolled nodes</h2></div><span className="oa-muted">Showing 6 of 25</span></div><FleetTable onSelect={selectNode}/></article></section>}

          {view === "incidents" && <section className="oa-incident-view">
            <article className="oa-card oa-queue-full"><div className="oa-card-head"><div><p>OPEN QUEUE</p><h2>Needs attention</h2></div><div className="oa-filters">{(["all", "critical", "high", "medium"] as const).map((item) => <button key={item} className={filter === item ? "is-active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div></div><div className="oa-detailed-incidents">
              {visibleIncidents.map((incident) => { const isAck = acknowledged.includes(incident.id); return <article key={incident.id} className={`oa-detailed-incident is-${incident.severity}`}><span className="oa-severity-rail"/><div className="oa-detailed-copy"><div><b>{incident.severity}</b><span>{incident.id}</span><time>{incident.age} ago</time></div><h3>{incident.title}</h3><p>{incident.detail}</p><button className="oa-link-button" onClick={() => selectNode(incident.nodeId)}>{incident.nodeId}<Icon name="chevron" size={13}/></button></div><button className={`oa-ack-button ${isAck ? "is-done" : ""}`} onClick={() => setAcknowledged((items) => isAck ? items.filter((id) => id !== incident.id) : [...items, incident.id])}><Icon name="check" size={15}/>{isAck ? "Acknowledged" : "Acknowledge"}</button></article>; })}
            </div></article>
            <aside className="oa-card oa-timeline"><div className="oa-card-head"><div><p>RESPONSE LOG</p><h2>Latest activity</h2></div></div><ol><li><i/><div><strong>Rule opened {incidents[0].id}</strong><p>Disk pressure crossed the critical threshold.</p><time>3 minutes ago</time></div></li><li><i/><div><strong>Collector verified signal</strong><p>Signature and timestamp accepted.</p><time>4 minutes ago</time></div></li><li><i/><div><strong>Node state changed</strong><p>field-win-07 moved from watch to critical.</p><time>4 minutes ago</time></div></li><li><i className="is-dim"/><div><strong>Baseline recalculated</strong><p>Seven-day latency window completed.</p><time>22 minutes ago</time></div></li></ol></aside>
          </section>}

          {view === "automation" && <section className="oa-rule-grid">
            {rules.map((rule, index) => <article className="oa-card oa-rule" key={rule.name}><div className={`oa-rule-icon ${index === 0 ? "is-triggered" : ""}`}><Icon name={index === 0 ? "alert" : "bolt"}/></div><div className="oa-rule-copy"><p>RULE {String(index + 1).padStart(2, "0")}</p><h2>{rule.name}</h2><dl><div><dt>When</dt><dd>{rule.condition}</dd></div><div><dt>Then</dt><dd>{rule.action}</dd></div></dl></div><footer><span className={rule.state === "Triggered" ? "is-triggered" : ""}><i/>{rule.state}</span><b>{rule.hits} hit{rule.hits === 1 ? "" : "s"} today</b></footer></article>)}
            <article className="oa-card oa-rule-note"><Icon name="shield" size={24}/><div><strong>Rules run in the control plane</strong><p>Agents report bounded health signals. They do not execute remote commands or collect file contents.</p></div></article>
          </section>}
        </div>
      </section>

      {panelOpen && <aside className="oa-inspector" aria-label={`Details for ${selectedNode.name}`}>
        <div className="oa-inspector-head"><div><StatusDot status={selectedNode.status}/><span><p>NODE DETAIL</p><h2>{selectedNode.name}</h2></span></div><button onClick={() => setPanelOpen(false)} aria-label="Close node details"><Icon name="x"/></button></div>
        <div className="oa-node-summary"><span className={`oa-node-avatar is-${selectedNode.status}`}><Icon name={selectedNode.platform === "Windows" ? "grid" : "terminal"} size={22}/></span><div><strong>{selectedNode.role}</strong><p>{selectedNode.platform} · {selectedNode.location}</p></div></div>
        <dl className="oa-facts"><div><dt>State</dt><dd className={`is-${selectedNode.status}`}><StatusDot status={selectedNode.status}/>{selectedNode.status}</dd></div><div><dt>Last signal</dt><dd>{live ? "2 seconds ago" : "Paused"}</dd></div><div><dt>Uptime</dt><dd>{selectedNode.uptime}</dd></div><div><dt>Round trip</dt><dd>{selectedNode.latency} ms</dd></div></dl>
        <section className="oa-inspector-metrics"><h3>Resource pressure</h3>{[{ label: "CPU", value: selectedNode.cpu }, { label: "Memory", value: selectedNode.memory }, { label: "Disk", value: selectedNode.disk }].map((metric) => <div key={metric.label}><span><b>{metric.label}</b><strong>{metric.value}%</strong></span><MetricBar value={metric.value} tone={metric.value >= 90 ? "red" : metric.value >= 80 ? "amber" : "blue"}/></div>)}</section>
        <section className="oa-signal-log"><div><h3>Signal trail</h3><span>last 5 min</span></div><svg viewBox="0 0 260 64" preserveAspectRatio="none" aria-label="Recent metric trend"><defs><linearGradient id="signal-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#54d5ff" stopOpacity=".3"/><stop offset="1" stopColor="#54d5ff" stopOpacity="0"/></linearGradient></defs><path className="oa-area" d="M0 50 C20 48 26 30 44 34 S75 45 90 28 120 44 136 27 165 16 180 25 210 40 225 20 246 18 260 12 V64 H0Z"/><path d="M0 50 C20 48 26 30 44 34 S75 45 90 28 120 44 136 27 165 16 180 25 210 40 225 20 246 18 260 12"/></svg></section>
        {selectedNode.status === "critical" ? <div className="oa-inspector-alert"><Icon name="alert"/><div><strong>Critical condition</strong><p>Disk usage has remained above 90% for three reporting windows.</p></div></div> : <div className="oa-inspector-ok"><Icon name="shield"/><div><strong>Telemetry verified</strong><p>Recent payloads passed signature and freshness checks.</p></div></div>}
        <p className="oa-privacy-note">Demo workspace · fictional infrastructure · no personal data</p>
      </aside>}
    </main>
  );
}
