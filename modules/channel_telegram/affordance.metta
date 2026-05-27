(SkillTopic "send-telegram" "channels")
(SkillTopic "send-telegram" "telegram")
(SkillCardLine "send-telegram" "send-telegram message - send to configured Telegram control chat")
(Risk "send-telegram" "external-send")
(Effect "send-telegram" "external-message-sent")

; Skill-card hygiene: every callable signature has a visible card and argument shape.
(Skill "send-telegram")
(SkillArg "send-telegram" 1 "rest-text" "message")
(Skill "send-telegram-base64")
(SkillTopic "send-telegram-base64" "channels")
(SkillArg "send-telegram-base64" 1 "base64-utf8" "payload")
(SkillCardLine "send-telegram-base64" "send-telegram-base64 payload - channels skill; inspect this card before use when syntax or purpose is uncertain")
