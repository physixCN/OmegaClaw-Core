(SkillTopic "web-search" "search")
(SkillTopic "web-search" "current-info")
(SkillCardLine "web-search" "web-search query - search current external information")
(Risk "web-search" "external-network")
(Effect "web-search" "external-information-observed")

(SkillTopic "web-search" "web-search")
(SkillTopic "search" "search")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "search")
(Skill "web-search")
(SkillArg "web-search" 1 "rest-text" "query")
(SkillArg "search" 1 "rest-text" "query")
(SkillCardLine "search" "search query - alias for web-search; use for current external information, not internal memory")
