import { useState, useCallback } from "react";

// ═══════════════════════════════════════════════════════════
//  💀 LUASHIELD ENGINE
// ═══════════════════════════════════════════════════════════

const ROBLOX_GLOBALS = new Set([
  "and","break","do","else","elseif","end","false","for","function","goto",
  "if","in","local","nil","not","or","repeat","return","then","true","until","while",
  "print","warn","error","assert","type","typeof","tostring","tonumber","rawget",
  "rawset","rawequal","rawlen","pairs","ipairs","next","select","unpack","pcall",
  "xpcall","setmetatable","getmetatable","collectgarbage","require","load",
  "loadstring","dofile","loadfile","_VERSION","string","table","math","os",
  "coroutine","debug","bit32","utf8","io","game","workspace","script",
  "_G","shared","_ENV","plugin","Instance","Vector3","Vector2","Vector2int16",
  "Vector3int16","CFrame","Color3","UDim","UDim2","Rect","Region3","BrickColor",
  "NumberRange","NumberSequence","ColorSequence","PhysicalProperties","Ray",
  "TweenInfo","Axes","Faces","PathWaypoint","RaycastParams","OverlapParams",
  "Enum","task","wait","spawn","delay","tick","time","elapsedTime",
  "Players","RunService","UserInputService","TweenService","ReplicatedStorage",
  "ServerStorage","StarterGui","StarterPack","StarterPlayer","Lighting",
  "SoundService","HttpService","DataStoreService","MessagingService",
  "RemoteEvent","RemoteFunction","BindableEvent","BindableFunction",
  "i","v","k","self","_",
]);

const EMOJIS = [
  "🔥","💀","⚡","🌀","👁","🔮","💫","🌊","🎭","🔑","⚔","🛡","🌑","🌟",
  "🗡","💣","🌪","🔐","💥","🦴","🧿","🎲","🃏","🧲","🔯","🌈","🪬","🧨",
  "🕳","🔻","🔺","💠","🔷","🔶","🎰","🎴","🧬","⛧","🕸","🦷",
];

const R = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const rEmoji = (n) => Array.from({ length: n }, () => EMOJIS[R(0, EMOJIS.length - 1)]).join("");

function mkVar(i, level) {
  const hex = i.toString(16).toUpperCase().padStart(4, "0");
  if (level === "standard") return `_0x${hex}`;
  if (level === "medium")   return `__${hex}__`;
  return `_${hex.split("").join("_")}_${R(0, 255).toString(16).toUpperCase().padStart(2, "0")}`;
}

// ── Step 1: extract string literals ──────────────────────
function extractStrings(code) {
  const store = [];
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      let j = i + 1, raw = c;
      while (j < code.length && code[j] !== c) {
        if (code[j] === "\\") { raw += code[j] + (code[j + 1] || ""); j += 2; }
        else raw += code[j++];
      }
      raw += code[j] || "";
      store.push({ raw, content: raw.slice(1, -1), kind: "quoted" });
      out += `\x01S${store.length - 1}\x01`;
      i = j + 1;
      continue;
    }
    if (c === "[") {
      let lvl = 0, k = i + 1;
      while (code[k] === "=") { lvl++; k++; }
      if (code[k] === "[") {
        const close = "]" + "=".repeat(lvl) + "]";
        const end = code.indexOf(close, k + 1);
        if (end !== -1) {
          store.push({ raw: code.slice(i, end + close.length), content: null, kind: "long" });
          out += `\x01S${store.length - 1}\x01`;
          i = end + close.length;
          continue;
        }
      }
    }
    out += c; i++;
  }
  return { code: out, store };
}

// ── Step 2: strip comments ────────────────────────────────
function stripComments(code) {
  code = code.replace(/--\[=*\[[\s\S]*?\]=*\]/g, " ");
  code = code.replace(/--[^\n]*/g, "");
  return code;
}

// ── Step 3: rename local vars ─────────────────────────────
function renameVars(code, level, ctr) {
  const map = new Map();
  let count = 0;
  const reg = (name) => {
    if (!map.has(name) && !ROBLOX_GLOBALS.has(name) && name.length > 0) {
      map.set(name, mkVar(ctr.v++, level));
      count++;
    }
  };
  for (const m of code.matchAll(/\blocal\s+((?:[a-zA-Z_]\w*\s*,\s*)*[a-zA-Z_]\w*)/g))
    m[1].split(",").map((s) => s.trim()).forEach(reg);
  for (const m of code.matchAll(/\bfunction\s*(?:[a-zA-Z_][\w.:\[\]"]*\s*)?\(([^)]*)\)/g))
    m[1].split(",").map((s) => s.trim().replace("...", "")).filter(Boolean).forEach(reg);
  for (const [orig, repl] of map) {
    const esc = orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    code = code.replace(new RegExp(`\\b${esc}\\b`, "g"), repl);
  }
  return { code, count };
}

// ── Step 4: obfuscate numbers ─────────────────────────────
function obfuscateNums(code, level) {
  let count = 0;
  const result = code.replace(/\b(\d+)\b/g, (m, s) => {
    const n = parseInt(s, 10);
    if (isNaN(n) || n === 0 || n > 999999) return m;
    count++;
    const a = R(500, 5000), b = n - a;
    return level === "max"
      ? `(${a}+${b}+(${R(10, 99)}-${R(10, 99)}))`
      : `(${a}+${b})`;
  });
  return { code: result, count };
}

// ── Step 5: encode strings ────────────────────────────────
function encodeStr(content, level) {
  if (!content) return '""';
  const bytes = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === "\\") {
      const n = content[i + 1];
      const esc = { n: 10, t: 9, r: 13, "\\": 92, '"': 34, "'": 39 };
      if (esc[n] !== undefined) { bytes.push(esc[n]); i += 2; continue; }
      if (/\d/.test(n)) {
        let num = "", k = i + 1;
        while (k < content.length && /\d/.test(content[k]) && num.length < 3) num += content[k++];
        bytes.push(parseInt(num, 10)); i = k; continue;
      }
      bytes.push(content.charCodeAt(i)); i++;
    } else { bytes.push(content.charCodeAt(i)); i++; }
  }
  if (!bytes.length) return '""';
  if (level === "max") {
    const key = R(50, 220);
    const enc = bytes.map((b) => b ^ key);
    return `(function()local _k=${key};local _d={${enc.join(",")}};local _r={};for _i=1,#_d do _r[_i]=string.char(bit32.bxor(_d[_i],_k))end;return table.concat(_r)end)()`;
  }
  return `(function()local _t={};for _,_c in ipairs({${bytes.join(",")}})do _t[#_t+1]=string.char(_c)end;return table.concat(_t)end)()`;
}

// ── Step 6: inject junk + emoji chaos ────────────────────
function injectJunk(code, level, ctr) {
  const jFreq = { standard: 0.07, medium: 0.15, max: 0.25 }[level];
  const eFreq = { standard: 0.0,  medium: 0.09, max: 0.20 }[level];
  let junkCount = 0;
  const lines = code.split("\n");
  const out = [];
  for (const line of lines) {
    out.push(line);
    if (!line.trim()) continue;
    if (Math.random() < jFreq) {
      const v = mkVar(ctr.v++, level);
      const picks = ["nil", "false", `(${R(100, 9999)}+0)`, '""', `${R(1, 99)}`];
      out.push(`local ${v}=${picks[R(0, picks.length - 1)]};`);
      junkCount++;
    }
    if (Math.random() < eFreq) out.push(`--${rEmoji(R(6, 14))}`);
  }
  return { code: out.join("\n"), junkCount };
}

// ── Step 7: control flow wrap (max) ──────────────────────
function flowWrap(code, ctr) {
  const v1 = mkVar(ctr.v++, "max"), v2 = mkVar(ctr.v++, "max");
  const n = R(1000, 9999);
  return [
    `--${rEmoji(22)}`, `--${rEmoji(22)}`,
    `local ${v1}=${n};local ${v2}=function(_x)return _x==${n}end`,
    `if ${v2}(${v1})then`,
    code,
    `end`,
    `--${rEmoji(22)}`, `--${rEmoji(22)}`,
  ].join("\n");
}

function makeHeader(level) {
  if (level === "standard")
    return `-- 🔒 Protected by LuaShield | Standard\n`;
  if (level === "medium")
    return `--${rEmoji(20)}\n-- 🔒 LuaShield Medium Protection\n--${rEmoji(20)}\n`;
  return [
    `--${rEmoji(24)}`, `--${rEmoji(24)}`,
    `-- 💀⚡🔮  LUASHIELD MAX PROTECTION  🔮⚡💀`,
    `-- ⚔  This script is heavily obfuscated  ⚔`,
    `--${rEmoji(24)}`, `--${rEmoji(24)}`, "",
  ].join("\n");
}

// ── MASTER OBFUSCATE ──────────────────────────────────────
function obfuscate(input, level) {
  const ctr = { v: 0 };
  const stats = { vars: 0, strings: 0, numbers: 0, junk: 0, inSize: input.length };

  const { code: c0, store } = extractStrings(input);
  let code = stripComments(c0);

  const vr = renameVars(code, level, ctr);
  code = vr.code; stats.vars = vr.count;

  if (level !== "standard") {
    const nr = obfuscateNums(code, level);
    code = nr.code; stats.numbers = nr.count;
  }

  // Re-insert encoded strings
  code = code.replace(/\x01S(\d+)\x01/g, (_, i) => {
    const s = store[+i];
    if (!s) return '""';
    if (s.kind === "long") return s.raw;
    if (!s.content || !s.content.length) return '""';
    if (s.content.startsWith("rbxassetid") || s.content.length > 300) return s.raw;
    stats.strings++;
    return encodeStr(s.content, level);
  });

  const jr = injectJunk(code, level, ctr);
  code = jr.code; stats.junk = jr.junkCount;

  if (level === "max") code = flowWrap(code, ctr);
  code = makeHeader(level) + code;

  stats.outSize = code.length;
  return { code, stats };
}

// ═══════════════════════════════════════════════════════════
//  🎨 UI
// ═══════════════════════════════════════════════════════════

const LEVELS = [
  {
    key: "standard", label: "Standard", icon: "🛡", color: "#22d3ee",
    desc: "Variable renaming · String encoding · Light junk injection",
  },
  {
    key: "medium", label: "Medium", icon: "⚔", color: "#a78bfa",
    desc: "Standard + Number obfuscation · Emoji chaos · Heavy junk",
  },
  {
    key: "max", label: "MAX", icon: "💀", color: "#f43f5e",
    desc: "XOR strings · Control flow wrapping · Maximum destruction",
  },
];

const PLACEHOLDER = `-- Paste your Roblox Lua script here
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local character = player.Character

local function greet(name)
    print("Hello, " .. name .. "!")
end

greet(player.Name)`;

export default function LuaShield() {
  const [input,  setInput]  = useState("");
  const [output, setOutput] = useState("");
  const [level,  setLevel]  = useState("medium");
  const [stats,  setStats]  = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy,   setBusy]   = useState(false);

  const run = useCallback(() => {
    if (!input.trim() || busy) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const r = obfuscate(input, level);
        setOutput(r.code);
        setStats(r.stats);
      } catch (e) {
        setOutput(`-- ❌ Obfuscation error:\n-- ${e.message}`);
        setStats(null);
      }
      setBusy(false);
    }, 60);
  }, [input, level, busy]);

  const copy = () => {
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const cur = LEVELS.find((l) => l.key === level);

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #070a10; }
    textarea { outline: none; resize: none; }
    textarea:focus { border-color: #1e3a5f !important; }
    .btn-obf {
      background: linear-gradient(135deg, #7c3aed 0%, #0e7490 100%);
      transition: all 0.2s;
      box-shadow: 0 0 40px #7c3aed44, 0 0 80px #06b6d422;
    }
    .btn-obf:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 60px #7c3aed66, 0 0 100px #06b6d433;
    }
    .btn-obf:disabled { background: #0d1117 !important; box-shadow: none !important; }
    .lvl-btn { transition: all 0.15s; }
    .lvl-btn:hover { transform: translateY(-1px); }
    .stat-card { transition: transform 0.2s; }
    .stat-card:hover { transform: translateY(-2px); }
    .scanline {
      background: repeating-linear-gradient(0deg, transparent, transparent 2px, #ffffff04 2px, #ffffff04 4px);
      pointer-events: none;
    }
  `;

  return (
    <>
      <style>{css}</style>
      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 15% 15%, #120c2a44 0%, transparent 55%), radial-gradient(ellipse at 85% 85%, #042a3a33 0%, transparent 55%), #070a10",
        fontFamily: "'Share Tech Mono', monospace",
        color: "#e2e8f0",
        padding: "28px 20px 40px",
      }}>

        {/* ── Header ─────────────────────────────── */}
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "10px",
            background: "#0d1117", border: "1px solid #1a2540",
            borderRadius: "50px", padding: "6px 20px", marginBottom: "16px",
          }}>
            <span style={{ fontSize: "11px", color: "#334155", letterSpacing: "3px", textTransform: "uppercase" }}>
              v1.0
            </span>
            <span style={{ color: "#1e293b" }}>|</span>
            <span style={{ fontSize: "11px", color: "#4ade8088", letterSpacing: "2px" }}>ROBLOX LUAU</span>
          </div>
          <div>
            <h1 style={{
              fontSize: "42px", fontWeight: 800, letterSpacing: "-2px",
              fontFamily: "'Rajdhani', sans-serif",
              background: "linear-gradient(90deg, #a855f7, #22d3ee, #f43f5e, #a855f7)",
              backgroundSize: "300% 100%",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              animation: "none",
            }}>
              LuaShield
            </h1>
            <p style={{ color: "#334155", fontSize: "11px", letterSpacing: "4px", textTransform: "uppercase", marginTop: "4px" }}>
              Script Obfuscator
            </p>
          </div>
        </div>

        {/* ── Level Selector ──────────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginBottom: "10px" }}>
          {LEVELS.map((l) => (
            <button key={l.key} className="lvl-btn" onClick={() => setLevel(l.key)} style={{
              padding: "10px 24px", borderRadius: "50px", cursor: "pointer",
              fontFamily: "'Rajdhani', sans-serif", fontSize: "14px", fontWeight: 700,
              letterSpacing: "1px", textTransform: "uppercase",
              border: `2px solid ${level === l.key ? l.color : "#1a2540"}`,
              background: level === l.key ? `${l.color}18` : "#0a0d14",
              color: level === l.key ? l.color : "#334155",
              boxShadow: level === l.key ? `0 0 20px ${l.color}33` : "none",
              display: "flex", alignItems: "center", gap: "7px",
            }}>
              <span style={{ fontSize: "16px" }}>{l.icon}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
        <p style={{ textAlign: "center", fontSize: "11px", color: "#2d3a50", marginBottom: "24px", letterSpacing: "0.5px" }}>
          {cur.desc}
        </p>

        {/* ── Editor Grid ─────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "18px" }}>

          {/* Input */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
              <span style={{ fontSize: "10px", color: "#334155", letterSpacing: "2px", textTransform: "uppercase", fontWeight: 700 }}>
                📋 Input Script
              </span>
              <button onClick={() => { setInput(""); setOutput(""); setStats(null); }} style={{
                background: "none", border: "none", color: "#1e293b", cursor: "pointer",
                fontSize: "11px", fontFamily: "inherit", letterSpacing: "1px",
              }}>
                clear ✕
              </button>
            </div>
            <div style={{ position: "relative" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={PLACEHOLDER}
                spellCheck={false}
                style={{
                  width: "100%", height: "350px",
                  background: "#0b0e17", border: "1px solid #141c2e", borderRadius: "12px",
                  padding: "16px", color: "#8bafc8", fontFamily: "'Share Tech Mono', monospace",
                  fontSize: "12.5px", lineHeight: "1.7",
                }}
              />
              <div className="scanline" style={{ position: "absolute", inset: 0, borderRadius: "12px" }} />
            </div>
            <div style={{ textAlign: "right", fontSize: "10px", color: "#1a2540", marginTop: "5px" }}>
              {input.length.toLocaleString()} chars
            </div>
          </div>

          {/* Output */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "7px" }}>
              <span style={{ fontSize: "10px", color: "#334155", letterSpacing: "2px", textTransform: "uppercase", fontWeight: 700 }}>
                🔮 Obfuscated Output
              </span>
              {output && (
                <button onClick={copy} style={{
                  background: copied ? "#16a34a18" : "#0a0d14",
                  border: `1px solid ${copied ? "#16a34a" : "#1a2540"}`,
                  borderRadius: "6px", color: copied ? "#4ade80" : "#334155",
                  cursor: "pointer", fontSize: "11px", padding: "3px 12px",
                  fontFamily: "inherit", letterSpacing: "1px",
                  display: "flex", alignItems: "center", gap: "5px",
                  transition: "all 0.15s",
                }}>
                  ▲ {copied ? "Copied!" : "Copy"}
                </button>
              )}
            </div>
            <div style={{ position: "relative" }}>
              <textarea
                readOnly
                value={output}
                placeholder="// Obfuscated output will appear here..."
                spellCheck={false}
                style={{
                  width: "100%", height: "350px",
                  background: "#0b0e17", border: "1px solid #141c2e", borderRadius: "12px",
                  padding: "16px",
                  color: output ? "#5de8c8" : "#1a2540",
                  fontFamily: "'Share Tech Mono', monospace", fontSize: "12.5px", lineHeight: "1.7",
                }}
              />
              <div className="scanline" style={{ position: "absolute", inset: 0, borderRadius: "12px" }} />
            </div>
            <div style={{ textAlign: "right", fontSize: "10px", color: "#1a2540", marginTop: "5px" }}>
              {output.length.toLocaleString()} chars
            </div>
          </div>
        </div>

        {/* ── Obfuscate Button ────────────────────── */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "28px" }}>
          <button
            className="btn-obf"
            onClick={run}
            disabled={!input.trim() || busy}
            style={{
              padding: "15px 64px", borderRadius: "50px", border: "none",
              color: busy || !input.trim() ? "#2d3a50" : "#fff",
              cursor: input.trim() && !busy ? "pointer" : "not-allowed",
              fontFamily: "'Rajdhani', sans-serif", fontSize: "16px", fontWeight: 800,
              letterSpacing: "3px", textTransform: "uppercase",
            }}
          >
            {busy ? "🔄  Processing..." : `💀  Obfuscate  ${cur.icon}`}
          </button>
        </div>

        {/* ── Stats ───────────────────────────────── */}
        {stats && (() => {
          const ratio = stats.inSize > 0 ? ((stats.outSize / stats.inSize) * 100).toFixed(0) : 0;
          const cards = [
            { icon: "🔄", label: "Vars Renamed",    val: stats.vars,    color: "#a855f7" },
            { icon: "🔐", label: "Strs Encoded",    val: stats.strings, color: "#22d3ee" },
            { icon: "🔢", label: "Nums Hidden",      val: stats.numbers, color: "#fb923c" },
            { icon: "💣", label: "Junk Lines",       val: stats.junk,    color: "#f43f5e" },
            { icon: "📊", label: "Size Ratio",       val: `${ratio}%`,   color: "#fbbf24" },
          ];
          return (
            <div style={{ maxWidth: "720px", margin: "0 auto" }}>
              <p style={{ textAlign: "center", fontSize: "10px", color: "#1e293b", letterSpacing: "3px", textTransform: "uppercase", marginBottom: "12px" }}>
                ── Obfuscation Report ──
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px" }}>
                {cards.map((c) => (
                  <div key={c.label} className="stat-card" style={{
                    background: "#0b0e17", border: `1px solid ${c.color}22`,
                    borderRadius: "10px", padding: "14px 8px", textAlign: "center",
                    boxShadow: `0 0 20px ${c.color}0a`,
                  }}>
                    <div style={{ fontSize: "22px", marginBottom: "6px" }}>{c.icon}</div>
                    <div style={{ fontSize: "20px", fontWeight: 900, color: c.color, fontFamily: "'Rajdhani', sans-serif" }}>{c.val}</div>
                    <div style={{ fontSize: "9px", color: "#1e293b", textTransform: "uppercase", letterSpacing: "0.8px", marginTop: "3px" }}>{c.label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* ── Footer ──────────────────────────────── */}
        <p style={{ textAlign: "center", color: "#111827", fontSize: "10px", marginTop: "36px", letterSpacing: "2px" }}>
          LUASHIELD · ROBLOX LUAU OBFUSCATOR
        </p>
      </div>
    </>
  );
}
