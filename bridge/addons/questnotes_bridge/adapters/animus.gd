@tool
extends RefCounted
## QuestNotes Bridge adapter for Animus: opens a quest file on the Animus main screen and selects a stage in its Quests
## tab (found by node name, as Animus's plugin.gd names its tabs), by index as its quests_editor.gd select(["stages", i])
## expects. If Animus changes shape the stage is simply not selected; the quest is open anyway.

const QUESTS := "res://resources/quests/"

static func open(path: String, stage: String) -> String:
	if not path.begins_with(QUESTS) or not path.ends_with(".json"):
		return "bad_path"
	EditorInterface.set_main_screen_editor("Animus")
	EditorInterface.edit_resource(load(path))
	if stage == "":
		return ""
	var q: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	var i := -1
	if q is Dictionary and q.get("stages") is Array:
		for k in q.stages.size():
			if q.stages[k] is Dictionary and q.stages[k].get("id") == stage:
				i = k
	for c in EditorInterface.get_editor_main_screen().get_children():
		if c is TabContainer and c.has_node("Quests") and c.get_node("Quests").has_method("select") and i >= 0:
			c.get_node("Quests").select(["stages", i])
	return ""
