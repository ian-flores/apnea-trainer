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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
