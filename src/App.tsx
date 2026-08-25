import React, { useEffect, useMemo, useState, useCallback } from "react";
import { signOut } from "aws-amplify/auth";
import {
  getMe,
  listLeads,
  listStaff,
  listRMs,
  createLead as apiCreateLead,
  moveStage as apiMoveStage,
  addNote as apiAddNote,
  setFollowUp as apiSetFollowUp,
  listNotes,
  type Role,
} from "./leadClient";
import type { Schema } from "../amplify/data/resource";

// ============================================================
// ShubhDesk — Sales Pipeline for ShubhShree Knowledge Hub
// Production frontend, wired to Cognito + Amplify Data.
// Same UI as the prototype; data now comes from the backend.
// ============================================================

type Lead = Schema["Lead"]["type"];
type Note = Schema["Note"]["type"];
type Staff = Schema["StaffProfile"]["type"];

const STAGES = [
  { id: "new", label: "New Lead", color: "#6B7280" },
  { id: "calling", label: "Calling", color: "#0EA5E9" },
  { id: "contacted", label: "Contacted", color: "#3B82F6" },
  { id: "meeting", label: "Meeting / Consultation", color: "#8B5CF6" },
  { id: "followup", label: "Follow-up", color: "#F59E0B" },
  { id: "inprogress", label: "Deal In Progress", color: "#EAB308" },
  { id: "closed", label: "Deal Closed", color: "#15803D" },
  { id: "rejected", label: "Deal Rejected", color: "#DC2626" },
];
const SERVICES = ["Trading", "SIP", "Insurance", "Loans"] as const;
const SALES_STAGES = ["new", "calling", "contacted"];

const rupee = (n?: number | null) => "₹" + (n ?? 0).toLocaleString("en-IN");
const stageOf = (id?: string | null) => STAGES.find((s) => s.id === id) ?? STAGES[0];
const todayISO = () => new Date().toISOString().slice(0, 10);
const LOGO = "/shubhshree-logo.jpg"; // served from public/; for prod you can use https://app.shubhshreeknowledgehub.com/assets/logo.png

export default function App() {
  const [me, setMe] = useState<{ username: string; displayName: string; role: Role } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rms, setRms] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"board" | "list" | "followups">("board");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [filterService, setFilterService] = useState("All");

  // Resolve a username to a display name via the staff directory.
  const nameOf = useCallback(
    (username?: string | null) =>
      staff.find((s: Staff) => s.username === username)?.displayName ?? username ?? "—",
    [staff]
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [ls] = await Promise.all([listLeads()]);
      setLeads(ls);
    } catch (e) {
      setError("Couldn't load leads. Check your connection and try again.");
    }
  }, []);

  // Initial load.
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [meInfo, ls, st, rmList] = await Promise.all([
          getMe(),
          listLeads(),
          listStaff(),
          listRMs(),
        ]);
        setMe(meInfo);
        setLeads(ls);
        setStaff(st);
        setRms(rmList);
      } catch (e) {
        setError("Couldn't start ShubhDesk. Please refresh.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visibleLeads = useMemo(() => {
    if (!me) return [];
    let ls = leads;
    if (me.role !== "admin") {
      ls = ls.filter((l) => l.owner === me.username || l.sourcedBy === me.username);
    }
    if (filterService !== "All") ls = ls.filter((l) => l.service === filterService);
    return ls;
  }, [leads, me, filterService]);

  const dueLeads = useMemo(
    () => visibleLeads.filter((l) => l.followUpOn && l.followUpOn <= todayISO()),
    [visibleLeads]
  );

  const stats = useMemo(() => {
    const active = visibleLeads.filter((l) => !["closed", "rejected"].includes(l.stage ?? ""));
    const closed = visibleLeads.filter((l) => l.stage === "closed");
    return {
      total: visibleLeads.length,
      active: active.length,
      closed: closed.length,
      pipelineValue: active.reduce((s, l) => s + (l.value ?? 0), 0),
      wonValue: closed.reduce((s, l) => s + (l.value ?? 0), 0),
    };
  }, [visibleLeads]);

  function canEdit(lead: Lead) {
    if (!me) return false;
    if (me.role === "admin") return true;
    return lead.owner === me.username;
  }

  // ---- actions (optimistic where safe, then refetch) ----
  async function handleMove(lead: Lead, newStage: string, rmUsername?: string) {
    try {
      await apiMoveStage(lead, newStage, rmUsername);
      await refresh();
      setSelected((s) => (s && s.id === lead.id ? { ...s, stage: newStage as Lead["stage"], owner: rmUsername ?? s.owner } : s));
    } catch {
      setError("Couldn't update the stage. Please try again.");
    }
  }
  async function handleNote(leadId: string, text: string) {
    if (!text.trim()) return;
    try {
      await apiAddNote(leadId, text, "note");
    } catch {
      setError("Couldn't save your note.");
    }
  }
  async function handleFollowUp(leadId: string, date: string) {
    try {
      await apiSetFollowUp(leadId, date || null);
      await refresh();
      setSelected((s) => (s && s.id === leadId ? { ...s, followUpOn: date } : s));
    } catch {
      setError("Couldn't set the follow-up date.");
    }
  }
  async function handleCreate(input: any) {
    try {
      await apiCreateLead(input);
      await refresh();
    } catch {
      setError("Couldn't create the lead.");
    }
  }

  if (loading) {
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <style>{CSS}</style>
        <div style={{ textAlign: "center", color: "#07163F" }}>
          <img src={LOGO} alt="ShubhShree" style={{ height: 56, marginBottom: 16 }} />
          <div>Loading ShubhDesk…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.app}>
      <style>{CSS}</style>
      <Header me={me} />

      <div style={S.body}>
        {error && (
          <div style={S.errorBar}>
            {error} <button className="linkbtn" onClick={refresh}>Retry</button>
          </div>
        )}

        <StatBar stats={stats} />

        <div style={S.toolbar}>
          <div style={S.tabs}>
            <button className={view === "board" ? "tab active" : "tab"} onClick={() => setView("board")}>Pipeline Board</button>
            <button className={view === "list" ? "tab active" : "tab"} onClick={() => setView("list")}>My Leads</button>
            {(me?.role === "admin" || me?.role === "rm") && (
              <button className={view === "followups" ? "tab active" : "tab"} onClick={() => setView("followups")}>
                Follow-ups Due{dueLeads.length > 0 ? ` (${dueLeads.length})` : ""}
              </button>
            )}
          </div>
          <div style={S.filters}>
            <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="sel">
              <option>All</option>
              {SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <NewLeadButton onCreate={handleCreate} />
          </div>
        </div>

        {view === "board" ? (
          <Board leads={visibleLeads} onOpen={setSelected} nameOf={nameOf} />
        ) : view === "followups" ? (
          <FollowUpView leads={dueLeads} onOpen={setSelected} />
        ) : (
          <ListView leads={visibleLeads} onOpen={setSelected} />
        )}
      </div>

      {selected && (
        <LeadDrawer
          lead={selected}
          onClose={() => setSelected(null)}
          onMove={handleMove}
          onNote={handleNote}
          onFollowUp={handleFollowUp}
          canEdit={canEdit(selected)}
          nameOf={nameOf}
          rms={rms}
        />
      )}
    </div>
  );
}

function Header({ me }: { me: { displayName: string; role: Role } | null }) {
  return (
    <header style={S.header}>
      <div style={S.brand}>
        {/* Deploy: swap src to https://app.shubhshreeknowledgehub.com/assets/logo.png */}
        <img src={LOGO} alt="ShubhShree" style={S.logoImg}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        <div>
          <div style={S.brandName}>ShubhDesk</div>
          <div style={S.brandSub}>Sales Pipeline · ShubhShree Knowledge Hub</div>
        </div>
      </div>
      <div style={S.userSwitch}>
        {me && (
          <span style={S.whoami}>
            {me.displayName} <span style={S.roleTag}>{me.role.toUpperCase()}</span>
          </span>
        )}
        <button className="ghost sm" onClick={() => signOut()}>Sign out</button>
      </div>
    </header>
  );
}

function StatBar({ stats }: { stats: any }) {
  const items = [
    { label: "Total Leads", value: stats.total },
    { label: "Active", value: stats.active },
    { label: "Closed Won", value: stats.closed },
    { label: "Pipeline Value", value: rupee(stats.pipelineValue) },
    { label: "Won Value", value: rupee(stats.wonValue) },
  ];
  return (
    <div style={S.statBar}>
      {items.map((it) => (
        <div key={it.label} style={S.statCard}>
          <div style={S.statValue}>{it.value}</div>
          <div style={S.statLabel}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function Board({ leads, onOpen, nameOf }: { leads: Lead[]; onOpen: (l: Lead) => void; nameOf: (u?: string | null) => string }) {
  return (
    <div style={S.board}>
      {STAGES.map((stage) => {
        const items = leads.filter((l) => l.stage === stage.id);
        return (
          <div key={stage.id} style={S.column}>
            <div style={{ ...S.colHeader, borderTopColor: stage.color }}>
              <span style={S.colTitle}>{stage.label}</span>
              <span style={S.colCount}>{items.length}</span>
            </div>
            <div style={S.colBody}>
              {items.map((l) => <LeadCard key={l.id} lead={l} onOpen={onOpen} nameOf={nameOf} />)}
              {items.length === 0 && <div style={S.empty}>No leads</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeadCard({ lead, onOpen, nameOf }: { lead: Lead; onOpen: (l: Lead) => void; nameOf: (u?: string | null) => string }) {
  const st = stageOf(lead.stage);
  return (
    <div className="card" style={S.card} onClick={() => onOpen(lead)}>
      <div style={S.cardCode}>{lead.clientCode}</div>
      <div style={S.cardTop}>
        <span style={S.cardName}>{lead.client}</span>
        <span style={{ ...S.serviceTag, background: st.color + "22", color: st.color }}>{lead.service}</span>
      </div>
      <div style={S.cardValue}>{rupee(lead.value)}</div>
      <div style={S.cardMeta}>
        <span>{nameOf(lead.owner).split(" ")[0]}</span>
      </div>
    </div>
  );
}

function ListView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  return (
    <div style={S.list}>
      {leads.map((l) => {
        const st = stageOf(l.stage);
        return (
          <div key={l.id} className="row" style={S.listRow} onClick={() => onOpen(l)}>
            <div style={{ flex: 2 }}>
              <div style={S.cardCode}>{l.clientCode}</div>
              <div style={S.cardName}>{l.client}</div>
              <div style={S.rowPhone}>{l.phone}</div>
            </div>
            <div style={{ flex: 1 }}><span style={{ ...S.serviceTag, background: "#FBF3DC", color: "#8A6A1C" }}>{l.service}</span></div>
            <div style={{ flex: 1 }}><span style={{ ...S.stagePill, background: st.color }}>{st.label}</span></div>
            <div style={{ flex: 1, textAlign: "right", fontWeight: 600 }}>{rupee(l.value)}</div>
          </div>
        );
      })}
      {leads.length === 0 && <div style={S.empty}>No leads to show</div>}
    </div>
  );
}

function FollowUpView({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  return (
    <div>
      <div style={S.followBanner}>
        🔔 Win-back list — clients with a follow-up date due today or earlier. Reach out to try and regain them.
      </div>
      <div style={S.list}>
        {leads.map((l) => (
          <div key={l.id} className="row" style={S.listRow} onClick={() => onOpen(l)}>
            <div style={{ flex: 2 }}>
              <div style={S.cardCode}>{l.clientCode}</div>
              <div style={S.cardName}>{l.client}</div>
              <div style={S.rowPhone}>{l.phone} · {l.email}</div>
            </div>
            <div style={{ flex: 2 }}><div style={S.reqText}>{l.requirements || "—"}</div></div>
            <div style={{ flex: 1, textAlign: "right" }}>
              <div style={S.dueDate}>Due {l.followUpOn}</div>
              <div style={S.rowPhone}>was {stageOf(l.stage).label}</div>
            </div>
          </div>
        ))}
        {leads.length === 0 && <div style={S.empty}>No follow-ups due. Set a "revisit on" date on any lead to add it here.</div>}
      </div>
    </div>
  );
}

function LeadDrawer({
  lead, onClose, onMove, onNote, onFollowUp, canEdit, nameOf, rms,
}: {
  lead: Lead;
  onClose: () => void;
  onMove: (lead: Lead, stage: string, rm?: string) => void;
  onNote: (leadId: string, text: string) => void;
  onFollowUp: (leadId: string, date: string) => void;
  canEdit: boolean;
  nameOf: (u?: string | null) => string;
  rms: Staff[];
}) {
  const [noteText, setNoteText] = useState("");
  const [handoffFor, setHandoffFor] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const st = stageOf(lead.stage);

  // Load the activity log for this lead.
  useEffect(() => {
    let alive = true;
    setNotesLoading(true);
    listNotes(lead.id)
      .then((n) => { if (alive) setNotes(n); })
      .catch(() => { if (alive) setNotes([]); })
      .finally(() => { if (alive) setNotesLoading(false); });
    return () => { alive = false; };
  }, [lead.id, lead.stage]);

  function handleStageClick(targetStage: string) {
    if (!canEdit) return;
    if (targetStage === "meeting" && SALES_STAGES.includes(lead.stage ?? "")) {
      setHandoffFor(targetStage);
      return;
    }
    onMove(lead, targetStage);
  }

  async function submitNote() {
    if (!noteText.trim()) return;
    await onNote(lead.id, noteText);
    setNoteText("");
    // Refresh the local log.
    try { setNotes(await listNotes(lead.id)); } catch { /* ignore */ }
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.drawer} onClick={(e) => e.stopPropagation()}>
        <div style={S.drawerHead}>
          <div>
            <div style={S.codeChip}>{lead.clientCode}</div>
            <div style={S.drawerName}>{lead.client}</div>
            <div style={S.rowPhone}>{lead.phone} · {lead.service}</div>
            <div style={S.ownerLine}>
              Owner: <b>{nameOf(lead.owner)}</b>
              {lead.sourcedBy !== lead.owner && <span> · sourced by {nameOf(lead.sourcedBy).split(" ")[0]}</span>}
            </div>
          </div>
          <button className="xbtn" onClick={onClose}>✕</button>
        </div>

        {!canEdit && (
          <div style={S.readonlyBanner}>
            🔒 Read-only — this lead is now with {nameOf(lead.owner).split(" ")[0]}. You can follow its progress here.
          </div>
        )}

        <div style={S.drawerSection}>
          <div style={S.sectionLabel}>Client Details</div>
          <div style={S.detailRow}><span style={S.detailKey}>Phone</span><span>{lead.phone || "—"}</span></div>
          <div style={S.detailRow}><span style={S.detailKey}>Email</span><span>{lead.email || "—"}</span></div>
          <div style={S.detailRow}><span style={S.detailKey}>Wants</span><span style={{ textAlign: "right", maxWidth: 260 }}>{lead.requirements || "—"}</span></div>
        </div>

        <div style={S.drawerSection}>
          <div style={S.sectionLabel}>Current Stage</div>
          <span style={{ ...S.stagePill, background: st.color, fontSize: 14, padding: "6px 14px" }}>{st.label}</span>
        </div>

        <div style={S.drawerSection}>
          <div style={S.sectionLabel}>Win-back Follow-up</div>
          {canEdit ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" className="ninput" value={lead.followUpOn || ""}
                onChange={(e) => onFollowUp(lead.id, e.target.value)} style={{ maxWidth: 180 }} />
              {lead.followUpOn && <button className="ghost" onClick={() => onFollowUp(lead.id, "")}>Clear</button>}
            </div>
          ) : (
            <div style={S.rowPhone}>{lead.followUpOn ? `Revisit on ${lead.followUpOn}` : "No follow-up set"}</div>
          )}
          <div style={S.hint}>Set a date to revisit this client (e.g. 6 months out) — appears in "Follow-ups Due".</div>
        </div>

        {canEdit && (
          <div style={S.drawerSection}>
            <div style={S.sectionLabel}>Move to stage</div>
            <div style={S.stageGrid}>
              {STAGES.map((s) => (
                <button key={s.id} className="stagebtn"
                  style={{
                    borderColor: s.id === lead.stage ? s.color : "#E5E7EB",
                    background: s.id === lead.stage ? s.color + "15" : "#fff",
                    color: s.id === lead.stage ? s.color : "#374151",
                  }}
                  onClick={() => handleStageClick(s.id)}>
                  {s.label}{s.id === "meeting" && SALES_STAGES.includes(lead.stage ?? "") && " →RM"}
                </button>
              ))}
            </div>
            {SALES_STAGES.includes(lead.stage ?? "") && (
              <div style={S.hint}>Moving to "Meeting" hands the lead to an RM.</div>
            )}
          </div>
        )}

        <div style={S.drawerSection}>
          <div style={S.sectionLabel}>Activity Log</div>
          <div style={S.notes}>
            {notesLoading && <div style={S.empty}>Loading…</div>}
            {!notesLoading && notes.length === 0 && <div style={S.empty}>No activity yet</div>}
            {notes.slice().reverse().map((n) => (
              <div key={n.id} style={n.type === "system" ? S.sysNote : S.note}>
                <div style={n.type === "system" ? S.sysText : S.noteText}>
                  {n.type === "system" && "⚙ "}{n.text}
                </div>
                <div style={S.noteMeta}>{n.author} · {(n.createdAt ?? "").slice(0, 10)}</div>
              </div>
            ))}
          </div>
          {canEdit ? (
            <div style={S.noteInput}>
              <input className="ninput" placeholder="Add an update…" value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }} />
              <button className="addbtn" onClick={submitNote}>Add</button>
            </div>
          ) : (
            <div style={S.hint}>You can't add comments to a lead you've handed off.</div>
          )}
        </div>
      </div>

      {handoffFor && (
        <div style={S.overlay} onClick={() => setHandoffFor(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerName}>Hand off to RM</div>
            <div style={S.hint}>Pick the Relationship Manager who'll take this meeting. Ownership transfers to them.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {rms.length === 0 && <div style={S.empty}>No RMs found. Add RM staff profiles first.</div>}
              {rms.map((rm) => (
                <button key={rm.username} className="ghost" style={{ textAlign: "left" }}
                  onClick={() => { onMove(lead, "meeting", rm.username); setHandoffFor(null); }}>
                  {rm.displayName}
                </button>
              ))}
            </div>
            <button className="ghost" style={{ marginTop: 12 }} onClick={() => setHandoffFor(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewLeadButton({ onCreate }: { onCreate: (input: any) => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ client: "", phone: "", email: "", requirements: "", service: "SIP", value: "" });

  async function submit() {
    if (!form.client.trim()) return;
    setSaving(true);
    await onCreate({ ...form, value: Number(form.value) || 0 });
    setSaving(false);
    setForm({ client: "", phone: "", email: "", requirements: "", service: "SIP", value: "" });
    setOpen(false);
  }

  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>+ New Lead</button>
      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerName}>New Lead</div>
            <div style={S.hint}>A client code (SSKH-YYMM-NNN) is assigned automatically.</div>
            <input className="ninput" placeholder="Client name" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} style={S.mInput} />
            <input className="ninput" placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} style={S.mInput} />
            <input className="ninput" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={S.mInput} />
            <textarea className="ninput" placeholder="Requirements / what the client wants" value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} style={{ ...S.mInput, minHeight: 60, resize: "vertical", fontFamily: "inherit" }} />
            <select className="sel" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} style={S.mInput}>
              {SERVICES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <input className="ninput" placeholder="Estimated value (₹)" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} style={S.mInput} />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="primary" onClick={submit} disabled={saving} style={{ flex: 1, opacity: saving ? 0.6 : 1 }}>
                {saving ? "Creating…" : "Create Lead"}
              </button>
              <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- styles ----------
const S: Record<string, React.CSSProperties> = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#F5F4F0", minHeight: "100vh", color: "#0A1230" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", background: "#07163F", color: "#fff", position: "sticky", top: 0, zIndex: 10, borderBottom: "2px solid #E0AA3D" },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  logoImg: { height: 40, width: 40, borderRadius: 8, objectFit: "cover" },
  brandName: { fontWeight: 700, fontSize: 16, letterSpacing: ".3px" },
  brandSub: { fontSize: 11, color: "#C9A75A" },
  userSwitch: { display: "flex", alignItems: "center", gap: 12 },
  whoami: { fontSize: 13, color: "#fff", display: "flex", alignItems: "center", gap: 6 },
  roleTag: { fontSize: 10, fontWeight: 700, background: "#E0AA3D", color: "#07163F", padding: "2px 6px", borderRadius: 5 },
  body: { padding: 16, maxWidth: 1400, margin: "0 auto" },
  errorBar: { background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", fontSize: 13, padding: "10px 14px", borderRadius: 10, marginBottom: 12 },
  statBar: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 },
  statCard: { background: "#fff", borderRadius: 12, padding: "12px 16px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  statValue: { fontSize: 20, fontWeight: 700, color: "#07163F" },
  statLabel: { fontSize: 11, color: "#6B7280", marginTop: 2 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 },
  tabs: { display: "flex", gap: 4, background: "#E5E7EB", padding: 4, borderRadius: 10 },
  filters: { display: "flex", gap: 8, alignItems: "center" },
  board: { display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12 },
  column: { minWidth: 240, flex: "0 0 240px", background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.05)" },
  colHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderTop: "3px solid", borderRadius: "12px 12px 0 0" },
  colTitle: { fontSize: 13, fontWeight: 600 },
  colCount: { fontSize: 12, background: "#F3F4F6", borderRadius: 20, padding: "1px 8px", color: "#6B7280" },
  colBody: { padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 60 },
  card: { background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 12, cursor: "pointer" },
  cardCode: { fontSize: 10, fontWeight: 700, color: "#8A6A1C", letterSpacing: ".5px", marginBottom: 4 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardName: { fontWeight: 600, fontSize: 14 },
  serviceTag: { fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" },
  cardValue: { fontSize: 15, fontWeight: 700, marginTop: 6, color: "#07163F" },
  cardMeta: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#6B7280", marginTop: 8 },
  empty: { fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: 12 },
  list: { background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.05)" },
  listRow: { display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: "1px solid #F3F4F6", cursor: "pointer" },
  rowPhone: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  reqText: { fontSize: 12, color: "#374151", lineHeight: 1.4 },
  dueDate: { fontSize: 12, fontWeight: 700, color: "#B45309" },
  followBanner: { background: "#FBF3DC", border: "1px solid #EAD9A6", color: "#8A6A1C", fontSize: 13, padding: "10px 14px", borderRadius: 10, marginBottom: 12, lineHeight: 1.4 },
  stagePill: { color: "#fff", fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, display: "inline-block" },
  overlay: { position: "fixed", inset: 0, background: "rgba(7,22,63,.5)", display: "flex", justifyContent: "flex-end", zIndex: 50 },
  drawer: { width: "100%", maxWidth: 460, background: "#F9FAFB", height: "100%", overflowY: "auto", padding: 20, boxShadow: "-4px 0 20px rgba(0,0,0,.15)" },
  drawerHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  drawerName: { fontSize: 20, fontWeight: 700 },
  codeChip: { display: "inline-block", fontSize: 11, fontWeight: 700, color: "#8A6A1C", background: "#FBF3DC", padding: "2px 8px", borderRadius: 6, letterSpacing: ".5px", marginBottom: 6 },
  ownerLine: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  readonlyBanner: { background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E", fontSize: 12, padding: "10px 12px", borderRadius: 8, marginBottom: 18, lineHeight: 1.4 },
  drawerSection: { marginBottom: 22 },
  sectionLabel: { fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 8 },
  detailRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", borderBottom: "1px solid #F0EEE8", gap: 12 },
  detailKey: { color: "#6B7280", fontSize: 12, fontWeight: 600, minWidth: 50 },
  hint: { fontSize: 11, color: "#6B7280", marginTop: 8, fontStyle: "italic" },
  stageGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  notes: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 },
  note: { background: "#fff", borderRadius: 8, padding: "8px 12px", border: "1px solid #E5E7EB" },
  sysNote: { background: "#F1F5F9", borderRadius: 8, padding: "6px 12px", borderLeft: "3px solid #94A3B8" },
  noteText: { fontSize: 13 },
  sysText: { fontSize: 12, color: "#475569", fontWeight: 500 },
  noteMeta: { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
  noteInput: { display: "flex", gap: 8 },
  modal: { background: "#fff", borderRadius: 14, padding: 20, width: "90%", maxWidth: 380, margin: "auto", display: "flex", flexDirection: "column", gap: 4 },
  mInput: { marginTop: 8 },
};

const CSS = `
  * { box-sizing: border-box; }
  .tab { border: none; background: transparent; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #6B7280; cursor: pointer; }
  .tab.active { background: #fff; color: #07163F; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
  .sel { padding: 8px 12px; border-radius: 8px; border: 1px solid #D1D5DB; font-size: 13px; background: #fff; color: #111827; cursor: pointer; }
  .primary { background: #E0AA3D; color: #07163F; border: none; padding: 9px 16px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; }
  .primary:hover { background: #C9902A; }
  .ghost { background: #fff; border: 1px solid #D1D5DB; padding: 9px 16px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
  .ghost.sm { padding: 6px 12px; font-size: 12px; }
  .linkbtn { background: none; border: none; color: #991B1B; font-weight: 700; text-decoration: underline; cursor: pointer; font-size: 13px; }
  .card:hover { border-color: #E0AA3D; box-shadow: 0 2px 8px rgba(224,170,61,.20); }
  .row:hover { background: #FAF7EF; }
  .xbtn { border: none; background: #E5E7EB; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 14px; }
  .stagebtn { border: 1.5px solid; padding: 8px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; }
  .ninput { flex: 1; padding: 9px 12px; border: 1px solid #D1D5DB; border-radius: 8px; font-size: 13px; width: 100%; }
  .addbtn { background: #07163F; color: #fff; border: none; padding: 0 16px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
  @media (max-width: 640px) { .tab { padding: 8px 12px; } }
`;
