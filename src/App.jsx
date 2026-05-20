import { useState, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
//  ENGINE v2 — LUASHIELD
// ═══════════════════════════════════════════════════════════

const GLOBALS = new Set([
  "and","break","do","else","elseif","end","false","for","function","goto",
  "if","in","local","nil","not","or","repeat","return","then","true","until","while",
  "print","warn","error","assert","type","typeof","tostring","tonumber","rawget",
  "rawset","rawequal","rawlen","pairs","ipairs","next","select","unpack","pcall",
  "xpcall","setmetatable","getmetatable","collectgarbage","require","load",
  "loadstring","string","table","math","os","coroutine","debug","bit32","utf8",
  "game","workspace","script","_G","shared","_ENV","plugin","Enum",
  "Instance","Vector3","Vector2","Vector2int16","Vector3int16","CFrame","Color3",
  "UDim","UDim2","BrickColor","NumberRange","NumberSequence","ColorSequence",
  "Ray","TweenInfo","RaycastParams","OverlapParams","task","wait","spawn",
  "delay","tick","time","elapsedTime","Players","RunService","UserInputService",
  "TweenService","ReplicatedStorage","ServerStorage","StarterGui","StarterPack",
  "StarterPlayer","Lighting","SoundService","HttpService","DataStoreService",
  "RemoteEvent","RemoteFunction","BindableEvent","BindableFunction","i","v","k","self","_",
]);

const R = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

function mkVar(i, level) {
  const hex = i.toString(16).toUpperCase().padStart(4, "0");
  if (level === "standard") return `_0x${hex}`;
  if (level === "medium")   return `_l${hex}l_`;
  // max: scrambled digit-sep pattern, near-impossible to read
  return `_${hex[0]}${R(0,9)}${hex[1]}${R(0,9)}${hex[2]}${R(0,9)}${hex[3]}_`;
}

// ─── Step 1: protect string literals ───────────────────────
function extractStrings(src) {
  const store = [];
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1, raw = c;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { raw += src[j] + (src[j+1]||""); j += 2; }
        else raw += src[j++];
      }
      raw += src[j] || "";
      store.push({ raw, content: raw.slice(1,-1), kind: "q" });
      out += `\x01${store.length-1}\x01`;
      i = j + 1; continue;
    }
    if (c === "[") {
      let lvl = 0, k = i + 1;
      while (src[k] === "=") { lvl++; k++; }
      if (src[k] === "[") {
        const close = "]" + "=".repeat(lvl) + "]";
        const end = src.indexOf(close, k + 1);
        if (end !== -1) {
          store.push({ raw: src.slice(i, end + close.length), kind: "long" });
          out += `\x01${store.length-1}\x01`;
          i = end + close.length; continue;
        }
      }
    }
    out += c; i++;
  }
  return { code: out, store };
}

// ─── Step 2: strip comments ──────────────────────────────
function stripComments(code) {
  code = code.replace(/--\[=*\[[\s\S]*?\]=*\]/g, "");
  code = code.replace(/--[^\n]*/g, "");
  return code;
}

// ─── Step 3: rename locals + params ──────────────────────
function renameVars(code, level, ctr) {
  const map = new Map();
  let count = 0;
  const reg = (n) => {
    if (n && !map.has(n) && !GLOBALS.has(n)) { map.set(n, mkVar(ctr.v++, level)); count++; }
  };
  for (const m of code.matchAll(/\blocal\s+((?:[a-zA-Z_]\w*\s*,\s*)*[a-zA-Z_]\w*)/g))
    m[1].split(",").map(s => s.trim()).forEach(reg);
  for (const m of code.matchAll(/\bfunction\s*(?:[a-zA-Z_][\w.:\[\]]*\s*)?\(([^)]*)\)/g))
    m[1].split(",").map(s => s.trim().replace("...", "")).filter(Boolean).forEach(reg);
  for (const [orig, repl] of map) {
    const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    code = code.replace(new RegExp(`\\b${esc}\\b`, "g"), repl);
  }
  return { code, count };
}

// ─── Step 4: obfuscate integer literals ──────────────────
function obfuscateNums(code, level) {
  let count = 0;
  const out = code.replace(/\b(\d+)\b/g, (m, s) => {
    const n = parseInt(s, 10);
    if (isNaN(n) || n === 0 || n > 999999) return m;
    count++;
    const a = R(1000, 9000), b = n - a;
    if (level === "max") {
      const c = R(10, 200), d = R(1, 50);
      return `(${a}+${b}+(${c}*${d}-${c*d}))`;
    }
    return `(${a}+${b})`;
  });
  return { code: out, count };
}

// ─── Step 5: encode strings → string.char() ──────────────
function encodeStr(content) {
  if (!content) return '""';
  const bytes = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "\\") {
      const n = content[i+1];
      const esc = { n:10, t:9, r:13, "\\":92, '"':34, "'":39 };
      if (esc[n] !== undefined) { bytes.push(esc[n]); i+=2; continue; }
      if (/\d/.test(n)) {
        let num="", k=i+1;
        while (k<content.length && /\d/.test(content[k]) && num.length<3) num+=content[k++];
        bytes.push(parseInt(num,10)); i=k; continue;
      }
      bytes.push(content.charCodeAt(i)); i++;
    } else { bytes.push(content.charCodeAt(i)); i++; }
  }
  if (!bytes.length) return '""';
  // Two-layer: split byte array into two halves, reassemble at runtime
  const mid = Math.floor(bytes.length / 2);
  const a = bytes.slice(0, mid), b = bytes.slice(mid);
  return `(function()local _a={${a.join(",")}};local _b={${b.join(",")}};local _t={};for _i=1,#_a do _t[#_t+1]=string.char(_a[_i])end;for _i=1,#_b do _t[#_t+1]=string.char(_b[_i])end;return table.concat(_t)end)()`;
}

// ─── Step 6: inject realistic dead code ──────────────────
function injectDead(code, level, ctr) {
  const freq = { standard: 0.05, medium: 0.13, max: 0.20 }[level];
  let count = 0;
  const lines = code.split("\n");
  const out = [];
  const dead = (v) => [
    `local ${v}=nil;if ${v} then error("unreachable") end`,
    `local ${v}=type(nil)=="table"`,
    `local ${v}=math.max(${R(1,9)},${R(1,9)})`,
    `local ${v}=tostring(${R(100,9999)})`,
    `local ${v}=string.len("")+${R(0,0)}`,
    `local ${v}=({[${R(1,9)}]=${R(1,9)}})[${R(10,99)}]`,
    `local ${v}=pcall(function()end)`,
    `local ${v}=select("#")`,
  ];
  for (const line of lines) {
    out.push(line);
    if (!line.trim() || line.trim().startsWith("--")) continue;
    if (Math.random() < freq) {
      const v = mkVar(ctr.v++, level);
      const d = dead(v);
      out.push(d[R(0, d.length-1)] + ";");
      count++;
    }
  }
  return { code: out.join("\n"), count };
}

// ─── Step 7: alias stdlib functions (medium+) ────────────
function addAliases(code, ctr) {
  const sc = mkVar(ctr.v++, "medium"), tc = mkVar(ctr.v++, "medium");
  const mf = mkVar(ctr.v++, "medium"), ts = mkVar(ctr.v++, "medium");
  const hd = [
    `local ${sc}=string.char;local ${tc}=table.concat;`,
    `local ${mf}=math.floor;local ${ts}=tostring;`,
    "",
  ].join("\n");
  return hd + code;
}

// ─── Step 8 (MAX): loadstring byte-encode everything ─────
// encode: b_encoded = (b + key) % 256  — never 0 for ASCII source (min result = 9+1=10)
// decode: b_decoded = (b_encoded - key + 256) % 256
function loadstringWrap(code) {
  const KEY = R(1, 100); // keeps encoded values between 10 and 226 (safe range)
  const bytes = Array.from(code).map(c => c.charCodeAt(0));
  const enc   = bytes.map(b => (b + KEY) % 256);

  const vD = `_D${R(1000,9999)}`;
  const vS = `_S${R(1000,9999)}`;
  const vI = `_I${R(1000,9999)}`;
  const vK = KEY;

  // chunk the array to avoid hitting Lua parse limits on huge arg lists
  const CHUNK = 200;
  const chunks = [];
  for (let i = 0; i < enc.length; i += CHUNK)
    chunks.push(`{${enc.slice(i, i + CHUNK).join(",")}}`);

  return [
    `local ${vD}={}`,
    `for _,_c in ipairs({${chunks.join(",")}})do`,
    `for _,_b in ipairs(_c)do ${vD}[#${vD}+1]=_b end`,
    `end`,
    `local ${vS}={}`,
    `for ${vI}=1,#${vD} do`,
    `${vS}[${vI}]=string.char((${vD}[${vI}]-${vK}+256)%256)`,
    `end`,
    `(loadstring or load)(table.concat(${vS}))()`,
  ].join(";");
}

// ─── MASTER ───────────────────────────────────────────────
function obfuscate(input, level) {
  const ctr = { v: 0 };
  const stats = { vars:0, strings:0, numbers:0, junk:0, inSize: input.length };

  const { code: c0, store } = extractStrings(input);
  let code = stripComments(c0);

  const vr = renameVars(code, level, ctr);
  code = vr.code; stats.vars = vr.count;

  if (level !== "standard") {
    const nr = obfuscateNums(code, level);
    code = nr.code; stats.numbers = nr.count;
  }

  // re-insert (now encoded) strings
  code = code.replace(/\x01(\d+)\x01/g, (_, i) => {
    const s = store[+i];
    if (!s) return '""';
    if (s.kind === "long") return s.raw;
    if (!s.content || !s.content.length) return s.raw;
    if (s.content.startsWith("rbxassetid") || s.content.length > 400) return s.raw;
    stats.strings++;
    return encodeStr(s.content);
  });

  const dr = injectDead(code, level, ctr);
  code = dr.code; stats.junk = dr.count;

  if (level !== "standard") code = addAliases(code, ctr);

  // max: encode the preprocessed output as a loadstring payload
  if (level === "max") {
    code = loadstringWrap(code);
    code = `-- LuaShield MAX | loadstring encoded\n` + code;
  } else {
    code = `-- LuaShield ${level === "standard" ? "Standard" : "Medium"}\n` + code;
  }

  stats.outSize = code.length;
  return { code, stats };
}

// ═══════════════════════════════════════════════════════════
//  UI
// ═══════════════════════════════════════════════════════════

const LEVELS = [
  {
    key: "standard",
    label: "Standard",
    tag: "VAR RENAME + STRING ENCODE + DEAD CODE",
    color: "#3de8a0",
  },
  {
    key: "medium",
    label: "Medium",
    tag: "STANDARD + NUM OBFUSCATION + STDLIB ALIASES",
    color: "#3db8ff",
  },
  {
    key: "max",
    label: "Max",
    tag: "ALL LAYERS + FULL LOADSTRING BYTE ENCODING",
    color: "#ff4d4d",
  },
];

const PLACEHOLDER = `-- Paste your Roblox script here
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local character = player.Character

local function greet(name)
    print("Hello, " .. name .. "!")
end

greet(player.Name)`;

export default function App() {
  const [input,  setInput]  = useState("");
  const [output, setOutput] = useState("");
  const [level,  setLevel]  = useState("medium");
  const [stats,  setStats]  = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy,   setBusy]   = useState(false);
  const [err,    setErr]    = useState("");

  const run = useCallback(() => {
    if (!input.trim() || busy) return;
    setBusy(true); setErr("");
    setTimeout(() => {
      try {
        const r = obfuscate(input, level);
        setOutput(r.code); setStats(r.stats);
      } catch (e) {
        setErr(e.message); setStats(null);
      }
      setBusy(false);
    }, 60);
  }, [input, level, busy]);

  const copy = () => {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const cur = LEVELS.find(l => l.key === level);
  const ratio = stats ? ((stats.outSize / stats.inSize) * 100).toFixed(0) : null;

  const TA = {
    width: "100%", height: "320px",
    background: "#0a0c10",
    border: "1px solid #1c2333",
    padding: "14px 16px",
    color: "#8fa8c8",
    fontFamily: "inherit",
    fontSize: "12.5px",
    lineHeight: "1.7",
    resize: "none",
    outline: "none",
    boxSizing: "border-box",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #070a0f; }
        textarea { outline: none; resize: none; }
        textarea::placeholder { color: #1e2a3a; }
        textarea:focus { border-color: #2a3a50 !important; }
        .lvl { transition: all 0.12s ease; cursor: pointer; }
        .lvl:hover { opacity: 1 !important; }
        .run-btn { transition: all 0.15s ease; }
        .run-btn:hover:not(:disabled) { filter: brightness(1.12); transform: translateY(-1px); }
        .run-btn:disabled { cursor: not-allowed; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0c10; }
        ::-webkit-scrollbar-thumb { background: #1c2333; border-radius: 3px; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "#070a0f",
        fontFamily: "'JetBrains Mono', monospace",
        color: "#c8d8e8",
        padding: "32px 24px 48px",
      }}>

        {/* ── Header ───────────────────────────── */}
        <div style={{ marginBottom: "36px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "6px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 800, letterSpacing: "-0.5px", color: "#e8f0f8" }}>
              LuaShield
            </h1>
            <span style={{ fontSize: "10px", color: "#2a3a50", letterSpacing: "2px" }}>v2.0</span>
            <span style={{ fontSize: "10px", color: "#2a3a50" }}>//</span>
            <span style={{ fontSize: "10px", color: "#2a3a50", letterSpacing: "1px" }}>ROBLOX LUA OBFUSCATOR</span>
          </div>
          <div style={{ height: "1px", background: "#111a28" }} />
        </div>

        {/* ── Level Select ─────────────────────── */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ fontSize: "10px", color: "#2a3a50", letterSpacing: "2px", marginBottom: "10px" }}>
            PROTECTION LEVEL
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {LEVELS.map(l => {
              const active = level === l.key;
              return (
                <button
                  key={l.key}
                  className="lvl"
                  onClick={() => setLevel(l.key)}
                  style={{
                    padding: "8px 18px",
                    background: active ? `${l.color}14` : "transparent",
                    border: `1px solid ${active ? l.color : "#1c2333"}`,
                    color: active ? l.color : "#2a3a50",
                    fontFamily: "inherit",
                    fontSize: "12px",
                    fontWeight: 700,
                    letterSpacing: "1px",
                    opacity: active ? 1 : 0.7,
                  }}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: "10px", color: "#2a3a50", letterSpacing: "1.5px", marginTop: "8px" }}>
            {cur.tag}
          </div>
        </div>

        {/* ── Editors ──────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
          {/* Input */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "10px", color: "#2a3a50", letterSpacing: "2px" }}>INPUT</span>
              <button
                onClick={() => { setInput(""); setOutput(""); setStats(null); setErr(""); }}
                style={{ background: "none", border: "none", color: "#1c2333", cursor: "pointer", fontFamily: "inherit", fontSize: "10px", letterSpacing: "1px" }}
              >
                CLEAR
              </button>
            </div>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              style={TA}
            />
            <div style={{ fontSize: "10px", color: "#1c2333", marginTop: "4px", textAlign: "right" }}>
              {input.length.toLocaleString()} chars
            </div>
          </div>

          {/* Output */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "10px", color: "#2a3a50", letterSpacing: "2px" }}>OUTPUT</span>
              {output && (
                <button
                  onClick={copy}
                  style={{
                    background: "none",
                    border: `1px solid ${copied ? "#3de8a0" : "#1c2333"}`,
                    color: copied ? "#3de8a0" : "#2a3a50",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: "10px",
                    letterSpacing: "1px",
                    padding: "3px 10px",
                    transition: "all 0.12s",
                  }}
                >
                  {copied ? "COPIED" : "▲ COPY"}
                </button>
              )}
            </div>
            <textarea
              readOnly
              value={output}
              placeholder="// output will appear here"
              spellCheck={false}
              style={{ ...TA, color: output ? "#4db890" : "#1c2333" }}
            />
            <div style={{ fontSize: "10px", color: "#1c2333", marginTop: "4px", textAlign: "right" }}>
              {output.length.toLocaleString()} chars
            </div>
          </div>
        </div>

        {/* ── Run Button ───────────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: "16px", marginBottom: "24px" }}>
          <button
            className="run-btn"
            onClick={run}
            disabled={!input.trim() || busy}
            style={{
              padding: "12px 52px",
              background: busy || !input.trim() ? "#0a0c10" : cur.color,
              border: `1px solid ${busy || !input.trim() ? "#1c2333" : cur.color}`,
              color: busy || !input.trim() ? "#1c2333" : "#060810",
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 800,
              letterSpacing: "3px",
            }}
          >
            {busy ? "PROCESSING..." : "OBFUSCATE"}
          </button>
        </div>

        {/* ── Error ────────────────────────────── */}
        {err && (
          <div style={{
            maxWidth: "720px", margin: "0 auto 20px",
            padding: "10px 16px",
            border: "1px solid #ff4d4d33",
            color: "#ff4d4d",
            fontSize: "11px", letterSpacing: "0.5px",
          }}>
            ERROR: {err}
          </div>
        )}

        {/* ── Stats ────────────────────────────── */}
        {stats && (
          <div style={{ maxWidth: "720px", margin: "0 auto" }}>
            <div style={{ height: "1px", background: "#111a28", marginBottom: "16px" }} />
            <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
              {[
                { k: "VARS RENAMED",   v: stats.vars,    c: "#c8a0ff" },
                { k: "STRINGS ENC",    v: stats.strings, c: "#3db8ff" },
                { k: "NUMS HIDDEN",    v: stats.numbers, c: "#ffa033" },
                { k: "DEAD LINES",     v: stats.junk,    c: "#ff6b6b" },
                { k: "SIZE RATIO",     v: ratio + "%",   c: "#3de8a0" },
              ].map(s => (
                <div key={s.k}>
                  <div style={{ fontSize: "9px", color: "#2a3a50", letterSpacing: "2px", marginBottom: "3px" }}>{s.k}</div>
                  <div style={{ fontSize: "20px", fontWeight: 800, color: s.c }}>{s.v}</div>
                </div>
              ))}
            </div>
            {level === "max" && (
              <div style={{ marginTop: "14px", fontSize: "10px", color: "#2a3a50", letterSpacing: "0.5px", lineHeight: 1.6 }}>
                Max level wraps the entire script in a loadstring byte payload.
                Requires bit32 library (available in Roblox). Re-run to regenerate with different keys.
              </div>
            )}
          </div>
        )}

      </div>
    </>
  );
}
