const at = new Date().toISOString();
const rows = [
  { id: "bean-dwarf", title: "Dwarf beans", properties: { family: ["beans/dwarf"], season: ["spring"], colour: ["green"] } },
  { id: "bean-runner", title: "Runner beans", properties: { family: ["beans/runner"], season: ["spring", "summer"], colour: ["red", "green"] } },
  { id: "lettuce-red", title: "Red lettuce", properties: { family: ["lettuce"], season: ["autumn"], colour: ["red"] } },
].map(row => ({ ...row, createdAt: at, updatedAt: at }));
await Bun.stdin.json();
console.log(JSON.stringify({ ok: true, value: { answer: JSON.stringify(rows) } }));
export {};
