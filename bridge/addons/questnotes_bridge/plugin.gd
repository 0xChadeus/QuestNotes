@tool
extends EditorPlugin
## QuestNotes bridge. Listens on 127.0.0.1 on a port the OS picks and writes {v, port, token, pid, project} to
## res://.godot/questnotes_bridge.json (.godot is never committed). A client opens ws://127.0.0.1:<port>/questnotes,
## sends {"op":"hello","token":...} within 5 s, then {"op":"open","id":n,"path":"res://resources/quests/<kind>/<id>.json",
## "stage":"<stage id>"?}. Anything else closes the connection. If QuestNotes had to start the editor, it passes
## `++ --questnotes-open=<res path>` and the quest opens once the editor has scanned the project.

const INFO := "res://.godot/questnotes_bridge.json"
const QUESTS := "res://resources/quests/"
const AUTH_MS := 5000

var _server := TCPServer.new()
var _peers: Array = []  # {ws: WebSocketPeer, authed: bool, born: int}
var _token := ""

func _enter_tree() -> void:
	var err := _server.listen(0, "127.0.0.1")
	if err != OK:
		push_warning("QuestNotes bridge: cannot listen on 127.0.0.1 (%s)" % error_string(err))
		return
	_token = Crypto.new().generate_random_bytes(24).hex_encode()
	var f := FileAccess.open(INFO, FileAccess.WRITE)
	f.store_string(JSON.stringify({"v": 1, "port": _server.get_local_port(), "token": _token,
			"pid": OS.get_process_id(), "project": ProjectSettings.globalize_path("res://")}))
	f.close()
	print("QuestNotes bridge listening on 127.0.0.1:%d" % _server.get_local_port())
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--questnotes-open="):
			var at := a.trim_prefix("--questnotes-open=").split("#")
			var fs := EditorInterface.get_resource_filesystem()
			await get_tree().process_frame  # let the main screens finish entering the tree
			while fs.is_scanning():
				await fs.filesystem_changed
			print("startup open: ", _open(at[0], at[1] if at.size() > 1 else ""))

func _exit_tree() -> void:
	for p in _peers:
		p.ws.close()
	_peers.clear()
	_server.stop()
	if FileAccess.file_exists(INFO):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(INFO))

func _process(_delta: float) -> void:
	while _server.is_connection_available():
		var ws := WebSocketPeer.new()
		if ws.accept_stream(_server.take_connection()) == OK:
			_peers.append({"ws": ws, "authed": false, "born": Time.get_ticks_msec()})
	for p in _peers.duplicate():
		var ws: WebSocketPeer = p.ws
		ws.poll()
		if ws.get_ready_state() == WebSocketPeer.STATE_CLOSED:
			_peers.erase(p)
			continue
		if not p.authed and Time.get_ticks_msec() - p.born > AUTH_MS:
			ws.close(4001, "auth timeout")
			continue
		while ws.get_available_packet_count() > 0:
			var msg: Variant = JSON.parse_string(ws.get_packet().get_string_from_utf8())
			if not msg is Dictionary:
				ws.close(4000, "bad message")
				break
			if not p.authed:
				if msg.get("op") == "hello" and msg.get("token") == _token and ws.get_requested_url().ends_with("/questnotes"):
					p.authed = true
					_send(ws, {"op": "hello", "ok": true, "godot": Engine.get_version_info().string,
							"project": ProjectSettings.globalize_path("res://")})
				else:
					ws.close(4003, "unauthorized")
					break
			elif msg.get("op") == "open":
				var error := _open(str(msg.get("path", "")), str(msg.get("stage", "")))
				_send(ws, {"op": "open", "id": msg.get("id"), "ok": error == "", "error": error})
			elif msg.get("op") == "ping":
				_send(ws, {"op": "pong", "id": msg.get("id")})
			else:
				_send(ws, {"op": msg.get("op"), "id": msg.get("id"), "ok": false, "error": "unknown_op"})

func _send(ws: WebSocketPeer, d: Dictionary) -> void:
	d["v"] = 1
	ws.send_text(JSON.stringify(d))

## "" on success, else an error code QuestNotes shows to the designer.
func _open(path: String, stage: String) -> String:
	if not path.begins_with(QUESTS) or not path.ends_with(".json") or path.contains(".."):
		return "bad_path"
	if not FileAccess.file_exists(path):
		return "not_found"
	EditorInterface.set_main_screen_editor("Animus")
	EditorInterface.edit_resource(load(path))
	if stage != "":
		_select_stage(path, stage)
	DisplayServer.window_request_attention()
	DisplayServer.window_move_to_foreground()
	return ""

## Selects the stage in the Animus Quests tab (found by its node name, plugin.gd names its tabs), by index as
## quests_editor.gd select(["stages", i]) expects. Silently does nothing if Animus changes shape: the quest is open anyway.
func _select_stage(path: String, stage: String) -> void:
	var q: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	var i := -1
	if q is Dictionary and q.get("stages") is Array:
		for k in q.stages.size():
			if q.stages[k] is Dictionary and q.stages[k].get("id") == stage:
				i = k
	for c in EditorInterface.get_editor_main_screen().get_children():
		if c is TabContainer and c.has_node("Quests") and c.get_node("Quests").has_method("select") and i >= 0:
			c.get_node("Quests").select(["stages", i])
