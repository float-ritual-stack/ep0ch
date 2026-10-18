(async function () {
  const source = new URL(location.href).searchParams.get("source");
  const parentOrigin = document.querySelector("p").dataset.parentOrigin;
  const scope = new URL(location.href).searchParams.get("scope");
  const endpoint = location.pathname.slice(0, -"/frame".length);
  const status = document.querySelector("p");
  let token;
  try {
    const response = await fetch(`${endpoint}/lease`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, scope }),
    });
    const lease = await response.json();
    if (!response.ok) throw new Error(lease.error);
    token = lease.token;
    status.textContent = "Connected to ep0ch";
    parent.postMessage({ kind: "ep0ch-ready" }, parentOrigin);
  } catch (error) {
    status.textContent = error.message;
    parent.postMessage({ kind: "ep0ch-ready", error: error.message }, parentOrigin);
    return;
  }
  window.addEventListener("message", async event => {
    if (event.origin !== parentOrigin || event.source !== parent || event.data?.kind !== "ep0ch-write") return;
    const { action, quote, block, body } = event.data;
    try {
      const response = await fetch(`${endpoint}/write`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, quote, block, body, source }),
      });
      const receipt = await response.json();
      parent.postMessage({ kind: "ep0ch-receipt", ok: receipt.ok, said: receipt.said, error: receipt.error }, parentOrigin);
    } catch {
      parent.postMessage({ kind: "ep0ch-receipt", ok: false, error: "Could not send; your words are still here" }, parentOrigin);
    }
  });
})();
