(SkillTopic "generate-image" "media")
(SkillCardLine "generate-image" "generate-image prompt - create an image asset")
(Effect "generate-image" "media-created")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "generate-image")
(SkillArg "generate-image" 1 "rest-text" "prompt")
(Skill "generate-image-quality")
(SkillTopic "generate-image-quality" "media")
(SkillArg "generate-image-quality" 1 "rest-text" "prompt")
(SkillCardLine "generate-image-quality" "generate-image-quality prompt - media skill; inspect this card before use when syntax or purpose is uncertain")
