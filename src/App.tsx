import React, { useEffect, useMemo, useState, useCallback } from "react";
import { signOut } from "aws-amplify/auth";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
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
  friendlyError,
  type Role,
} from "./leadClient";
import { buildEmployeeReport, reportToCSV, downloadCSV, type ReportPeriod } from "./report";
import {
  listTrades,
  createTrade as apiCreateTrade,
  updateTrade as apiUpdateTrade,
  deleteTrade as apiDeleteTrade,
} from "./tradeClient";
import type { Schema } from "../amplify/data/resource";

// ============================================================
// ShubhDesk — Sales Pipeline for ShubhShree Knowledge Hub
// Production frontend, wired to Cognito + Amplify Data.
// Same UI as the prototype; data now comes from the backend.
// ============================================================

type Lead = Schema["Lead"]["type"];
type Note = Schema["Note"]["type"];
type Staff = Schema["StaffProfile"]["type"];
type Trade = Schema["Trade"]["type"];

const STAGES = [
  { id: "new", label: "New Lead", color: "#6B7280" },
  { id: "meeting", label: "Meeting / Consultation", color: "#8B5CF6" },
  { id: "followup", label: "Follow-up", color: "#F59E0B" },
  { id: "inprogress", label: "Deal In Progress", color: "#EAB308" },
  { id: "closed", label: "Deal Closed", color: "#15803D" },
  { id: "rejected", label: "Deal Rejected", color: "#DC2626" },
];
const SERVICES = ["Trading", "SIP", "Insurance", "Loans"] as const;
const SALES_STAGES = ["new"];

const SOURCES = [
  { id: "cold_call", label: "Cold Call" },
  { id: "referral", label: "Referral" },
  { id: "walk_in", label: "Walk-in" },
  { id: "existing_client", label: "Existing Client" },
  { id: "digital", label: "Digital/Social" },
  { id: "other", label: "Other" },
];

const REJECTION_REASONS = [
  { id: "not_interested", label: "Not Interested" },
  { id: "competitor", label: "Chose Competitor" },
  { id: "budget", label: "Budget" },
  { id: "bad_timing", label: "Bad Timing" },
  { id: "other", label: "Other" },
];

const rupee = (n?: number | null) => "₹" + (n ?? 0).toLocaleString("en-IN");
const stageOf = (id?: string | null) => STAGES.find((s) => s.id === id) ?? STAGES[0];
const sourceOf = (id?: string | null) => SOURCES.find((s) => s.id === id)?.label ?? id;
const reasonOf = (id?: string | null) => REJECTION_REASONS.find((r) => r.id === id)?.label ?? id;
const todayISO = () => new Date().toISOString().slice(0, 10);
const LOGO = "/shubhshree-logo.jpg"; // served from public/; for prod you can use https://app.shubhshreeknowledgehub.com/assets/logo.png

export default function App() {
  const [me, setMe] = useState<{ username: string; displayName: string; role: Role } | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rms, setRms] = useState<Staff[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<"board" | "list" | "followups" | "trades">("board");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [filterService, setFilterService] = useState("All");
  const [handoffPrompt, setHandoffPrompt] = useState<{ lead: Lead; targetStage: string } | null>(null);
  const [rejectPrompt, setRejectPrompt] = useState<{ lead: Lead } | null>(null);

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
      setError(friendlyError(e, "Couldn't load leads. Check your connection and try again."));
    }
  }, []);

  const refreshTrades = useCallback(async () => {
    setError(null);
    try {
      setTrades(await listTrades());
    } catch (e) {
      setError(friendlyError(e, "Couldn't load trades. Check your connection and try again."));
    }
  }, []);

  // Initial load. Dealers only ever need Trade data — no point loading
  // the entire lead pipeline for a role that can't see it. Admins get
  // both, since they get a Trades tab alongside the pipeline.
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const meInfo = await getMe();
        setMe(meInfo);
        if (meInfo.role === "dealer") {
          setTrades(await listTrades());
        } else {
          const [ls, st, rmList] = await Promise.all([listLeads(), listStaff(), listRMs()]);
          setLeads(ls);
          setStaff(st);
          setRms(rmList);
          if (meInfo.role === "admin") {
            setTrades(await listTrades());
          }
        }
      } catch (e) {
        setError(friendlyError(e, "Couldn't start ShubhDesk. Please refresh."));
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

  // Move a lead to a stage, routing through the RM-handoff prompt when
  // needed. Shared by the drawer's "Move to stage" buttons and the
  // board's drag-and-drop, so the handoff logic lives in one place.
  function requestMove(lead: Lead, targetStage: string) {
    if (!canEdit(lead) || targetStage === lead.stage) return;
    if (targetStage === "meeting" && SALES_STAGES.includes(lead.stage ?? "")) {
      setHandoffPrompt({ lead, targetStage });
      return;
    }
    if (targetStage === "rejected") {
      setRejectPrompt({ lead });
      return;
    }
    handleMove(lead, targetStage);
  }

  function confirmHandoff(rmUsername: string) {
    if (!handoffPrompt) return;
    handleMove(handoffPrompt.lead, handoffPrompt.targetStage, rmUsername);
    setHandoffPrompt(null);
  }

  function confirmReject(reason?: string) {
    if (!rejectPrompt) return;
    handleMove(rejectPrompt.lead, "rejected", undefined, reason);
    setRejectPrompt(null);
  }

  // ---- actions (optimistic where safe, then refetch) ----
  async function handleMove(lead: Lead, newStage: string, rmUsername?: string, rejectionReason?: string) {
    try {
      await apiMoveStage(lead, newStage, rmUsername, rejectionReason);
      await refresh();
      setSelected((s) => (s && s.id === lead.id
        ? { ...s, stage: newStage as Lead["stage"], owner: rmUsername ?? s.owner, rejectionReason: (rejectionReason as Lead["rejectionReason"]) ?? s.rejectionReason }
        : s));
    } catch (e) {
      setError(friendlyError(e, "Couldn't update the stage. Please try again."));
    }
  }
  async function handleNote(leadId: string, text: string) {
    if (!text.trim()) return;
    try {
      await apiAddNote(leadId, text, "note");
    } catch (e) {
      setError(friendlyError(e, "Couldn't save your note. Please try again."));
    }
  }
  async function handleFollowUp(leadId: string, date: string) {
    try {
      await apiSetFollowUp(leadId, date || null);
      await refresh();
      setSelected((s) => (s && s.id === leadId ? { ...s, followUpOn: date } : s));
    } catch (e) {
      setError(friendlyError(e, "Couldn't set the follow-up date. Please try again."));
    }
  }
  async function handleCreate(input: any): Promise<boolean> {
    try {
      await apiCreateLead(input);
      await refresh();
      return true;
    } catch (e) {
      setError(friendlyError(e, "Couldn't create the lead. Please check the details and try again."));
      return false;
    }
  }

  async function handleCreateTrade(input: { clientName: string; buyingLot?: string; brokerage?: number }): Promise<boolean> {
    try {
      await apiCreateTrade(input);
      await refreshTrades();
      return true;
    } catch (e) {
      setError(friendlyError(e, "Couldn't save the trade. Please check the details and try again."));
      return false;
    }
  }
  async function handleUpdateTrade(input: { id: string; clientName: string; buyingLot?: string; brokerage?: number }): Promise<boolean> {
    try {
      await apiUpdateTrade(input);
      await refreshTrades();
      return true;
    } catch (e) {
      setError(friendlyError(e, "Couldn't save the trade. Please check the details and try again."));
      return false;
    }
  }
  async function handleDeleteTrade(id: string) {
    try {
      await apiDeleteTrade(id);
      await refreshTrades();
    } catch (e) {
      setError(friendlyError(e, "Couldn't delete the trade. Please try again."));
    }
  }

  if (loading) {
    return (
      <div style={{ ...S.app, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <style>{CSS}</style>
        <div style={{ textAlign: "center", color: "#07163F" }}>
          <img src={LOGO} alt="ShubhShree" style={{ height: 56, marginBottom: 20, borderRadius: 10 }} />
          <div className="spinner" />
          <div style={{ fontSize: 13, fontWeight: 500, color: "#4B5563" }}>Loading ShubhDesk…</div>
        </div>
      </div>
    );
  }

  // Dealer is a standalone role — it never sees the Lead pipeline at
  // all, just its own minimal trade log.
  if (me?.role === "dealer") {
    return (
      <div style={S.app}>
        <style>{CSS}</style>
        <Header me={me} />
        <div style={S.body}>
          {error && (
            <div style={S.errorBar}>
              <span style={{ whiteSpace: "pre-line" }}>{error}</span>{" "}
              <button className="linkbtn" onClick={refreshTrades}>Retry</button>
            </div>
          )}
          <TradesView
            trades={trades}
            onCreate={handleCreateTrade}
            onUpdate={handleUpdateTrade}
            onDelete={handleDeleteTrade}
          />
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
            <span style={{ whiteSpace: "pre-line" }}>{error}</span>{" "}
            <button className="linkbtn" onClick={refresh}>Retry</button>
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
            {me?.role === "admin" && (
              <button className={view === "trades" ? "tab active" : "tab"} onClick={() => setView("trades")}>Trades</button>
            )}
          </div>
          <div style={S.filters}>
            {view !== "trades" && (
              <select value={filterService} onChange={(e) => setFilterService(e.target.value)} className="sel">
                <option>All</option>
                {SERVICES.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
            {me?.role === "admin" && view !== "trades" && <ReportButton leads={visibleLeads} staff={staff} />}
            {view !== "trades" && <NewLeadButton onCreate={handleCreate} />}
          </div>
        </div>

        {view === "board" ? (
          <Board leads={visibleLeads} onOpen={setSelected} nameOf={nameOf} onMove={requestMove} canEdit={canEdit} />
        ) : view === "followups" ? (
          <FollowUpView leads={dueLeads} onOpen={setSelected} />
        ) : view === "trades" ? (
          <TradesView
            trades={trades}
            onCreate={handleCreateTrade}
            onUpdate={handleUpdateTrade}
            onDelete={handleDeleteTrade}
          />
        ) : (
          <ListView leads={visibleLeads} onOpen={setSelected} />
        )}
      </div>

      {selected && (
        <LeadDrawer
          lead={selected}
          onClose={() => setSelected(null)}
          onMove={requestMove}
          onNote={handleNote}
          onFollowUp={handleFollowUp}
          canEdit={canEdit(selected)}
          nameOf={nameOf}
        />
      )}

      {handoffPrompt && (
        <div style={S.overlay} onClick={() => setHandoffPrompt(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerName}>Hand off to RM</div>
            <div style={S.hint}>Pick the Relationship Manager who'll take this meeting. Ownership transfers to them.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {rms.length === 0 && <div style={S.empty}>No RMs found. Add RM staff profiles first.</div>}
              {rms.map((rm) => (
                <button key={rm.username} className="ghost" style={{ textAlign: "left" }}
                  onClick={() => confirmHandoff(rm.username)}>
                  {rm.displayName}
                </button>
              ))}
            </div>
            <button className="ghost" style={{ marginTop: 12 }} onClick={() => setHandoffPrompt(null)}>Cancel</button>
          </div>
        </div>
      )}

      {rejectPrompt && (
        <div style={S.overlay} onClick={() => setRejectPrompt(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerName}>Why did they reject?</div>
            <div style={S.hint}>Optional — helps target win-back follow-ups later.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {REJECTION_REASONS.map((r) => (
                <button key={r.id} className="ghost" onClick={() => confirmReject(r.id)}>{r.label}</button>
              ))}
            </div>
            <button className="ghost" style={{ marginTop: 12 }} onClick={() => confirmReject(undefined)}>Skip</button>
          </div>
        </div>
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

function Board({ leads, onOpen, nameOf, onMove, canEdit }: {
  leads: Lead[];
  onOpen: (l: Lead) => void;
  nameOf: (u?: string | null) => string;
  onMove: (lead: Lead, stage: string) => void;
  canEdit: (lead: Lead) => boolean;
}) {
  const [activeLead, setActiveLead] = useState<Lead | null>(null);

  // Mouse needs a small move-distance before a drag starts (so a plain
  // click still opens the drawer); touch needs a short hold instead, so
  // a quick swipe still scrolls the column normally.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  function handleDragStart(e: DragStartEvent) {
    setActiveLead(leads.find((l) => l.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveLead(null);
    const lead = leads.find((l) => l.id === e.active.id);
    if (!lead || !e.over) return;
    onMove(lead, String(e.over.id));
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveLead(null)}>
      <div className="board">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage.id);
          return (
            <DroppableColumn key={stage.id} stage={stage} count={items.length}>
              {items.map((l) => (
                <DraggableLeadCard key={l.id} lead={l} onOpen={onOpen} nameOf={nameOf} draggable={canEdit(l)} />
              ))}
              {items.length === 0 && <div style={S.empty}>No leads</div>}
            </DroppableColumn>
          );
        })}
      </div>
      <DragOverlay>
        {activeLead ? <LeadCardVisual lead={activeLead} nameOf={nameOf} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({ stage, count, children }: { stage: (typeof STAGES)[number]; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div style={S.column}>
      <div style={{ ...S.colHeader, borderTopColor: stage.color, background: stage.color + "0F" }}>
        <span style={S.colTitle}>{stage.label}</span>
        <span style={S.colCount}>{count}</span>
      </div>
      <div ref={setNodeRef} style={{ ...S.colBody, ...(isOver ? S.colBodyDragOver : {}) }}>
        {children}
      </div>
    </div>
  );
}

function DraggableLeadCard({ lead, onOpen, nameOf, draggable }: {
  lead: Lead;
  onOpen: (l: Lead) => void;
  nameOf: (u?: string | null) => string;
  draggable?: boolean;
}) {
  // The moving visual is handled entirely by <DragOverlay>; this element
  // just fades in place as a placeholder while dragging.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id, disabled: !draggable });
  const style: React.CSSProperties = {
    opacity: isDragging ? 0.35 : 1,
    touchAction: draggable ? "none" : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} onClick={() => onOpen(lead)} {...(draggable ? { ...listeners, ...attributes } : {})}>
      <LeadCardVisual lead={lead} nameOf={nameOf} draggable={draggable} />
    </div>
  );
}

function LeadCardVisual({ lead, nameOf, draggable, dragging }: {
  lead: Lead;
  nameOf: (u?: string | null) => string;
  draggable?: boolean;
  dragging?: boolean;
}) {
  const st = stageOf(lead.stage);
  return (
    <div
      className="card"
      style={{
        ...S.card,
        borderLeftColor: st.color,
        cursor: draggable ? (dragging ? "grabbing" : "grab") : "pointer",
        ...(dragging ? { boxShadow: "0 14px 32px rgba(15,23,42,.28)", transform: "rotate(-1deg)" } : {}),
      }}
    >
      <div style={S.cardCode}>{lead.clientCode}</div>
      <div style={S.cardTop}>
        <span style={S.cardName}>{lead.client}</span>
        <span style={{ ...S.serviceTag, background: st.color + "1A", color: st.color }}>{lead.service}</span>
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
  lead, onClose, onMove, onNote, onFollowUp, canEdit, nameOf,
}: {
  lead: Lead;
  onClose: () => void;
  onMove: (lead: Lead, stage: string) => void;
  onNote: (leadId: string, text: string) => void;
  onFollowUp: (leadId: string, date: string) => void;
  canEdit: boolean;
  nameOf: (u?: string | null) => string;
}) {
  const [noteText, setNoteText] = useState("");
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
          <div style={S.detailRow}><span style={S.detailKey}>Source</span><span>{sourceOf(lead.source) || "—"}</span></div>
          <div style={S.detailRow}><span style={S.detailKey}>Wants</span><span style={{ textAlign: "right", maxWidth: 260 }}>{lead.requirements || "—"}</span></div>
        </div>

        <div style={S.drawerSection}>
          <div style={S.sectionLabel}>Current Stage</div>
          <span style={{ ...S.stagePill, background: st.color, fontSize: 14, padding: "6px 14px" }}>{st.label}</span>
          {lead.stage === "rejected" && lead.rejectionReason && (
            <div style={{ ...S.rowPhone, marginTop: 6 }}>Reason: {reasonOf(lead.rejectionReason)}</div>
          )}
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

        {canEdit && lead.stage === "new" && (
          <div style={S.drawerSection}>
            <div style={S.sectionLabel}>Did the client want to proceed?</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" style={{ flex: 1 }} onClick={() => handleStageClick("meeting")}>
                → Proceed to Meeting
              </button>
              <button className="ghost" style={{ flex: 1, borderColor: "#DC2626", color: "#DC2626" }} onClick={() => handleStageClick("rejected")}>
                ✕ Client Rejected
              </button>
            </div>
            <div style={S.hint}>Proceeding hands the lead to an RM. Rejecting records it as a lost lead under "Deal Rejected" — you can still set a win-back follow-up date below.</div>
          </div>
        )}

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
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={S.mInput}>
      <label style={S.formLabel}>
        {label} {required && <span style={S.req}>*</span>}
      </label>
      {children}
    </div>
  );
}

function TradesView({ trades, onCreate, onUpdate, onDelete }: {
  trades: Trade[];
  onCreate: (input: { clientName: string; buyingLot?: string; brokerage?: number }) => Promise<boolean>;
  onUpdate: (input: { id: string; clientName: string; buyingLot?: string; brokerage?: number }) => Promise<boolean>;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<Trade | "new" | null>(null);

  async function handleSave(input: { clientName: string; buyingLot?: string; brokerage?: number }) {
    const ok = editing === "new" ? await onCreate(input) : await onUpdate({ id: (editing as Trade).id, ...input });
    if (ok) setEditing(null);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button className="primary" onClick={() => setEditing("new")}>+ New Trade</button>
      </div>
      <div style={S.list}>
        <div style={{ ...S.listRow, cursor: "default" }}>
          <div style={{ flex: 2, fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".4px" }}>Client Name</div>
          <div style={{ flex: 2, fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".4px" }}>Buying Lot</div>
          <div style={{ flex: 1, textAlign: "right", fontSize: 11, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".4px" }}>Brokerage</div>
          <div style={{ width: 66 }} />
        </div>
        {trades.map((t) => (
          <div key={t.id} className="row" style={S.listRow}>
            <div style={{ flex: 2, fontWeight: 600, cursor: "pointer" }} onClick={() => setEditing(t)}>{t.clientName}</div>
            <div style={{ flex: 2, color: "#374151", cursor: "pointer" }} onClick={() => setEditing(t)}>{t.buyingLot || "—"}</div>
            <div style={{ flex: 1, textAlign: "right", fontWeight: 600, cursor: "pointer" }} onClick={() => setEditing(t)}>{rupee(t.brokerage)}</div>
            <div style={{ width: 66, textAlign: "right" }}>
              <button className="ghost sm" onClick={() => onDelete(t.id)}>Delete</button>
            </div>
          </div>
        ))}
        {trades.length === 0 && <div style={S.empty}>No trades yet. Click "+ New Trade" to log one.</div>}
      </div>

      {editing && (
        <TradeModal
          trade={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function TradeModal({ trade, onClose, onSave }: {
  trade: Trade | null;
  onClose: () => void;
  onSave: (input: { clientName: string; buyingLot?: string; brokerage?: number }) => Promise<void>;
}) {
  const [clientName, setClientName] = useState(trade?.clientName ?? "");
  const [buyingLot, setBuyingLot] = useState(trade?.buyingLot ?? "");
  const [brokerage, setBrokerage] = useState(trade?.brokerage != null ? String(trade.brokerage) : "");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const name = clientName.trim();
    if (!name) { setFormError("Client name is required."); return; }
    setFormError(null);
    setSaving(true);
    await onSave({ clientName: name, buyingLot: buyingLot.trim() || undefined, brokerage: Number(brokerage) || 0 });
    setSaving(false);
  }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.drawerName}>{trade ? "Edit Trade" : "New Trade"}</div>
        <Field label="Client Name" required>
          <input className="ninput" placeholder="e.g. Rohan Mehta" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label="Buying Lot">
          <input className="ninput" placeholder="e.g. RELIANCE - 10 lots" value={buyingLot} onChange={(e) => setBuyingLot(e.target.value)} />
        </Field>
        <Field label="Brokerage (₹)">
          <input className="ninput" placeholder="e.g. 500" value={brokerage} onChange={(e) => setBrokerage(e.target.value)} />
        </Field>
        {formError && <div style={S.formError}>{formError}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="primary" onClick={submit} disabled={saving} style={{ flex: 1, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ReportButton({ leads, staff }: { leads: Lead[]; staff: Staff[] }) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<ReportPeriod>("thisMonth");

  function download() {
    const { rows, range } = buildEmployeeReport(leads, staff, period);
    const csv = reportToCSV(rows);
    const filename = `shubhdesk-report-${range.label.replace(/\s+/g, "-").toLowerCase()}_${range.start}_to_${range.end}.csv`;
    downloadCSV(filename, csv);
    setOpen(false);
  }

  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)}>⬇ Report</button>
      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerName}>Download Employee Report</div>
            <div style={S.hint}>A CSV summary of each employee's leads sourced, deals closed, handoffs, and current pipeline.</div>
            <Field label="Period">
              <select className="sel" value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)} style={{ width: "100%" }}>
                <option value="thisWeek">This Week</option>
                <option value="thisMonth">This Month</option>
                <option value="lastMonth">Last Month</option>
              </select>
            </Field>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="primary" onClick={download} style={{ flex: 1 }}>Download CSV</button>
              <button className="ghost" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NewLeadButton({ onCreate }: { onCreate: (input: any) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ client: "", phone: "", email: "", requirements: "", service: "SIP", value: "", source: "cold_call" });

  async function submit() {
    const client = form.client.trim();
    const email = form.email.trim();
    if (!client) { setFormError("Client name is required."); return; }
    if (!email) { setFormError("Email is required."); return; }
    if (!EMAIL_RE.test(email)) { setFormError("Please enter a valid email address (e.g. name@example.com)."); return; }

    setFormError(null);
    setSaving(true);
    const ok = await onCreate({ ...form, client, email, value: Number(form.value) || 0 });
    setSaving(false);
    if (ok) {
      setForm({ client: "", phone: "", email: "", requirements: "", service: "SIP", value: "", source: "cold_call" });
      setOpen(false);
    }
  }

  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>+ New Lead</button>
      {open && (
        <div style={S.overlay} onClick={() => setOpen(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.drawerName}>New Lead</div>
            <div style={S.hint}>A client code (SSKH-YYMM-NNN) is assigned automatically. Fields marked <span style={S.req}>*</span> are required.</div>
            <Field label="Client name" required>
              <input className="ninput" placeholder="e.g. Rohan Mehta" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input className="ninput" placeholder="e.g. 9876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Email" required>
              <input className="ninput" placeholder="e.g. name@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Requirements">
              <textarea className="ninput" placeholder="What the client wants" value={form.requirements} onChange={(e) => setForm({ ...form, requirements: e.target.value })} style={{ minHeight: 60, resize: "vertical", fontFamily: "inherit" }} />
            </Field>
            <Field label="Service">
              <select className="sel" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} style={{ width: "100%" }}>
                {SERVICES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select className="sel" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} style={{ width: "100%" }}>
                {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Estimated value (₹)">
              <input className="ninput" placeholder="e.g. 50000" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
            </Field>
            {formError && <div style={S.formError}>{formError}</div>}
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
// A small, consistent set of tokens (shadows, radii) instead of ad hoc
// values scattered per element — keeps depth/roundness coherent across
// cards, columns, modals, and the drawer.
const SHADOW = {
  xs: "0 1px 2px rgba(15,23,42,.06)",
  sm: "0 1px 3px rgba(15,23,42,.08)",
  md: "0 8px 20px rgba(15,23,42,.12)",
  lg: "0 16px 40px rgba(15,23,42,.20)",
};
const RADIUS = { sm: 8, md: 10, lg: 14, pill: 999 };

const S: Record<string, React.CSSProperties> = {
  app: { fontFamily: "'Inter', system-ui, sans-serif", background: "#F6F7F9", minHeight: "100vh", color: "#111827", WebkitFontSmoothing: "antialiased" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 24px", background: "#07163F", color: "#fff", position: "sticky", top: 0, zIndex: 10, boxShadow: "0 2px 0 #E0AA3D, 0 4px 16px rgba(7,22,63,.25)" },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  logoImg: { height: 38, width: 38, borderRadius: RADIUS.sm, objectFit: "cover" },
  brandName: { fontWeight: 700, fontSize: 16, letterSpacing: ".2px" },
  brandSub: { fontSize: 11, color: "#C9A75A", marginTop: 1 },
  userSwitch: { display: "flex", alignItems: "center", gap: 14 },
  whoami: { fontSize: 13, color: "#fff", display: "flex", alignItems: "center", gap: 8 },
  roleTag: { fontSize: 10, fontWeight: 700, background: "#E0AA3D", color: "#07163F", padding: "3px 8px", borderRadius: RADIUS.pill, letterSpacing: ".4px" },
  body: { padding: "20px 24px 32px", maxWidth: 1440, margin: "0 auto" },
  errorBar: { background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", fontSize: 13, padding: "12px 16px", borderRadius: RADIUS.md, marginBottom: 16, boxShadow: SHADOW.xs },
  statBar: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 20 },
  statCard: { background: "#fff", borderRadius: RADIUS.lg, padding: "14px 18px", boxShadow: SHADOW.xs, border: "1px solid #EEF0F3" },
  statValue: { fontSize: 22, fontWeight: 700, color: "#07163F", lineHeight: 1.2, letterSpacing: "-.2px" },
  statLabel: { fontSize: 11, color: "#6B7280", marginTop: 4, fontWeight: 500 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 },
  tabs: { display: "flex", gap: 4, background: "#EBEDF1", padding: 4, borderRadius: RADIUS.md },
  filters: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  column: { background: "#fff", borderRadius: RADIUS.lg, boxShadow: SHADOW.sm, border: "1px solid #EEF0F3", display: "flex", flexDirection: "column", minHeight: 0 },
  colHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderTop: "3px solid", borderRadius: `${RADIUS.lg}px ${RADIUS.lg}px 0 0` },
  colTitle: { fontSize: 12.5, fontWeight: 700, letterSpacing: ".1px" },
  colCount: { fontSize: 11, fontWeight: 600, background: "rgba(15,23,42,.06)", borderRadius: RADIUS.pill, padding: "2px 9px", color: "#4B5563" },
  colBody: { padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 80, borderRadius: `0 0 ${RADIUS.lg}px ${RADIUS.lg}px`, transition: "background .12s ease" },
  colBodyDragOver: { background: "#FBF3DC", outline: "2px dashed #E0AA3D", outlineOffset: -6 },
  card: { background: "#fff", border: "1px solid #EEF0F3", borderLeft: "3px solid transparent", borderRadius: RADIUS.md, padding: "12px 13px", cursor: "pointer", transition: "box-shadow .15s ease, transform .15s ease, border-color .15s ease" },
  cardCode: { fontSize: 10, fontWeight: 700, color: "#8A6A1C", letterSpacing: ".5px", marginBottom: 5 },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  cardName: { fontWeight: 600, fontSize: 14, color: "#111827" },
  serviceTag: { fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: RADIUS.sm, whiteSpace: "nowrap" },
  cardValue: { fontSize: 15, fontWeight: 700, marginTop: 7, color: "#07163F", letterSpacing: "-.1px" },
  cardMeta: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "#6B7280", marginTop: 9, paddingTop: 9, borderTop: "1px solid #F3F4F6" },
  empty: { fontSize: 12, color: "#9CA3AF", textAlign: "center", padding: "16px 12px", border: "1px dashed #E5E7EB", borderRadius: RADIUS.sm },
  list: { background: "#fff", borderRadius: RADIUS.lg, overflow: "hidden", boxShadow: SHADOW.sm, border: "1px solid #EEF0F3" },
  listRow: { display: "flex", alignItems: "center", gap: 12, padding: "16px 18px", borderBottom: "1px solid #F3F4F6", cursor: "pointer", transition: "background .12s ease" },
  rowPhone: { fontSize: 12, color: "#6B7280", marginTop: 2 },
  reqText: { fontSize: 12, color: "#374151", lineHeight: 1.4 },
  dueDate: { fontSize: 12, fontWeight: 700, color: "#B45309" },
  followBanner: { background: "#FBF3DC", border: "1px solid #EAD9A6", color: "#8A6A1C", fontSize: 13, padding: "12px 16px", borderRadius: RADIUS.md, marginBottom: 16, lineHeight: 1.4 },
  stagePill: { color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "4px 11px", borderRadius: RADIUS.pill, display: "inline-block", letterSpacing: ".2px" },
  overlay: { position: "fixed", inset: 0, background: "rgba(7,22,63,.55)", display: "flex", justifyContent: "flex-end", zIndex: 50, backdropFilter: "blur(1px)" },
  drawer: { width: "100%", maxWidth: 460, background: "#F9FAFB", height: "100%", overflowY: "auto", padding: 24, boxShadow: SHADOW.lg },
  drawerHead: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 },
  drawerName: { fontSize: 20, fontWeight: 700, letterSpacing: "-.2px" },
  codeChip: { display: "inline-block", fontSize: 11, fontWeight: 700, color: "#8A6A1C", background: "#FBF3DC", padding: "3px 9px", borderRadius: RADIUS.sm, letterSpacing: ".5px", marginBottom: 7 },
  ownerLine: { fontSize: 12, color: "#6B7280", marginTop: 6 },
  readonlyBanner: { background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E", fontSize: 12, padding: "10px 12px", borderRadius: RADIUS.sm, marginBottom: 18, lineHeight: 1.4 },
  drawerSection: { marginBottom: 24 },
  sectionLabel: { fontSize: 11.5, fontWeight: 700, color: "#6B7280", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 9 },
  detailRow: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "7px 0", borderBottom: "1px solid #F0EEE8", gap: 12 },
  detailKey: { color: "#6B7280", fontSize: 12, fontWeight: 600, minWidth: 50 },
  hint: { fontSize: 11, color: "#6B7280", marginTop: 8, fontStyle: "italic" },
  stageGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  notes: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 },
  note: { background: "#fff", borderRadius: RADIUS.sm, padding: "9px 12px", border: "1px solid #EEF0F3" },
  sysNote: { background: "#F1F5F9", borderRadius: RADIUS.sm, padding: "7px 12px", borderLeft: "3px solid #94A3B8" },
  noteText: { fontSize: 13 },
  sysText: { fontSize: 12, color: "#475569", fontWeight: 500 },
  noteMeta: { fontSize: 11, color: "#9CA3AF", marginTop: 4 },
  noteInput: { display: "flex", gap: 8 },
  modal: { background: "#fff", borderRadius: RADIUS.lg, padding: 22, width: "90%", maxWidth: 380, margin: "auto", display: "flex", flexDirection: "column", gap: 4, boxShadow: SHADOW.lg },
  mInput: { marginTop: 8 },
  formLabel: { fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 4, display: "block" },
  req: { color: "#DC2626" },
  formError: { fontSize: 12, color: "#991B1B", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: RADIUS.sm, padding: "8px 10px", marginTop: 10 },
};

const CSS = `
  * { box-sizing: border-box; }
  ::selection { background: rgba(224,170,61,.35); }
  .tab { border: none; background: transparent; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #6B7280; cursor: pointer; transition: background .12s ease, color .12s ease; }
  .tab:hover { color: #07163F; }
  .tab.active { background: #fff; color: #07163F; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
  .sel, .ninput { padding: 9px 12px; border-radius: 8px; border: 1px solid #D1D5DB; font-size: 13px; background: #fff; color: #111827; transition: border-color .12s ease, box-shadow .12s ease; }
  .sel { cursor: pointer; }
  .sel:hover, .ninput:hover { border-color: #B8BFC9; }
  .sel:focus, .ninput:focus { outline: none; border-color: #E0AA3D; box-shadow: 0 0 0 3px rgba(224,170,61,.18); }
  .primary { background: #E0AA3D; color: #07163F; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; transition: background .12s ease, transform .08s ease; }
  .primary:hover { background: #C9902A; }
  .primary:active { transform: translateY(1px); }
  .primary:disabled { cursor: not-allowed; }
  .ghost { background: #fff; border: 1px solid #D1D5DB; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: border-color .12s ease, background .12s ease, transform .08s ease; }
  .ghost:hover { border-color: #07163F; background: #FAFAFB; }
  .ghost:active { transform: translateY(1px); }
  .ghost.sm { padding: 7px 12px; font-size: 12px; }
  .linkbtn { background: none; border: none; color: #991B1B; font-weight: 700; text-decoration: underline; cursor: pointer; font-size: 13px; }
  .card:hover { border-color: #E0AA3D; box-shadow: 0 6px 16px rgba(15,23,42,.10); transform: translateY(-1px); }
  .card:active { transform: translateY(0); }
  .row:hover { background: #FAFAFB; }
  .xbtn { border: none; background: #EBEDF1; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; font-size: 14px; transition: background .12s ease; }
  .xbtn:hover { background: #E0AA3D; color: #07163F; }
  .stagebtn { border: 1.5px solid; padding: 9px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; text-align: left; transition: transform .08s ease, box-shadow .12s ease; }
  .stagebtn:hover { box-shadow: 0 2px 8px rgba(15,23,42,.08); }
  .addbtn { background: #07163F; color: #fff; border: none; padding: 0 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; transition: background .12s ease; }
  .addbtn:hover { background: #0F1F52; }
  button:focus-visible, .ninput:focus-visible, .sel:focus-visible { outline: 2px solid #E0AA3D; outline-offset: 2px; }

  .board { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
  @media (max-width: 1000px) { .board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 640px) { .board { grid-template-columns: 1fr; } .tab { padding: 8px 12px; } }

  .spinner { width: 28px; height: 28px; margin: 0 auto 14px; border: 3px solid rgba(7,22,63,.12); border-top-color: #E0AA3D; border-radius: 50%; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
