// Smoke tests for the pure logic in index.html (table generation, formatting,
// phase sequencing, orb math). Run: node test.js
"use strict";
const fs = require("fs");
const vm = require("vm");

// The app's script self-exports its pure helpers when run under Node
// (it returns early via module.exports before touching the DOM).
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const code = blocks[blocks.length - 1][1];
const sandbox = { module: { exports: {} }, window: {}, document: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const L = sandbox.module.exports;

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } }

// fmt
ok("fmt 0", L.fmt(0) === "0:00");
ok("fmt 5", L.fmt(5) === "0:05");
ok("fmt 65", L.fmt(65) === "1:05");
ok("fmt 125", L.fmt(125) === "2:05");
ok("fmt neg", L.fmt(-3) === "0:00");

// CO2 table from 3:00 max (180s)
const c = L.genCO2(180);
ok("co2 rounds", c.rounds === 8);
ok("co2 hold=90", c.hold === 90);
ok("co2 rests length", c.rests.length === 8);
ok("co2 rest0=120", c.rests[0] === 120);
ok("co2 rest7=15", c.rests[7] === 15);
ok("co2 rests decreasing", c.rests.every((v, i) => i === 0 || v < c.rests[i - 1]));
ok("co2 min hold 30", L.genCO2(20).hold === 30);

// O2 table from 180s
const o = L.genO2(180);
ok("o2 rest const 120", o.rest === 120);
ok("o2 holds len", o.holds.length === 8);
ok("o2 holds increasing", o.holds.every((v, i) => i === 0 || v >= o.holds[i - 1]));
ok("o2 holds within max", o.holds[o.holds.length - 1] <= 180);
ok("o2 start<end", o.holds[0] < o.holds[7]);

// phases: free
const pf = L.buildPhases("free", { breatheUp: true, maxHold: 90 });
ok("free 3 phases", pf.length === 3);
ok("free[0] breatheup", pf[0].kind === "breatheup");
ok("free[1] ready", pf[1].kind === "ready");
ok("free[2] hold countUp", pf[2].kind === "hold" && pf[2].dur === null && pf[2].countUp === true);
const pf2 = L.buildPhases("free", { breatheUp: false, maxHold: 90 });
ok("free no-breatheup 2 phases", pf2.length === 2 && pf2[0].kind === "ready");

// phases: co2 / o2
const pc = L.buildPhases("co2", { maxHold: 180 });
ok("co2 16 phases", pc.length === 16);
ok("co2 phase0 breatheup early", pc[0].kind === "breatheup" && pc[0].early === true);
ok("co2 phase1 hold dur", pc[1].kind === "hold" && pc[1].dur === 90);
ok("co2 last is hold", pc[pc.length - 1].kind === "hold");
ok("co2 rounds tagged", pc[15].round === 8 && pc[15].rounds === 8);

// phases: box
const pb = L.buildPhases("box", {});
ok("box 32 phases", pb.length === 32);
ok("box cycle kinds", pb[0].kind === "inhale" && pb[1].kind === "holdFull" && pb[2].kind === "exhale" && pb[3].kind === "holdEmpty");

// orbScale bounds
const LO = 0.62, HI = 1.32;
ok("inhale start ~LO", Math.abs(L.orbScale("inhale", 0, 4) - LO) < 0.001);
ok("inhale end ~HI", Math.abs(L.orbScale("inhale", 4, 4) - HI) < 0.001);
ok("exhale start ~HI", Math.abs(L.orbScale("exhale", 0, 4) - HI) < 0.001);
ok("exhale end ~LO", Math.abs(L.orbScale("exhale", 4, 4) - LO) < 0.001);
ok("holdEmpty=LO", L.orbScale("holdEmpty", 2, 4) === LO);
ok("hold near HI", Math.abs(L.orbScale("hold", 1, null) - HI) < 0.02);
let inb = true;
for (let e = 0; e <= 16; e += 0.25) { const s = L.orbScale("breatheup", e, null); if (s < 0.5 || s > 1.4) inb = false; }
ok("breatheup within bounds", inb);
ok("ready expands", L.orbScale("ready", 0, 4) < L.orbScale("ready", 4, 4));

// catchUp: advances past elapsed phases without drift
const cp = L.buildPhases("co2", { maxHold: 180 }); // rests 120,105,... hold 90
let r = L.catchUp(cp, 0, 0, 119000);
ok("catchUp mid-phase stays", r.idx === 0 && r.phaseStart === 0 && !r.done);
r = L.catchUp(cp, 0, 0, 120000);
ok("catchUp boundary advances", r.idx === 1 && r.phaseStart === 120000);
r = L.catchUp(cp, 0, 0, 120000 + 90000 + 105000 + 1000); // rest, hold, rest elapsed
ok("catchUp skips several phases", r.idx === 3 && r.phaseStart === 315000 && !r.done);
const total = cp.reduce((a, p) => a + p.dur, 0) * 1000;
r = L.catchUp(cp, 0, 0, total + 5000);
ok("catchUp past end is done", r.done === true);
const fp = L.buildPhases("free", { breatheUp: true, maxHold: 90 });
r = L.catchUp(fp, 0, 0, 10 * 60 * 1000);
ok("catchUp stops at open-ended hold", r.idx === 2 && r.phaseStart === 44000 && !r.done);

// holdSeries: dated max holds only, oldest first
const hist = [
  { label: "Max hold", value: "1:40", t: 3000, sec: 100 },
  { label: "CO2 table · complete", value: "done", t: 2500 },
  { label: "Max hold", value: "1:30" },                       // legacy, undated
  { label: "Max hold · new best", value: "1:50", t: 1000, sec: 110 },
];
const ser = L.holdSeries(hist);
ok("holdSeries filters", ser.length === 2);
ok("holdSeries ascending", ser[0].t === 1000 && ser[1].sec === 100);

// chartGeom
const pad = { l: 30, r: 10, t: 10, b: 20 };
const g = L.chartGeom([{ t: 0, sec: 60 }, { t: 100, sec: 120 }], 340, 130, pad);
ok("geom yMax above best", g.yMax >= 120 * 1.12 && g.yMax % 30 === 0);
ok("geom x spans plot", g.pts[0].x === 30 && g.pts[1].x === 330);
ok("geom higher hold plots higher", g.pts[1].y < g.pts[0].y);
ok("geom ticks start at 0 on baseline", g.ticks[0].sec === 0 && g.ticks[0].y === 110);
ok("geom top tick at plot top", g.ticks[g.ticks.length - 1].y === 10);
const g1 = L.chartGeom([{ t: 5, sec: 300 }, { t: 5, sec: 310 }], 340, 130, pad);
ok("geom same-time points centered, no NaN", g1.pts.every(p => p.x === 180 && !isNaN(p.y)));
ok("geom long holds use 60s steps", g1.ticks[1].sec === 60);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
