-- Native presentation only: the bridge and scratch outline own all content.
-- Replies open Tern's real file block; this block never edits text or types into a terminal.
local ui = tern.ui
local active = {}
local EVERY_MS = 3000
local ITEM_PREFIX = "main.workspace.overview.cards."
local tones = { finding = "info", option = "accent", question = "warning", evidence = "muted" }
local verdictTones = { keep = "success", question = "warning", park = "muted", reply = "user" }

local function with(node, props)
	local p = node.p or {}
	for key, value in props do p[key] = value end
	node.p = p
	return node
end

local function text(value, style, key)
	return with(ui.text({ ui.span(value, style) }), { key = key, role = "return-room.literal" })
end

local function button(label, action, tone, key)
	return ui.el("button", {
		text = label, key = key or action, class = "rr-action", tone = tone or "neutral",
		actions = { click = action },
	})
end

local function row(children, key)
	return with(ui.row(children), { key = key, wrap = true, role = "return-room.actions" })
end

local function alive(state, cx)
	if active[cx.pane] ~= state or state.stopped then return false end
	for _, pane in tern.pane.list() do
		if pane.pane == cx.pane then return true end
	end
	state.stopped = true
	active[cx.pane] = nil
	if state.timer then state.timer:cancel(); state.timer = nil end
	return false
end

local function selected(state)
	return state.byId[state.selection]
end

local function anchor(card)
	return card.id .. "|" .. tostring(card.revision)
end

local function findAnchor(state, value)
	if not value then return selected(state) end
	local id, revision = string.match(value, "^([^|]+)|(%d+)$")
	local card = id and state.byId[id]
	if not card then return nil end
	-- The click's revision is the one rendered, not a later polling result.
	return { id = card.id, revision = tonumber(revision), evidence = card.evidence, title = card.title }
end

local function applySnapshot(state, snapshot)
	if type(snapshot) ~= "table" or type(snapshot.cards) ~= "table" or type(snapshot.feedback) ~= "table" then
		error("Bridge returned an invalid snapshot; run the bridge snapshot command to inspect its JSON.")
	end
	local byId, latest, feedback = {}, {}, {}
	for _, card in snapshot.cards do byId[card.id] = card end
	for _, response in snapshot.feedback do
		local items = feedback[response.card] or {}
		feedback[response.card] = items
		table.insert(items, response)
		local previous = latest[response.card]
		if not previous or response.updated >= previous.updated then latest[response.card] = response end
	end
	state.snapshot, state.byId, state.latest, state.feedback = snapshot, byId, latest, feedback
	if not byId[state.selection] then state.selection = if snapshot.cards[1] then snapshot.cards[1].id else "" end
	-- An incomplete read must not erase a person's saved pins.
	if snapshot.complete then
		local pins = {}
		for _, id in state.pins do if byId[id] then table.insert(pins, id) end end
		state.pins = pins
	end
	state.synced = true
end

local request
request = function(state, cx, operation, input, onSuccess)
	if not alive(state, cx) then return end
	if state.busy then
		if operation == "snapshot" then state.refreshPending = true
		else state.actionError = "Still " .. state.busy .. ". Wait for completion, then choose the action again; nothing was queued." end
		return
	end
	state.busy = operation
	if operation ~= "snapshot" then state.actionError = nil end
	local argv = { "bun", tern.plugin.dir .. "/../bridge.ts" }
	if state.config and state.config ~= "" then
		table.insert(argv, "--config"); table.insert(argv, state.config)
	end
	table.insert(argv, operation)
	table.insert(argv, tern.json.encode(input))
	local function complete(ok, result)
		if not alive(state, cx) then return end
		state.busy = nil
		if ok then
			local accepted, err = pcall(onSuccess, result)
			if not accepted then ok, result = false, tostring(err) end
		end
		if not ok then
			local message = operation .. ": " .. tostring(result)
			if operation == "snapshot" then state.syncError = message else state.actionError = message end
		elseif operation == "snapshot" then
			state.syncError = nil
		end
		cx:render()
		if state.refreshPending then
			state.refreshPending = false
			request(state, cx, "snapshot", {}, function(snapshot) applySnapshot(state, snapshot) end)
		end
	end
	local started, err = pcall(function()
		tern.process.run(argv, { cwd = cx.cwd, timeout_ms = 15000 }, function(result)
			if not alive(state, cx) then return end
			if result.status ~= 0 or result.timed_out then
				local why = if result.timed_out then "bridge timed out after 15 seconds" else result.stderr
				if why == "" then why = "bridge exited " .. tostring(result.status) end
				complete(false, why .. "\nCheck the scratch host and RETURN_ROOM_CONFIG, then press r to refresh. For a write, inspect feedback before retrying; completion may be uncertain.")
				return
			end
			local decoded, value = pcall(tern.json.decode, result.stdout)
			complete(decoded, value)
		end)
	end)
	if not started then complete(false, tostring(err) .. "\nEnsure bun is on the scratch daemon's PATH, then press r.") end
end

local function refresh(state, cx)
	request(state, cx, "snapshot", {}, function(snapshot) applySnapshot(state, snapshot) end)
end

local function poll(state, cx)
	state.timer = tern.timer(EVERY_MS, function()
		state.timer = nil
		if not alive(state, cx) then return end
		if not state.busy then refresh(state, cx) end
		poll(state, cx)
	end)
end

local function dispatch(state, cx, action, value)
	if action == "refresh" then refresh(state, cx); return true end
	if action == "dismiss" then state.actionError = nil; state.notice = nil; return true end
	if action == "previous" or action == "next" then
		local cards = state.snapshot and state.snapshot.cards or {}
		for index, card in cards do
			if card.id == state.selection then
				local target = math.clamp(index + (if action == "next" then 1 else -1), 1, #cards)
				state.selection = cards[target].id
				return true
			end
		end
		return false
	end
	if action == "select" and state.byId[value] then state.selection = value; return true end
	local card = findAnchor(state, value)
	if not card then state.actionError = "Select a returned card first. Press r to refresh the room."; return true end
	if action == "pin" then
		local index = table.find(state.pins, card.id)
		if index then table.remove(state.pins, index)
		elseif #state.pins < 2 then table.insert(state.pins, card.id)
		else state.actionError = "Two cards are already pinned. Unpin one before adding another; your comparison was kept." end
		return true
	end
	if action == "evidence" then
		if card.evidence and card.evidence ~= "" then cx:open(card.evidence)
		else state.actionError = "This card has no evidence path. Choose a card with evidence." end
		return true
	end
	if action == "edit" then
		request(state, cx, "draft", { card = card.id }, function(result)
			if type(result.path) ~= "string" or result.path == "" then error("Draft response has no file path") end
			-- Reopening an existing reply never silently moves its revision anchor.
			if type(result.revision) ~= "number" then error("Draft response has no saved revision anchor") end
			state.drafts[card.id] = { revision = result.revision, path = result.path }
			state.notice = "Reply opened in Tern's file editor. Save there, return here, then press s to send the saved file."
			cx:open(result.path)
		end)
		return true
	end
	if action == "send" then
		local draft = state.drafts[card.id]
		if not draft then state.actionError = "Press e to open the reply in Tern's file editor, save it, then press s. No reply was sent."; return true end
		request(state, cx, "send-draft", { card = card.id, revision = draft.revision }, function(response)
			state.notice = "Saved reply sent to the originating session · revision " .. tostring(response.revision) .. ". The draft file is retained."
			state.refreshPending = true
		end)
		return true
	end
	if action == "keep" or action == "question" or action == "park" then
		request(state, cx, "respond", { card = card.id, revision = card.revision, verdict = action }, function(response)
			state.notice = "Recorded " .. action .. " · revision " .. tostring(response.revision) .. " · author:user."
			state.refreshPending = true
		end)
		return true
	end
	return false
end

local function feedbackView(state, card)
	local responses = state.feedback[card.id] or {}
	if #responses == 0 then return text("No person feedback yet.", "muted", "feedback-empty") end
	local items = {}
	-- Show the whole durable record, newest timestamp first, not just current-revision feedback.
	local ordered = table.clone(responses)
	table.sort(ordered, function(a, b) return a.updated > b.updated end)
	for _, response in ordered do
		local stale = response.revision ~= card.revision
		table.insert(items, with(ui.card({
			ui.span(response.verdict, "strong"),
			ui.span(" · r" .. tostring(response.revision) .. (if stale then " · older source revision" else " · current source revision"), if stale then "warning" else "muted"),
		}, {
			text(response.author .. " · " .. response.updated, "muted", "who"),
			text(if response.text ~= "" then response.text else "Recorded without a written reply.", nil, "body"),
		}), { key = response.id, tone = verdictTones[response.verdict] or "neutral", role = "return-room.feedback" }))
	end
	return with(ui.section("Person feedback · " .. tostring(#responses), items), { key = "feedback", collapsible = true })
end

local function cardView(state, card, key, compact)
	local payload = anchor(card)
	local pinned = table.find(state.pins, card.id) ~= nil
	local children = {
		row({ ui.badge(card.kind, tones[card.kind] or "neutral"), ui.badge("r" .. tostring(card.revision), "neutral"),
			text(card.author .. " · " .. card.session, "muted", "origin") }, "provenance"),
		text(card.body, nil, "body"),
		text("Updated " .. card.updated, "muted", "updated"),
	}
	if card.evidence ~= "" then
		table.insert(children, row({ button("o Evidence", "evidence=" .. payload, "info", "open"), text(card.evidence, "path", "path") }, "evidence"))
	end
	table.insert(children, row({
		button("1 Keep", "keep=" .. payload, "success", "keep"),
		button("2 Question", "question=" .. payload, "warning", "question"),
		button("3 Park", "park=" .. payload, "muted", "park"),
		button(if pinned then "c Unpin" else "c Compare pin", "pin=" .. payload, if pinned then "accent" else "neutral", "pin"),
	}, "verdicts"))
	if compact then
		local latest = state.latest[card.id]
		if latest then table.insert(children, text("Latest: " .. latest.verdict .. " · r" .. tostring(latest.revision) .. " · " .. latest.author, if latest.revision == card.revision then "muted" else "warning", "latest")) end
		table.insert(children, button("Select for reply", "select=" .. card.id, "accent", "select"))
	else
		local draft = state.drafts[card.id]
		table.insert(children, with(ui.card("Reply to the originating session", {
			text("Use Tern's file editor. Save the file there; Send reads only disk, never unsaved editor text.", "muted", "instructions"),
			row({ button("e Edit reply", "edit=" .. payload, "accent", "edit"), button("s Send saved reply", "send=" .. payload, "user", "send") }, "actions"),
			text(if draft then "Reply anchor: r" .. tostring(draft.revision) .. (if draft.revision ~= card.revision then " · source has changed; send preserves the older revision" else "") .. "\n" .. draft.path else "No reply opened for this card yet.", if draft and draft.revision ~= card.revision then "warning" else "muted", "anchor"),
		}), { key = "reply", tone = "user", role = "return-room.reply" }))
		table.insert(children, feedbackView(state, card))
	end
	return with(ui.card({ ui.span(card.title, "strong") }, children), {
		key = key, role = "return-room.card", tone = tones[card.kind] or "neutral", grow = 1, basis = 0.5,
	})
end

tern.block.define("room", {
	init = function(cx, args, saved)
		local restored = if type(saved) == "table" then saved else {}
		local state = {
			config = restored.config or args[1] or tern.getenv("RETURN_ROOM_CONFIG"),
			selection = restored.selection or "", pins = restored.pins or {}, drafts = restored.drafts or {},
			byId = {}, latest = {}, feedback = {}, snapshot = nil, busy = nil, stopped = false,
			refreshPending = false, synced = false,
		}
		active[cx.pane] = state
		refresh(state, cx)
		poll(state, cx)
		return state
	end,
	title = function(state)
		return "Return Room" .. (if state.snapshot then " · " .. state.snapshot.title else "")
	end,
	save = function(state)
		return { version = 1, config = state.config, selection = state.selection,
			pins = tern.json.array(state.pins), drafts = state.drafts }
	end,
	key = function(state, key, cx)
		if key.ctrl or key.alt or key.meta then return false end
		local actions = { j = "next", down = "next", k = "previous", up = "previous", c = "pin",
			["1"] = "keep", ["2"] = "question", ["3"] = "park", e = "edit", s = "send", o = "evidence", r = "refresh" }
		local action = actions[key.name]
		return if action then dispatch(state, cx, action) else false
	end,
	event = function(state, event, cx)
		if event.ev == "action" then dispatch(state, cx, event.act, event.value)
		elseif (event.ev == "select" or event.ev == "activate") and event.item then
			if string.sub(event.item, 1, #ITEM_PREFIX) == ITEM_PREFIX then
				dispatch(state, cx, "select", string.sub(event.item, #ITEM_PREFIX + 1))
			end
		end
	end,
	view = function(state, cx)
		local snapshot = state.snapshot
		local narrow = cx.cols < 100
		local cards = if snapshot then snapshot.cards else {}
		local count = { finding = 0, option = 0, question = 0, evidence = 0 }
		for _, card in cards do count[card.kind] = (count[card.kind] or 0) + 1 end
		local main = {
			with(ui.card({ ui.span(if snapshot then snapshot.title else "Return Room", "strong") }, {
				text("An agent leaves work. You compare, decide, and return a saved reply.", "muted", "purpose"),
				row({ ui.badge(tostring(count.finding) .. " findings", "info"), ui.badge(tostring(count.option) .. " options", "accent"),
					ui.badge(tostring(count.question) .. " questions", "warning"), ui.badge(tostring(count.evidence) .. " evidence", "neutral") }, "counts"),
				text(if snapshot then "Scratch outline: " .. snapshot.outline .. " · agent cards / user feedback" else "Connecting to the dedicated scratch outline…", "muted", "scope"),
			}), { key = "header", tone = "accent", role = "return-room.header" }),
		}
		if state.syncError then table.insert(main, with(ui.card("Refresh failed · last good room retained", { text(state.syncError, "error", "message"), button("r Retry refresh", "refresh", "accent") }), { key = "sync-error", tone = "error" })) end
		if state.actionError then table.insert(main, with(ui.card("Action needs attention", { text(state.actionError, "error", "message"), button("Dismiss message", "dismiss", "muted") }), { key = "action-error", tone = "error" })) end
		if state.notice then table.insert(main, with(ui.card("Receipt", { text(state.notice, nil, "message"), button("Dismiss receipt", "dismiss", "muted") }), { key = "receipt", tone = "success" })) end
		if snapshot and not snapshot.complete then table.insert(main, text("Incomplete snapshot: some source notes may be missing. Pins are retained; refresh before concluding the room is complete.", "warning", "incomplete")) end
		local items = {}
		for _, card in cards do
			local latest = state.latest[card.id]
			table.insert(items, ui.node("item", {
				key = card.id, label = card.title, detail = card.kind .. " · r" .. tostring(card.revision),
				value = (if table.find(state.pins, card.id) then "PIN · " else "") .. (if latest then latest.verdict .. " r" .. tostring(latest.revision) else "unanswered"),
				tone = tones[card.kind] or "neutral", role = "return-room.item",
			}))
		end
		local overview = with(ui.col({
			row({ text("RETURNS", "strong", "label"), button("k Previous", "previous", "neutral"), button("j Next", "next", "neutral") }, "heading"),
			ui.node("list", { key = "cards", role = "return-room.list", selected = ITEM_PREFIX .. state.selection,
				max = { lines = if narrow then 6 else math.max(8, math.min(24, cx.rows - 15)) },
				empty = { ui.span(if state.synced then "No cards yet. Publish from the configured omp session." else "Waiting for the scratch host…", "muted") },
			}, items),
		}), { key = "overview", grow = 1, basis = if narrow then nil else 0.34, role = "return-room.overview" })
		local current = selected(state)
		local detail = if current then cardView(state, current, "detail-" .. current.id, false)
			else with(ui.card("A place to return to", { text("Findings, alternatives, questions and evidence appear here without taking your selection or starting an agent turn.", "muted", "empty") }), { key = "empty-detail", grow = 1, basis = 0.66 })
		table.insert(main, with(if narrow then ui.col({ overview, detail }) else ui.row({ overview, detail }), { key = "workspace", align = "start", role = "return-room.workspace" }))
		local comparisons = {}
		for _, id in state.pins do
			local card = state.byId[id]
			if card then table.insert(comparisons, cardView(state, card, id, true))
			else table.insert(comparisons, text("Pinned card unavailable in this snapshot: " .. id, "warning", id)) end
		end
		if #comparisons > 0 then
			table.insert(main, with(ui.section("COMPARE · " .. tostring(#state.pins) .. "/2 pinned", {
				text("Pin two alternatives with c. Each decision stays attached to its card and displayed revision.", "muted", "help"),
				with(if narrow then ui.col(comparisons) else ui.row(comparisons), { key = "pair", align = "start" }),
			}), { key = "compare", role = "return-room.compare" }))
		end
		return {
			main = with(ui.col(main), { role = "return-room.main" }),
			dock = with(ui.col({
				row({ button("r Refresh", "refresh", "accent", "refresh"),
					ui.badge(if state.busy then state.busy .. "…" else (if state.syncError then "offline · cached" else "live · 3s poll"), if state.syncError then "error" elseif state.busy then "pending" else "success"),
					text(tostring(#cards) .. " cards · " .. tostring(#state.pins) .. " pinned", "muted", "counts") }, "status"),
				text("j/k select · c pin · 1 keep · 2 question · 3 park · o evidence · e edit reply · s send saved", "muted", "keys"),
			}), { role = "return-room.dock" }),
		}
	end,
})
