; Symbolic observation routes for the sense router.
;
; Python reads these atoms as routing configuration. The route meanings stay in
; MeTTa-visible module state; Python only normalizes input, dispatches the
; chosen membrane function, and fails closed when no route matches.

(ObservationExactRoute "gameboy" "gameboy" "gb_observe")
(ObservationExactRoute "game boy" "gameboy" "gb_observe")
(ObservationExactRoute "gb" "gameboy" "gb_observe")
(ObservationExactRoute "emulator" "gameboy" "gb_observe")
(ObservationExactRoute "game" "gameboy" "gb_observe")

(ObservationExactRoute "house" "home_assistant" "observe_house")
(ObservationExactRoute "home" "home_assistant" "observe_house")
(ObservationExactRoute "home assistant" "home_assistant" "observe_house")
(ObservationExactRoute "ha" "home_assistant" "observe_house")
(ObservationExactRoute "house full" "home_assistant" "observe_house_full")
(ObservationExactRoute "full house" "home_assistant" "observe_house_full")
(ObservationExactRoute "home full" "home_assistant" "observe_house_full")
(ObservationExactRoute "full home" "home_assistant" "observe_house_full")
(ObservationExactRoute "devices" "home_assistant" "observe_house_full")
(ObservationExactRoute "all devices" "home_assistant" "observe_house_full")
(ObservationExactRoute "house affordances" "home_assistant" "observe_house_affordances")
(ObservationExactRoute "home affordances" "home_assistant" "observe_house_affordances")
(ObservationExactRoute "affordances" "home_assistant" "observe_house_affordances")
(ObservationExactRoute "house skills" "home_assistant" "observe_house_affordances")
(ObservationExactRoute "home skills" "home_assistant" "observe_house_affordances")

(ObservationPrefixRoute "room" "home_assistant" "observe_room")
(ObservationPrefixRoute "area" "home_assistant" "observe_room")
(ObservationPrefixRoute "device" "home_assistant" "observe_device")
(ObservationPrefixRoute "entity" "home_assistant" "observe_device")

(ObservationPrefixRoute "glucose" "glucose" "observe_glucose")
(ObservationPrefixRoute "blood sugar" "glucose" "observe_glucose")
(ObservationPrefixRoute "libre" "glucose" "observe_glucose")

(ObservationExactRoute "whatsapp" "whatsapp" "inbox")
(ObservationExactRoute "wa" "whatsapp" "inbox")
(ObservationExactRoute "inbox" "whatsapp" "inbox")
(ObservationExactRoute "messages" "whatsapp" "inbox")
(ObservationExactRoute "chats" "whatsapp" "inbox")

(ObservationQuestionRoute "webcam" "webcam" "inspect_webcam" "What is visible right now? Describe only what the camera can actually see.")
(ObservationQuestionRoute "camera" "webcam" "inspect_webcam" "What is visible right now? Describe only what the camera can actually see.")
(ObservationQuestionRoute "sight" "webcam" "inspect_webcam" "What is visible right now? Describe only what the camera can actually see.")
(ObservationQuestionRoute "vision" "webcam" "inspect_webcam" "What is visible right now? Describe only what the camera can actually see.")
(ObservationQuestionRoute "room camera" "webcam" "inspect_webcam" "What is visible right now? Describe only what the camera can actually see.")

(ObservationPrefixRoute "image" "vision" "observe_image")
(ObservationPrefixRoute "audio" "audio" "observe_audio")
(ObservationPrefixRoute "sound" "audio" "observe_audio")

(ObservationUnknownExample "observe gameboy")
(ObservationUnknownExample "observe house")
(ObservationUnknownExample "observe house full")
(ObservationUnknownExample "observe room Kitchen")
(ObservationUnknownExample "observe device light.kitchen")
(ObservationUnknownExample "observe glucose Patient")
(ObservationUnknownExample "observe whatsapp")
(ObservationUnknownExample "observe webcam")
(ObservationUnknownExample "observe image IMAGE_ID")
(ObservationUnknownExample "observe audio AUDIO_ID")
