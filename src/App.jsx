import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase.js";

/* ============================================================
   DESIGN TOKENS — edit these to restyle the whole app
   ============================================================ */
const T = {
  font: "'Inter', system-ui, -apple-system, sans-serif",
  bg: "#ffffff",
  text: "#111111",
  textSoft: "#6b6b6b",
  cell: "#d9d9d9",
  water: "#99d2f7",
  waterDeep: "#7cc3f2",
  done: "#5fd8a8",
  outline: "#4da3e8",
  radius: 12,
};

/* ---------- helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayKey = () => dateKey(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const MONTHS_SHORT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const DOW = ["sun","mon","tue","wed","thu","fri","sat"];

const OZ_TO_ML = 29.5735;
const toDisplay = (oz, unit) => (unit === "ml" ? Math.round(oz * OZ_TO_ML) : Math.round(oz));
const fromDisplay = (val, unit) => (unit === "ml" ? val / OZ_TO_ML : val);
const fmt = (oz, unit) => `${toDisplay(oz, unit).toLocaleString()} ${unit}`;
const PRESETS_BY_UNIT = {
  oz: [{ label: "sip", amt: 4 }, { label: "glass", amt: 8 }, { label: "bottle", amt: 16 }, { label: "big bottle", amt: 32 }],
  ml: [{ label: "sip", amt: 100 }, { label: "glass", amt: 250 }, { label: "bottle", amt: 500 }, { label: "big bottle", amt: 1000 }],
};

function calculateDailyGoal(weight, gender, unit) {
  const lbs = unit === "kg" ? weight * 2.205 : weight;
  let base = lbs * 0.5;
  if (gender === "female") base *= 0.95;
  if (gender === "other") base *= 0.975;
  return Math.round(base);
}

function dayPercent(entry) {
  if (!entry || !entry.goal) return 0;
  return Math.min(100, Math.round((entry.consumed / entry.goal) * 100));
}

function computeStreak(history) {
  let streak = 0;
  let d = new Date();
  if (dayPercent(history[dateKey(d)]) < 100) d = addDays(d, -1);
  while (dayPercent(history[dateKey(d)]) >= 100) { streak++; d = addDays(d, -1); }
  return streak;
}

function computeLongestStreak(history) {
  const days = Object.keys(history).filter((k) => dayPercent(history[k]) >= 100).sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    const d = new Date(k + "T00:00:00");
    run = prev && dateKey(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  return best;
}

const computeTotalOz = (history) => Object.values(history).reduce((s, e) => s + (e.consumed || 0), 0);

/* ============================================================
   AVATAR CROPPER — pick a photo, drag to position, crop circular
   ============================================================ */
function AvatarCropper({ onSave, onCancel }) {
  const [img, setImg] = useState(null);
  const [drag, setDrag] = useState(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const canvasRef = useRef(null);
  const SIZE = 200;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const i = new Image();
      i.onload = () => {
        const s = SIZE / Math.min(i.width, i.height);
        setScale(s);
        setOffset({ x: (SIZE - i.width * s) / 2, y: (SIZE - i.height * s) / 2 });
        setImg(i);
      };
      i.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const startDrag = (e) => {
    e.preventDefault();
    const pt = e.touches ? e.touches[0] : e;
    setDrag({ sx: pt.clientX - offset.x, sy: pt.clientY - offset.y });
  };
  const onDrag = useCallback((e) => {
    if (!drag) return;
    const pt = e.touches ? e.touches[0] : e;
    setOffset({ x: pt.clientX - drag.sx, y: pt.clientY - drag.sy });
  }, [drag]);
  const endDrag = () => setDrag(null);

  useEffect(() => {
    if (!drag) return;
    window.addEventListener("mousemove", onDrag);
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchmove", onDrag);
    window.addEventListener("touchend", endDrag);
    return () => { window.removeEventListener("mousemove", onDrag); window.removeEventListener("mouseup", endDrag); window.removeEventListener("touchmove", onDrag); window.removeEventListener("touchend", endDrag); };
  }, [drag, onDrag]);

  const handleZoom = (e) => {
    if (!img) return;
    const newScale = parseFloat(e.target.value);
    const cx = SIZE / 2, cy = SIZE / 2;
    setOffset({
      x: cx - (cx - offset.x) * (newScale / scale),
      y: cy - (cy - offset.y) * (newScale / scale),
    });
    setScale(newScale);
  };

  const crop = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    c.width = SIZE; c.height = SIZE;
    ctx.beginPath(); ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(img, offset.x, offset.y, img.width * scale, img.height * scale);
    onSave(c.toDataURL("image/jpeg", 0.85));
  };

  const minScale = img ? SIZE / Math.max(img.width, img.height) * 0.5 : 0.1;
  const maxScale = img ? SIZE / Math.min(img.width, img.height) * 3 : 5;

  return (
    <div style={{ fontFamily: T.font }}>
      {!img ? (
        <label style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: SIZE, height: SIZE, margin: "0 auto", borderRadius: "50%",
          border: `2px dashed ${T.cell}`, cursor: "pointer", color: T.textSoft, fontSize: 14,
        }}>
          tap to choose photo
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
        </label>
      ) : (
        <>
          <div style={{
            width: SIZE, height: SIZE, margin: "0 auto", borderRadius: "50%", overflow: "hidden",
            position: "relative", cursor: "grab", touchAction: "none",
            border: `3px solid ${T.outline}`,
          }} onMouseDown={startDrag} onTouchStart={startDrag}>
            <img src={img.src} alt="" draggable={false} style={{
              position: "absolute", left: offset.x, top: offset.y,
              width: img.width * scale, height: img.height * scale,
              pointerEvents: "none", userSelect: "none",
            }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, justifyContent: "center" }}>
            <span style={{ fontSize: 12, color: T.textSoft }}>-</span>
            <input type="range" min={minScale} max={maxScale} step={0.005} value={scale} onChange={handleZoom}
              style={{ width: 140, accentColor: T.outline }} />
            <span style={{ fontSize: 12, color: T.textSoft }}>+</span>
          </div>
          <p style={{ fontSize: 12, color: T.textSoft, textAlign: "center", margin: "6px 0 0" }}>drag to reposition, slide to zoom</p>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={onCancel} style={{ flex: 1, padding: 11, borderRadius: T.radius, border: `1.5px solid ${T.cell}`, background: "#fff", color: T.text, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>cancel</button>
            <button onClick={crop} style={{ flex: 1, padding: 11, borderRadius: T.radius, border: "none", background: T.text, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>save</button>
          </div>
        </>
      )}
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}

/* ============================================================
   GLASS
   ============================================================ */
function Glass({ percent, consumed, goal, unit, splashKey }) {
  const W = 220, H = 300, top = 18, bottom = 282;
  const pct = Math.min(percent, 100) / 100;
  const waterY = bottom - (bottom - top) * pct;
  const full = percent >= 100;
  const glassPath = `M 40 ${top} L 180 ${top} L 166 ${bottom - 14} Q 164 ${bottom} 150 ${bottom} L 70 ${bottom} Q 56 ${bottom} 54 ${bottom - 14} Z`;
  const waveColor = full ? T.done : T.water;

  return (
    <div style={{ position: "relative", width: W, height: H, margin: "0 auto" }}>
      <style>{`
        @keyframes hydrate-wave { from { transform: translateX(0); } to { transform: translateX(-120px); } }
        @keyframes hydrate-bubble { 0% { transform: translateY(0); opacity: 0; } 20% { opacity: .8; } 100% { transform: translateY(-140px); opacity: 0; } }
        @keyframes hydrate-splash { 0% { transform: scale(1); } 30% { transform: scale(1.04, .97); } 60% { transform: scale(.98, 1.03); } 100% { transform: scale(1); } }
        @media (prefers-reduced-motion: reduce) { .hydrate-anim { animation: none !important; } }
      `}</style>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        className={splashKey ? "hydrate-anim" : ""}
        style={{ display: "block", animation: splashKey ? "hydrate-splash .6s ease" : "none", transformOrigin: "50% 90%" }}
        key={splashKey}>
        <defs><clipPath id="glassClip"><path d={glassPath} /></clipPath></defs>
        <path d={glassPath} fill={T.cell} />
        <g clipPath="url(#glassClip)">
          <rect x="0" y={waterY} width={W} height={H} fill={waveColor}
            style={{ transition: "y .9s cubic-bezier(.4,0,.2,1), fill .4s" }} />
          <g style={{ transition: "transform .9s cubic-bezier(.4,0,.2,1)", transform: `translateY(${waterY}px)` }}>
            <path className="hydrate-anim" fill={waveColor}
              d="M -120 0 Q -90 -7 -60 0 T 0 0 T 60 0 T 120 0 T 180 0 T 240 0 T 300 0 T 360 0 L 360 20 L -120 20 Z"
              style={{ animation: "hydrate-wave 2.2s linear infinite" }} />
            <path className="hydrate-anim" fill={full ? "#4fcf9a" : T.waterDeep} opacity=".55"
              d="M -120 2 Q -90 -4 -60 2 T 0 2 T 60 2 T 120 2 T 180 2 T 240 2 T 300 2 T 360 2 L 360 20 L -120 20 Z"
              style={{ animation: "hydrate-wave 3.1s linear infinite reverse" }} />
          </g>
          {splashKey > 0 && [0, 1, 2, 3, 4].map((i) => (
            <circle key={`${splashKey}-${i}`} className="hydrate-anim"
              cx={80 + i * 15} cy={bottom - 10 - (i % 2) * 12} r={2 + (i % 3)}
              fill="#fff" opacity="0"
              style={{ animation: `hydrate-bubble ${1 + i * 0.15}s ease-out ${i * 0.08}s 1` }} />
          ))}
        </g>
        <path d={`M 52 ${top + 10} L 62 ${bottom - 30}`} stroke="rgba(255,255,255,.55)" strokeWidth="6" strokeLinecap="round" fill="none" />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", pointerEvents: "none", fontFamily: T.font,
      }}>
        <div style={{ fontSize: 56, fontWeight: 800, fontStyle: "italic", color: T.text, letterSpacing: "-2px", lineHeight: 1 }}>
          {Math.min(Math.round(percent), 100)}%
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: T.textSoft, marginTop: 8 }}>
          {toDisplay(consumed, unit).toLocaleString()} of {fmt(goal, unit)}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CONFETTI
   ============================================================ */
const CONFETTI_COLORS = [T.water, T.done, T.outline, "#ffd166", "#ff8fa3", "#c3a6ff"];

function Confetti({ trigger }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!trigger) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize(); window.addEventListener("resize", resize);
    const pieces = Array.from({ length: 160 }, () => ({
      x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.5,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      vy: 2 + Math.random() * 3, vx: -1 + Math.random() * 2,
      rot: Math.random() * Math.PI, vr: -0.1 + Math.random() * 0.2,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      sway: Math.random() * Math.PI * 2,
    }));
    let frame, start = performance.now();
    const draw = (t) => {
      const elapsed = t - start;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fade = elapsed > 2600 ? Math.max(0, 1 - (elapsed - 2600) / 600) : 1;
      pieces.forEach((p) => {
        p.sway += 0.05; p.x += p.vx + Math.sin(p.sway) * 0.8; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (elapsed < 3200) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, [trigger]);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 50 }} />;
}

/* ============================================================
   CALENDAR
   ============================================================ */
function Calendar({ history, viewYear, viewMonth, onPrev, onNext }) {
  const first = new Date(viewYear, viewMonth, 1);
  const start = addDays(first, -first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const tk = todayKey();
  return (
    <div style={{ fontFamily: T.font, color: T.text }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ display: "flex", background: T.cell, borderRadius: 20, overflow: "hidden" }}>
          {[["‹", onPrev, "Previous month"], ["›", onNext, "Next month"]].map(([s, fn, label]) => (
            <button key={label} onClick={fn} aria-label={label} style={{
              border: "none", background: "transparent", cursor: "pointer", fontFamily: T.font,
              fontSize: 18, lineHeight: 1, padding: "5px 12px", color: T.textSoft,
            }}>{s}</button>
          ))}
        </div>
      </div>
      <h2 style={{ textAlign: "center", fontSize: 34, fontWeight: 800, margin: "6px 0 18px", letterSpacing: "-1px" }}>
        {MONTHS[viewMonth]} {viewYear}
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginBottom: 6 }}>
        {DOW.map((d) => <div key={d} style={{ textAlign: "center", fontWeight: 700, fontSize: 14 }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        {cells.map((d) => {
          const k = dateKey(d);
          const pct = dayPercent(history[k]);
          const isToday = k === tk;
          const inMonth = d.getMonth() === viewMonth;
          const label = d.getDate() === 1 ? `${MONTHS_SHORT[d.getMonth()]} 1` : d.getDate();
          return (
            <div key={k} style={{
              position: "relative", aspectRatio: "1 / 1", borderRadius: T.radius, overflow: "hidden",
              background: T.cell, opacity: inMonth ? 1 : 0.55,
              boxShadow: isToday ? `inset 0 0 0 2px ${T.outline}` : "none",
            }}>
              {pct > 0 && (
                <div style={{
                  position: "absolute", left: 0, right: 0, bottom: 0, height: `${pct}%`,
                  background: pct >= 100 ? T.done : T.water, transition: "height .5s ease",
                }} />
              )}
              <div style={{ position: "absolute", top: 6, left: 7, fontSize: 12, fontWeight: 500 }}>{label}</div>
              {pct > 0 && (
                <div style={{
                  position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 13, fontWeight: 800, fontStyle: "italic", paddingTop: 6,
                }}>{pct}%</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   LEADERBOARD
   ============================================================ */
function Board({ title, rows, valueKey, format, me }) {
  const sorted = [...rows].sort((a, b) => (b[valueKey] || 0) - (a[valueKey] || 0)).slice(0, 10);
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <div style={{ background: "#f2f2f2", borderRadius: T.radius + 4, padding: 18, marginTop: 18, fontFamily: T.font }}>
      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 10 }}>{title}</div>
      {sorted.length === 0 && <div style={{ fontSize: 13, color: T.textSoft }}>nobody on the board yet</div>}
      {sorted.map((r, i) => {
        const isMe = r.username === me;
        return (
          <div key={r.username} style={{
            display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: T.radius,
            background: isMe ? T.water : "transparent", marginBottom: 4,
          }}>
            <div style={{ width: 26, textAlign: "center", fontWeight: 800, fontSize: 14 }}>{medal[i] || i + 1}</div>
            <div style={{
              width: 30, height: 30, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
              background: T.cell, display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {r.avatar_url ? (
                <img src={r.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ fontSize: 14 }}>👤</span>
              )}
            </div>
            <div style={{ flex: 1, fontWeight: isMe ? 800 : 600, fontSize: 14 }}>{r.username}{isMe ? " (you)" : ""}</div>
            <div style={{ fontWeight: 800, fontStyle: "italic", fontSize: 15 }}>{format(r[valueKey] || 0)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ me, unit }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("leaderboard").select("*");
      setRows((data || []).map((r) => ({
        username: r.username,
        longestStreak: r.longest_streak,
        currentStreak: r.current_streak,
        totalOz: r.total_oz,
        avatar_url: r.avatar_url,
      })));
    })();
  }, []);
  if (!rows) return <p style={{ fontSize: 14, color: T.textSoft, textAlign: "center", marginTop: 24 }}>loading…</p>;
  return (
    <>
      <Board title="longest streak" rows={rows} valueKey="longestStreak" me={me}
        format={(v) => `${v} day${v === 1 ? "" : "s"}`} />
      <Board title="most water drank" rows={rows} valueKey="totalOz" me={me}
        format={(v) => fmt(v, unit)} />
      <p style={{ fontSize: 12, color: T.textSoft, textAlign: "center", marginTop: 14 }}>
        your username, streak and total are visible to everyone on the board
      </p>
    </>
  );
}

/* ============================================================
   APP
   ============================================================ */
export default function HydrateApp() {
  const [screen, setScreen] = useState("loading");
  const [tab, setTab] = useState("today");
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState("");
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState({});
  const [avatarUrl, setAvatarUrl] = useState(null);

  // auth form
  const [authMode, setAuthMode] = useState("signup");
  const [formUser, setFormUser] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPass, setFormPass] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [formConfirm, setFormConfirm] = useState("");
  const [usernameTaken, setUsernameTaken] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  // setup form
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState("lbs");
  const [gender, setGender] = useState("");
  const [unit, setUnit] = useState("oz");
  const [bottleSize, setBottleSize] = useState("");

  // profile tab
  const [editingAvatar, setEditingAvatar] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [usernameMsg, setUsernameMsg] = useState("");
  const [showPwModal, setShowPwModal] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [showOldPw, setShowOldPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);
  const [newUserTaken, setNewUserTaken] = useState(false);
  const [checkingNewUser, setCheckingNewUser] = useState(false);
  const [userChangeBusy, setUserChangeBusy] = useState(false);

  const [customAmt, setCustomAmt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [splashKey, setSplashKey] = useState(0);
  const [celebrate, setCelebrate] = useState(0);
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const inputRef = useRef(null);
  const usernameTimer = useRef(null);

  // live username availability check (debounced)
  const checkUsername = (val) => {
    setFormUser(val);
    setUsernameTaken(false);
    clearTimeout(usernameTimer.current);
    const name = val.trim().toLowerCase();
    if (!name || name.length < 3 || !/^[a-z0-9_]{3,20}$/.test(name)) return;
    setCheckingUsername(true);
    usernameTimer.current = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("username").eq("username", name).single();
      setUsernameTaken(!!data);
      setCheckingUsername(false);
    }, 400);
  };

  const newUserTimer = useRef(null);

  const checkNewUsername = (val) => {
    setNewUsername(val);
    setNewUserTaken(false);
    setUsernameMsg("");
    clearTimeout(newUserTimer.current);
    const name = val.trim().toLowerCase();
    if (!name || name.length < 3 || !/^[a-z0-9_]{3,20}$/.test(name)) return;
    if (name === username) return;
    setCheckingNewUser(true);
    newUserTimer.current = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("username").eq("username", name).single();
      setNewUserTaken(!!data);
      setCheckingNewUser(false);
    }, 400);
  };

  const openUserModal = () => { setShowUserModal(true); setNewUsername(""); setUsernameMsg(""); setNewUserTaken(false); setCheckingNewUser(false); };
  const closeUserModal = () => { setShowUserModal(false); setUsernameMsg(""); };

  /* ---------- load profile from Supabase ---------- */
  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).single();
    if (data) {
      setUsername(data.username);
      setProfile(data);
      setHistory(data.history || {});
      setWeight(data.weight); setWeightUnit(data.weight_unit);
      setGender(data.gender); setUnit(data.unit || "oz");
      setBottleSize(data.bottle_size || "");
      setAvatarUrl(data.avatar_url || null);
      setScreen("app");
    } else {
      setScreen("setup");
    }
  };

  /* ---------- init: check if already signed in ---------- */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (s) { setSession(s); loadProfile(s.user.id); }
      else setScreen("auth");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setScreen("auth");
    });
    return () => subscription.unsubscribe();
  }, []);

  const tk = todayKey();
  const today = history[tk] || { consumed: 0, goal: profile?.goal || 0, log: [] };
  const goal = profile?.goal || 0;
  const consumed = today.consumed;
  const percent = goal ? (consumed / goal) * 100 : 0;
  const remaining = Math.max(0, goal - consumed);
  const streak = computeStreak(history);
  const longestStreak = computeLongestStreak(history);

  /* ---------- save history + push leaderboard ---------- */
  const saveHistory = async (h) => {
    setHistory(h);
    if (!session) return;
    await supabase.from("profiles").update({ history: h }).eq("id", session.user.id);
    await supabase.from("leaderboard").upsert({
      username,
      longest_streak: computeLongestStreak(h),
      current_streak: computeStreak(h),
      total_oz: computeTotalOz(h),
      avatar_url: avatarUrl || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "username" });
  };

  const writeToday = (entry) => { saveHistory({ ...history, [tk]: entry }); };

  const addWater = (oz) => {
    if (!oz || oz <= 0) return;
    const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const next = consumed + oz;
    writeToday({ consumed: next, goal, log: [{ oz, time }, ...today.log] });
    setSplashKey((k) => k + 1);
    if (goal && consumed < goal && next >= goal) setCelebrate((c) => c + 1);
  };

  const undoLast = () => {
    if (!today.log.length) return;
    const [last, ...rest] = today.log;
    writeToday({ consumed: Math.max(0, consumed - last.oz), goal, log: rest });
  };

  /* ---------- account ---------- */
  const handleAuth = async () => {
    setAuthError(""); setAuthBusy(true);
    if (authMode === "signup") {
      const name = formUser.trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(name)) { setAuthError("username: 3\u201320 letters, numbers or underscores"); setAuthBusy(false); return; }
      if (formPass.length < 6) { setAuthError("password needs at least 6 characters"); setAuthBusy(false); return; }
      if (formPass !== formConfirm) { setAuthError("passwords don't match"); setAuthBusy(false); return; }
      if (usernameTaken) { setAuthError("that username is taken"); setAuthBusy(false); return; }
      const { data: existing } = await supabase.from("profiles").select("username").eq("username", name).single();
      if (existing) { setAuthError("that username is taken"); setAuthBusy(false); return; }
      const { data, error } = await supabase.auth.signUp({ email: formEmail.trim(), password: formPass });
      if (error) { setAuthError(error.message); setAuthBusy(false); return; }
      await supabase.from("profiles").insert({ id: data.user.id, username: name });
      setSession(data.session); setUsername(name); setAuthBusy(false); setScreen("setup");
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email: formEmail.trim(), password: formPass });
      if (error) { setAuthError(error.message); setAuthBusy(false); return; }
      setSession(data.session); setAuthBusy(false);
      await loadProfile(data.user.id);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null); setProfile(null); setHistory({});
    setFormUser(""); setFormEmail(""); setFormPass("");
    setTab("today"); setScreen("auth");
  };

  /* ---------- profile actions ---------- */
  const saveAvatar = async (dataUrl) => {
    setAvatarUrl(dataUrl);
    setEditingAvatar(false);
    await supabase.from("profiles").update({ avatar_url: dataUrl }).eq("id", session.user.id);
    await supabase.from("leaderboard").update({ avatar_url: dataUrl }).eq("username", username);
  };

  const openPwModal = () => { setShowPwModal(true); setOldPw(""); setNewPw(""); setConfirmPw(""); setPwErr(""); setPwSuccess(""); setShowOldPw(false); setShowNewPw(false); };
  const closePwModal = () => { setShowPwModal(false); setPwErr(""); setPwSuccess(""); };

  const handleChangePassword = async () => {
    setPwErr(""); setPwSuccess("");
    if (!oldPw) { setPwErr("enter your current password"); return; }
    if (newPw.length < 6) { setPwErr("new password needs at least 6 characters"); return; }
    if (newPw !== confirmPw) { setPwErr("new passwords don't match"); return; }
    setPwBusy(true);
    // verify old password by trying to sign in
    const email = session.user.email;
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password: oldPw });
    if (signInErr) { setPwErr("incorrect password"); setPwBusy(false); return; }
    // update to new password
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPw });
    if (updateErr) { setPwErr(updateErr.message); setPwBusy(false); return; }
    setPwSuccess("password updated!");
    setPwBusy(false);
    setTimeout(() => closePwModal(), 1500);
  };

  const canChangeUsername = () => {
    if (!profile?.last_username_change) return true;
    const last = new Date(profile.last_username_change);
    const diff = Date.now() - last.getTime();
    return diff > 30 * 24 * 60 * 60 * 1000; // 30 days
  };

  const daysUntilUsernameChange = () => {
    if (!profile?.last_username_change) return 0;
    const last = new Date(profile.last_username_change);
    const diff = 30 * 24 * 60 * 60 * 1000 - (Date.now() - last.getTime());
    return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
  };

  const handleUsernameChange = async () => {
    const name = newUsername.trim().toLowerCase();
    if (!name) return;
    setUsernameMsg("");
    if (!/^[a-z0-9_]{3,20}$/.test(name)) { setUsernameMsg("3\u201320 letters, numbers or underscores"); return; }
    if (name === username) { setUsernameMsg("that's already your username"); return; }
    if (newUserTaken) { setUsernameMsg("that username is taken"); return; }
    setUserChangeBusy(true);
    // double-check availability
    const { data: existing } = await supabase.from("profiles").select("username").eq("username", name).single();
    if (existing) { setUsernameMsg("that username is taken"); setNewUserTaken(true); setUserChangeBusy(false); return; }
    // IMPORTANT: delete old leaderboard row FIRST, while profile still has the old username
    const oldUsername = username;
    const now = new Date().toISOString();
    try { await supabase.from("leaderboard").delete().eq("username", oldUsername); } catch {}
    // now update profile username
    const { error: updateErr } = await supabase.from("profiles").update({ username: name, last_username_change: now }).eq("id", session.user.id);
    if (updateErr) { setUsernameMsg("failed to update — try again"); setUserChangeBusy(false); return; }
    setUsername(name);
    setProfile({ ...profile, username: name, last_username_change: now });
    setUsernameMsg("username changed!");
    setUserChangeBusy(false);
    // push new leaderboard row with updated username
    await supabase.from("leaderboard").upsert({
      username: name,
      longest_streak: computeLongestStreak(history),
      current_streak: computeStreak(history),
      total_oz: computeTotalOz(history),
      avatar_url: avatarUrl || null,
      updated_at: now,
    }, { onConflict: "username" });
    setTimeout(() => closeUserModal(), 1500);
  };

  /* ---------- setup ---------- */
  const handleSetup = async () => {
    const w = parseFloat(weight);
    if (!w || !gender) return;
    const g = calculateDailyGoal(w, gender, weightUnit);
    const updates = { weight: w, weight_unit: weightUnit, gender, unit, bottle_size: bottleSize, goal: g };
    await supabase.from("profiles").update(updates).eq("id", session.user.id);
    const p = { ...profile, ...updates };
    setProfile(p);
    if (history[tk]) writeToday({ ...history[tk], goal: g });
    setScreen("app"); setTab("today");
  };

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear((y) => y + 1); } else setViewMonth((m) => m + 1); };

  const presets = bottleSize
    ? [...PRESETS_BY_UNIT[unit], { label: "my bottle", amt: parseFloat(bottleSize) }]
    : PRESETS_BY_UNIT[unit];
  const addCustom = () => {
    const v = parseFloat(customAmt);
    if (v > 0) addWater(fromDisplay(v, unit));
    setCustomAmt(""); setShowCustom(false);
  };

  // joined date
  const joinedDate = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "";

  /* ---------- shared styles ---------- */
  const S = {
    app: { minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.font },
    wrap: { maxWidth: 440, margin: "0 auto", padding: "28px 20px 48px" },
    h1: { fontSize: 34, fontWeight: 800, letterSpacing: "-1px", margin: 0 },
    soft: { fontSize: 14, color: T.textSoft, margin: "4px 0 0" },
    card: { background: "#f2f2f2", borderRadius: T.radius + 4, padding: 18, marginTop: 18 },
    label: { display: "block", fontSize: 13, fontWeight: 700, marginBottom: 8 },
    input: {
      width: "100%", padding: "11px 12px", borderRadius: T.radius, border: `1.5px solid ${T.cell}`,
      background: "#fff", fontSize: 15, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box",
    },
    primary: {
      width: "100%", padding: 14, borderRadius: T.radius, border: "none", background: T.text, color: "#fff",
      fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.font, marginTop: 18,
    },
    ghost: {
      background: "#fff", border: `1.5px solid ${T.cell}`, color: T.text, padding: "8px 14px",
      borderRadius: T.radius, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font,
    },
    choice: (on) => ({
      flex: 1, padding: 11, borderRadius: T.radius, cursor: "pointer", fontFamily: T.font, fontSize: 14,
      border: on ? `1.5px solid ${T.outline}` : `1.5px solid ${T.cell}`,
      background: on ? T.water : "#fff", color: T.text, fontWeight: on ? 700 : 500,
    }),
    tab: (on) => ({
      flex: 1, padding: "10px 0", border: "none", borderRadius: 20, cursor: "pointer", fontFamily: T.font,
      fontSize: 14, fontWeight: 700, background: on ? T.text : "transparent", color: on ? "#fff" : T.textSoft,
    }),
  };

  /* ---------- SCREENS ---------- */

  if (screen === "loading") {
    return <div style={{ ...S.app, display: "grid", placeItems: "center" }}><p style={S.soft}>loading…</p></div>;
  }

  if (screen === "auth") {
    const signup = authMode === "signup";
    const onKey = (e) => { if (e.key === "Enter") handleAuth(); };
    return (
      <div style={S.app}><div style={S.wrap}>
        <h1 style={S.h1}>hydrate</h1>
        <p style={S.soft}>{signup ? "make an account to save your streak" : "welcome back"}</p>

        <div style={{ display: "flex", background: "#f2f2f2", borderRadius: 24, padding: 4, marginTop: 20 }}>
          <button style={S.tab(signup)} onClick={() => { setAuthMode("signup"); setAuthError(""); }}>sign up</button>
          <button style={S.tab(!signup)} onClick={() => { setAuthMode("login"); setAuthError(""); }}>log in</button>
        </div>

        <div style={S.card}>
          {signup && (
            <>
              <label style={S.label}>username</label>
              <input style={{ ...S.input, borderColor: usernameTaken ? "#d64545" : undefined }} placeholder="e.g. waterqueen" value={formUser} autoCapitalize="none"
                onChange={(e) => checkUsername(e.target.value)} onKeyDown={onKey} />
              {usernameTaken && <p style={{ fontSize: 12, color: "#d64545", fontWeight: 700, margin: "6px 0 0" }}>username taken</p>}
              {checkingUsername && <p style={{ fontSize: 12, color: T.textSoft, margin: "6px 0 0" }}>checking…</p>}
            </>
          )}
          <label style={{ ...S.label, marginTop: signup ? 14 : 0 }}>email</label>
          <input style={S.input} type="email" placeholder="you@example.com" value={formEmail}
            onChange={(e) => setFormEmail(e.target.value)} onKeyDown={onKey} />
          <label style={{ ...S.label, marginTop: 14 }}>password</label>
          <div style={{ position: "relative" }}>
            <input style={{ ...S.input, paddingRight: 44 }} type={showPass ? "text" : "password"} placeholder={signup ? "at least 6 characters" : "your password"} value={formPass}
              onChange={(e) => setFormPass(e.target.value)} onKeyDown={onKey} />
            <button onClick={() => setShowPass(!showPass)} type="button" style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", padding: 4,
              color: T.textSoft, fontFamily: T.font,
            }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{showPass ? (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}</svg></button>
          </div>
          {signup && (
            <>
              <label style={{ ...S.label, marginTop: 14 }}>confirm password</label>
              <div style={{ position: "relative" }}>
                <input style={{ ...S.input, paddingRight: 44 }} type={showPass ? "text" : "password"} placeholder="retype your password" value={formConfirm}
                  onChange={(e) => setFormConfirm(e.target.value)} onKeyDown={onKey} />
                <button onClick={() => setShowPass(!showPass)} type="button" style={{
                  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: 4,
                  color: T.textSoft, fontFamily: T.font,
                }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{showPass ? (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}</svg></button>
              </div>
              {formConfirm && formPass !== formConfirm && (
                <p style={{ fontSize: 12, color: "#d64545", fontWeight: 600, margin: "6px 0 0" }}>passwords don't match</p>
              )}
            </>
          )}
          {authError && <p style={{ fontSize: 13, color: "#d64545", margin: "10px 0 0", fontWeight: 600 }}>{authError}</p>}
        </div>

        <button style={{ ...S.primary, opacity: authBusy ? 0.5 : 1 }} onClick={handleAuth} disabled={authBusy}>
          {authBusy ? "one sec\u2026" : signup ? "create account" : "log in"}
        </button>
        <p style={{ ...S.soft, fontSize: 12, textAlign: "center", marginTop: 14 }}>
          {signup ? "already have an account? " : "new here? "}
          <button onClick={() => { setAuthMode(signup ? "login" : "signup"); setAuthError(""); }}
            style={{ background: "none", border: "none", padding: 0, color: T.outline, fontWeight: 700, cursor: "pointer", fontFamily: T.font, fontSize: 12 }}>
            {signup ? "log in" : "sign up"}
          </button>
        </p>
      </div></div>
    );
  }

  if (screen === "setup") {
    const ready = weight && gender;
    return (
      <div style={S.app}><div style={S.wrap}>
        <h1 style={S.h1}>hydrate</h1>
        <p style={S.soft}>set up your personal water goal</p>

        <div style={S.card}>
          <label style={S.label}>your weight</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...S.input, flex: 1 }} type="number" placeholder="e.g. 150" value={weight} onChange={(e) => setWeight(e.target.value)} />
            <div style={{ display: "flex", gap: 6 }}>
              {["lbs", "kg"].map((u) => <button key={u} onClick={() => setWeightUnit(u)} style={{ ...S.choice(weightUnit === u), flex: "none", padding: "0 14px" }}>{u}</button>)}
            </div>
          </div>
        </div>

        <div style={S.card}>
          <label style={S.label}>gender</label>
          <div style={{ display: "flex", gap: 8 }}>
            {["male", "female", "other"].map((g) => <button key={g} onClick={() => setGender(g)} style={S.choice(gender === g)}>{g}</button>)}
          </div>
        </div>

        <div style={S.card}>
          <label style={S.label}>measure water in</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[["oz", "ounces (oz)"], ["ml", "milliliters (ml)"]].map(([u, name]) => (
              <button key={u} onClick={() => { setUnit(u); setBottleSize(""); }} style={S.choice(unit === u)}>{name}</button>
            ))}
          </div>
        </div>

        <div style={S.card}>
          <label style={S.label}>your bottle size in {unit} (optional)</label>
          <input style={S.input} type="number" placeholder={unit === "ml" ? "e.g. 700" : "e.g. 24"} value={bottleSize} onChange={(e) => setBottleSize(e.target.value)} />
          <p style={{ ...S.soft, fontSize: 12, marginTop: 8 }}>we'll add it as a quick-add button.</p>
        </div>

        <button style={{ ...S.primary, opacity: ready ? 1 : 0.35, pointerEvents: ready ? "auto" : "none" }} onClick={handleSetup}>
          calculate my goal
        </button>
        {profile?.goal && <button style={{ ...S.ghost, width: "100%", marginTop: 10 }} onClick={() => setScreen("app")}>cancel</button>}
      </div></div>
    );
  }

  /* ---------- MAIN ---------- */
  return (
    <div style={S.app}><div style={S.wrap}>
      <Confetti trigger={celebrate} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={S.h1}>hydrate</h1>
          <p style={S.soft}>hi {username} · {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toLowerCase()}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 26, fontWeight: 800, fontStyle: "italic", letterSpacing: "-1px", lineHeight: 1 }}>{streak}🔥</div>
          <div style={{ fontSize: 12, color: T.textSoft, marginTop: 4 }}>day streak</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", background: "#f2f2f2", borderRadius: 24, padding: 4, marginTop: 20 }}>
        <button style={S.tab(tab === "today")} onClick={() => setTab("today")}>today</button>
        <button style={S.tab(tab === "calendar")} onClick={() => setTab("calendar")}>calendar</button>
        <button style={S.tab(tab === "leaderboard")} onClick={() => setTab("leaderboard")}>board</button>
        <button style={S.tab(tab === "profile")} onClick={() => setTab("profile")}>profile</button>
      </div>

      {tab === "leaderboard" && (
        <div style={{ marginTop: 6 }}>
          <Leaderboard me={username} unit={unit} key={consumed} />
        </div>
      )}

      {tab === "today" ? (
        <>
          <div style={{ marginTop: 26 }}>
            <Glass percent={percent} consumed={consumed} goal={goal} unit={unit} splashKey={splashKey} />
          </div>
          <p style={{ ...S.soft, textAlign: "center", marginTop: 14 }}>
            {remaining > 0 ? `${fmt(remaining, unit)} to go` : "goal reached \u2014 nice work"}
          </p>

          <div style={S.card}>
            <label style={S.label}>add water</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))", gap: 8 }}>
              {presets.map((p, i) => (
                <button key={i} onClick={() => addWater(fromDisplay(p.amt, unit))} style={{ ...S.choice(false), padding: "12px 4px" }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>{p.amt}</div>
                  <div style={{ fontSize: 11, color: T.textSoft }}>{p.label}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              {!showCustom ? (
                <button onClick={() => { setShowCustom(true); setTimeout(() => inputRef.current?.focus(), 50); }} style={{ ...S.ghost, width: "100%" }}>+ custom amount</button>
              ) : (
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={inputRef} style={{ ...S.input, flex: 1 }} type="number" placeholder={unit} value={customAmt}
                    onChange={(e) => setCustomAmt(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} />
                  <button onClick={addCustom} style={{ ...S.primary, width: "auto", marginTop: 0, padding: "0 20px" }}>add</button>
                </div>
              )}
            </div>
          </div>

          {today.log.length > 0 && (
            <div style={S.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <label style={{ ...S.label, margin: 0 }}>today's log</label>
                <button onClick={undoLast} style={{ ...S.ghost, padding: "5px 10px", fontSize: 12 }}>undo last</button>
              </div>
              <div style={{ maxHeight: 180, overflowY: "auto" }}>
                {today.log.map((e, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${T.cell}`, fontSize: 14 }}>
                    <span style={{ fontWeight: 600 }}>{fmt(e.oz, unit)}</span><span style={{ color: T.textSoft }}>{e.time}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : tab === "calendar" ? (
        <div style={{ marginTop: 22 }}>
          <Calendar history={history} viewYear={viewYear} viewMonth={viewMonth} onPrev={prevMonth} onNext={nextMonth} />
          <p style={{ ...S.soft, textAlign: "center", marginTop: 18 }}>
            {streak > 0 ? `${streak} day${streak === 1 ? "" : "s"} in a row hitting your goal` : "hit your goal today to start a streak"}
          </p>
        </div>
      ) : tab === "profile" ? (
        <div style={{ marginTop: 22 }}>
          {/* --- avatar --- */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            {editingAvatar ? (
              <div style={{ width: "100%" }}>
                <AvatarCropper onSave={saveAvatar} onCancel={() => setEditingAvatar(false)} />
              </div>
            ) : (
              <>
                <div onClick={() => setEditingAvatar(true)} style={{
                  width: 120, height: 120, borderRadius: "50%", overflow: "hidden", cursor: "pointer",
                  background: T.cell, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `3px solid ${T.outline}`,
                }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: 40 }}>👤</span>
                  )}
                </div>
                <button onClick={() => setEditingAvatar(true)} style={{
                  background: "none", border: "none", color: T.outline, fontWeight: 700, cursor: "pointer",
                  fontFamily: T.font, fontSize: 13, marginTop: 8,
                }}>change photo</button>
              </>
            )}
          </div>

          {/* --- username --- */}
          <div style={S.card}>
            <label style={S.label}>username</label>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 18, fontWeight: 800 }}>{username}</span>
              {canChangeUsername() ? (
                <button onClick={openUserModal} style={{ ...S.ghost, padding: "6px 12px", fontSize: 12 }}>edit</button>
              ) : (
                <span style={{ fontSize: 11, color: T.textSoft }}>can change in {daysUntilUsernameChange()} days</span>
              )}
            </div>
          </div>

          {/* --- stats --- */}
          <div style={S.card}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 800, fontStyle: "italic", lineHeight: 1 }}>{streak}🔥</div>
                <div style={{ fontSize: 12, color: T.textSoft, marginTop: 4 }}>current streak</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 32, fontWeight: 800, fontStyle: "italic", lineHeight: 1 }}>{longestStreak}</div>
                <div style={{ fontSize: 12, color: T.textSoft, marginTop: 4 }}>best streak</div>
              </div>
            </div>
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontStyle: "italic" }}>{fmt(computeTotalOz(history), unit)}</div>
              <div style={{ fontSize: 12, color: T.textSoft, marginTop: 2 }}>total water logged</div>
            </div>
          </div>

          {/* --- joined --- */}
          <div style={S.card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>member since</span>
              <span style={{ fontSize: 14, color: T.textSoft }}>{joinedDate}</span>
            </div>
          </div>

          {/* --- actions --- */}
          <button onClick={() => { setScreen("setup"); }} style={{ ...S.ghost, width: "100%", marginTop: 18 }}>
            hydration preferences
          </button>
          <button onClick={openPwModal} style={{ ...S.ghost, width: "100%", marginTop: 8 }}>
            change password
          </button>
          <button onClick={signOut} style={{ ...S.ghost, width: "100%", marginTop: 8, color: "#d64545", borderColor: "#f0c0c0" }}>
            sign out
          </button>

          {/* --- change password modal --- */}
          {showPwModal && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
            }} onClick={(e) => { if (e.target === e.currentTarget) closePwModal(); }}>
              <div style={{
                background: "#fff", borderRadius: T.radius + 4, padding: 24, width: "100%",
                maxWidth: 380, position: "relative", fontFamily: T.font,
              }}>
                <button onClick={closePwModal} style={{
                  position: "absolute", top: 12, right: 14, background: "none", border: "none",
                  fontSize: 20, cursor: "pointer", color: T.textSoft, fontFamily: T.font, lineHeight: 1,
                }}>×</button>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 18 }}>change password</div>

                <label style={S.label}>current password</label>
                <div style={{ position: "relative", marginBottom: 14 }}>
                  <input style={{ ...S.input, paddingRight: 44 }} type={showOldPw ? "text" : "password"}
                    placeholder="your current password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
                  <button onClick={() => setShowOldPw(!showOldPw)} type="button" style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", padding: 4, color: T.textSoft,
                  }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{showOldPw ? (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}</svg></button>
                </div>

                <label style={S.label}>new password</label>
                <div style={{ position: "relative", marginBottom: 14 }}>
                  <input style={{ ...S.input, paddingRight: 44 }} type={showNewPw ? "text" : "password"}
                    placeholder="at least 6 characters" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <button onClick={() => setShowNewPw(!showNewPw)} type="button" style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", padding: 4, color: T.textSoft,
                  }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{showNewPw ? (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}</svg></button>
                </div>

                <label style={S.label}>confirm new password</label>
                <div style={{ position: "relative" }}>
                  <input style={{ ...S.input, paddingRight: 44 }} type={showNewPw ? "text" : "password"}
                    placeholder="retype new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleChangePassword(); }} />
                  <button onClick={() => setShowNewPw(!showNewPw)} type="button" style={{
                    position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", padding: 4, color: T.textSoft,
                  }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{showNewPw ? (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) : (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>)}</svg></button>
                </div>
                {confirmPw && newPw !== confirmPw && (
                  <p style={{ fontSize: 12, color: "#d64545", fontWeight: 600, margin: "6px 0 0" }}>passwords don't match</p>
                )}

                {pwErr && <p style={{ fontSize: 13, color: "#d64545", fontWeight: 600, margin: "14px 0 0" }}>{pwErr}</p>}
                {pwSuccess && <p style={{ fontSize: 13, color: "#2d8a4e", fontWeight: 600, margin: "14px 0 0" }}>{pwSuccess}</p>}

                <button onClick={handleChangePassword} disabled={pwBusy} style={{
                  ...S.primary, opacity: pwBusy ? 0.5 : 1,
                }}>{pwBusy ? "saving…" : "save changes"}</button>
              </div>
            </div>
          )}

          {/* --- change username modal --- */}
          {showUserModal && (
            <div style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
              alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20,
            }} onClick={(e) => { if (e.target === e.currentTarget) closeUserModal(); }}>
              <div style={{
                background: "#fff", borderRadius: T.radius + 4, padding: 24, width: "100%",
                maxWidth: 380, position: "relative", fontFamily: T.font,
              }}>
                <button onClick={closeUserModal} style={{
                  position: "absolute", top: 12, right: 14, background: "none", border: "none",
                  fontSize: 20, cursor: "pointer", color: T.textSoft, fontFamily: T.font, lineHeight: 1,
                }}>×</button>
                <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>change username</div>
                <p style={{ fontSize: 12, color: T.textSoft, marginBottom: 18 }}>
                  you can only change your username once every 30 days
                </p>

                <label style={S.label}>current username</label>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 14, color: T.textSoft }}>{username}</div>

                <label style={S.label}>new username</label>
                <input style={{ ...S.input, borderColor: newUserTaken ? "#d64545" : undefined }}
                  placeholder="e.g. waterqueen" value={newUsername} autoCapitalize="none"
                  onChange={(e) => checkNewUsername(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !newUserTaken) handleUsernameChange(); }} />
                {newUserTaken && (
                  <p style={{ fontSize: 12, color: "#d64545", fontWeight: 700, margin: "6px 0 0" }}>username taken</p>
                )}
                {checkingNewUser && (
                  <p style={{ fontSize: 12, color: T.textSoft, margin: "6px 0 0" }}>checking…</p>
                )}
                {newUsername.trim().length >= 3 && !newUserTaken && !checkingNewUser && newUsername.trim().toLowerCase() !== username && /^[a-z0-9_]{3,20}$/.test(newUsername.trim().toLowerCase()) && (
                  <p style={{ fontSize: 12, color: T.outline, fontWeight: 600, margin: "6px 0 0" }}>available ✓</p>
                )}

                {usernameMsg && (
                  <p style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 0",
                    color: usernameMsg === "username changed!" ? "#2d8a4e" : "#d64545",
                  }}>{usernameMsg}</p>
                )}

                <button onClick={handleUsernameChange} disabled={userChangeBusy || newUserTaken} style={{
                  ...S.primary, opacity: (userChangeBusy || newUserTaken || !newUsername.trim()) ? 0.5 : 1,
                }}>{userChangeBusy ? "saving…" : "confirm change"}</button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div></div>
  );
}
