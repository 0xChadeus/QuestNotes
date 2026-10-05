@tool
extends EditorPlugin
## The parts of animus/editor/plugin.gd the bridge relies on: _handles/_edit and a "Quests" tab with open_file and select.
## Logs what it is asked to open, for tests/bridge.test.ts.

var opened: Array = []
var _tabs: TabContainer

class MockQuests extends Control:
	var path := ""
	var plugin
	func open_file(p: String) -> void:
		path = p
	func select(sel: Array) -> void:
		plugin._log("select %s in %s" % [sel, path])

func _enter_tree() -> void:
	_tabs = TabContainer.new()
	for n in ["Population", "Quests", "Storylets"]:
		var c: Control = MockQuests.new() if n == "Quests" else Control.new()
		c.name = n
		if n == "Quests":
			c.plugin = self
		_tabs.add_child(c)
	EditorInterface.get_editor_main_screen().add_child(_tabs)

func _exit_tree() -> void:
	_tabs.queue_free()

func _has_main_screen() -> bool:
	return true

func _get_plugin_name() -> String:
	return "Animus"

func _make_visible(_v: bool) -> void:
	pass

func _handles(object: Object) -> bool:
	return object is JSON and object.resource_path.begins_with("res://resources/quests/")

func _edit(object: Object) -> void:
	if object is JSON:
		_log("edit " + object.resource_path)
		_tabs.current_tab = 1
		_tabs.get_child(1).open_file(object.resource_path)

func _log(s: String) -> void:
	opened.append(s)
	var f := FileAccess.open("res://.godot/mock_animus_log.txt", FileAccess.READ_WRITE if FileAccess.file_exists("res://.godot/mock_animus_log.txt") else FileAccess.WRITE)
	f.seek_end()
	f.store_line(s)
	f.close()
