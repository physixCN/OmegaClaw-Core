(SkillTopic "send-web-control" "channels")
(SkillCardLine "send-web-control" "send-web-control message - send explicitly to the agent OS web chat")
(Risk "send-web-control" "external-send")
(Effect "send-web-control" "external-message-sent")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "send-web-control")
(SkillArg "send-web-control" 1 "rest-text" "message")
(Skill "send-web-control-base64")
(SkillTopic "send-web-control-base64" "channels")
(SkillArg "send-web-control-base64" 1 "base64-utf8" "payload")
(SkillCardLine "send-web-control-base64" "send-web-control-base64 payload - channels skill; inspect this card before use when syntax or purpose is uncertain")
