(function (endpoint, styleText, scope) {
  const origin = new URL(endpoint).origin;
  if (location.origin === origin) { alert("Use this page's own reader controls; the bookmark reader needs a separate origin."); return; }
  const existing = document.getElementById("ep0ch-bookmark");
  if (existing) { existing.shadowRoot.querySelector("textarea").focus(); return; }
  const popup = window.open(`${endpoint.replace(/\/_reader$/, "/reader/approve")}?source=${encodeURIComponent(location.href)}`, "_blank", "popup,width=560,height=420");
  const selection = window.getSelection();
  const quote = selection?.toString() || "";
  const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
  const anchor = (node?.nodeType === 1 ? node : node?.parentElement)?.closest("[data-block]");
  const block = anchor?.getAttribute("data-block") || undefined;
  const root = document.createElement("div");
  root.id = "ep0ch-bookmark";
  const shadow = root.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styleText;
  const sheet = document.createElement("div");
  sheet.id = "mg-sheet";
  sheet.className = "mg-ui";
  const text = document.createElement("textarea");
  text.className = "mg-in";
  text.placeholder = "Comment or ask about the selected passage";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.textContent = popup ? "Allow this origin in the publisher window" : "Allow popups, then close and run the bookmark again. Your words stay here.";
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.title = "ep0ch reader connection";
  const frameUrl = `${endpoint}/frame?source=${encodeURIComponent(location.href)}&scope=${encodeURIComponent(scope)}`;
  frame.hidden = true;
  const buttons = ["Highlight", "Comment", "Ask"].map(label => {
    const button = document.createElement("button");
    button.textContent = label;
    button.disabled = true;
    button.onclick = () => {
      buttons.forEach(b => b.disabled = true);
      frame.contentWindow.postMessage({ kind: "ep0ch-write", action: label.toLowerCase(), quote, block, body: text.value }, origin);
    };
    return button;
  });
  const close = document.createElement("button");
  close.textContent = "Close";
  const receive = event => {
    if (event.source === popup && event.origin === origin && event.data?.kind === "ep0ch-approved") {
      if (event.data.allowed) { status.textContent = "Connecting to the outline…"; frame.src = frameUrl; }
      else status.textContent = "Origin denied. Your words are still here.";
      return;
    }
    if (event.source !== frame.contentWindow || event.origin !== origin) return;
    if (event.data?.kind === "ep0ch-ready") {
      status.textContent = event.data.error || "Reader ready";
      buttons.forEach(b => b.disabled = !!event.data.error);
    } else if (event.data?.kind === "ep0ch-receipt") {
      status.textContent = event.data.said || event.data.error;
      buttons.forEach(b => b.disabled = false);
      if (event.data.ok) text.value = "";
    }
  };
  close.onclick = () => { window.removeEventListener("message", receive); root.remove(); };
  window.addEventListener("message", receive);
  sheet.append(text, ...buttons, close, status, frame);
  shadow.append(style, sheet);
  document.body.append(root);
})
