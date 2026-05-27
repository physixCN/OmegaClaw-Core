(SkillTopic "observe" "observe")
(SkillCardLine "observe" "observe target - route to the appropriate sense/app without acting")
(SituationFeature "need-perception" "unknown-environment-state")
(PreferredWhen "observe" "unknown-environment-state" 0.90 "sense through the relevant app before guessing")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "observe")
(SkillArg "observe" 1 "rest-text" "target")
