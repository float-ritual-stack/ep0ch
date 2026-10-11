-- Opens only this plugin's block; no routes, global key binds or config edits.
tern.command({
	id = "open",
	title = "Open Return Room",
	icon = "box",
	run = function(cx)
		local config = tern.getenv("RETURN_ROOM_CONFIG")
		local args = if config and config ~= "" then { config } else {}
		local pane = cx:new_block("return-room.room", args, "beside")
		if not pane then
			cx:toast("error", "Return Room is not available on this host", "Load the return-room plugin in the dedicated scratch Tern session, then run Open Return Room again.")
		end
	end,
})
