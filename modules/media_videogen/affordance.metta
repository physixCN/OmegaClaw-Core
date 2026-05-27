(SkillTopic "generate-video" "media")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "generate-video")
(SkillArg "generate-video" 1 "rest-text" "prompt")
(SkillCardLine "generate-video" "generate-video prompt - media skill; inspect this card before use when syntax or purpose is uncertain")
(Skill "video-config-status")
(SkillTopic "video-config-status" "media")
(SkillArg "video-config-status" 0 "none" "none")
(SkillCardLine "video-config-status" "video-config-status - media skill; inspect this card before use when syntax or purpose is uncertain")
