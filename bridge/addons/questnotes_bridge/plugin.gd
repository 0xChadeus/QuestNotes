@tool
extends EditorPlugin
## QuestNotes bridge. Listens on 127.0.0.1 on a port the OS picks and writes {v, port, token, pid, project} to
## res://.godot/questnotes_bridge.json (.godot is never committed). A client opens ws://127.0.0.1:<port>/questnotes,
## sends {"op":"hello","token":...} within 5 s, then {"op":"open","id":n,"path":"res://...","stage":"<stage id>"?,
## "adapter":"<name>"?}. Anything else closes the connection. If QuestNotes had to start the editor, it passes
## `++ --questnotes-open=<res path>#<stage> --questnotes-adapter=<name>` and the quest opens once the project is scanned.
##
## Without an adapter a quest file opens in the inspector and the FileSystem dock. An adapter is a script in adapters/
## with `static func open(path: String, stage: String) -> String` (returns "" or an error code), for quest systems
## that have their own editor screen.

const INFO := "res://.godot/questnotes_bridge.json"
const ADAPTERS := "res://addons/questnotes_bridge/adapters/"
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
	var target := ""
	var adapter := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--questnotes-open="):
			target = a.trim_prefix("--questnotes-open=")
		elif a.begins_with("--questnotes-adapter="):
			adapter = a.trim_prefix("--questnotes-adapter=")
	if target != "":
		var at := target.split("#")
		var fs := EditorInterface.get_resource_filesystem()
		await get_tree().process_frame  # let the main screens finish entering the tree
		while fs.is_scanning():
			await fs.filesystem_changed
		print("startup open: ", _open(at[0], at[1] if at.size() > 1 else "", adapter))

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
				var error := _open(str(msg.get("path", "")), str(msg.get("stage", "")), str(msg.get("adapter", "")))
				_send(ws, {"op": "open", "id": msg.get("id"), "ok": error == "", "error": error})
			elif msg.get("op") == "ping":
				_send(ws, {"op": "pong", "id": msg.get("id")})
			else:
				_send(ws, {"op": msg.get("op"), "id": msg.get("id"), "ok": false, "error": "unknown_op"})

func _send(ws: WebSocketPeer, d: Dictionary) -> void:
	d["v"] = 1
	ws.send_text(JSON.stringify(d))

## "" on success, else an error code QuestNotes shows to the designer.
func _open(path: String, stage: String, adapter: String) -> String:
	if not path.begins_with("res://") or path.contains("..") or path.begins_with("res://.godot/"):
		return "bad_path"
	if not FileAccess.file_exists(path):
		return "not_found"
	var error := ""
	if adapter == "":
		EditorInterface.select_file(path)
		if ResourceLoader.exists(path):
			EditorInterface.edit_resource(load(path))
	else:
		var script := ADAPTERS + adapter + ".gd"
		if not RegEx.create_from_string("^[a-z0-9_]+$").search(adapter) or not FileAccess.file_exists(script):
			return "bad_adapter"
		error = str(load(script).open(path, stage))
	if error == "":
		DisplayServer.window_request_attention()
		DisplayServer.window_move_to_foreground()
	return error
