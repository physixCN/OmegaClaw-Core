(= (WA_TARGET_JID) (empty))
(= (WA_PORT) (empty))
(= (WA_PREFIX) (empty))
(= (WA_PRIMARY_JID) (empty))
(= (send-whatsapp $msg)
   (if (!= $msg (get-state &lastsend))
       (progn (change-state! &lastsend $msg)
              (let $safemsg (string-replace $msg "
" "\n")
                   (py-call (router.send_whatsapp_primary $safemsg)))) _))

(= (send-whatsapp-base64 $payload)
   (py-call (router.send_whatsapp_primary_base64 $payload)))


(= (send-primary-operator $msg)
   (let $safemsg (string-replace $msg "
" "\n")
        (py-call (router.send_primary_operator $safemsg))))

(= (send-primary-operator-base64 $payload)
   (py-call (router.send_primary_operator_base64 $payload)))

(= (send-whatsapp-mention $phone $msg)
   (let $safemsg (string-replace $msg "
" "\n")
        (py-call (router.send_whatsapp_mention $phone $safemsg))))

(= (send-whatsapp-mention-to $jid $phone $msg)
   (let $safemsg (string-replace $msg "
" "\n")
        (py-call (router.send_chat_mention $jid $phone $safemsg))))


(= (send-whatsapp-file $path)
   (py-call (router.send_whatsapp_primary_file $path)))

(= (send-whatsapp-file-caption $path $caption)
   (py-call (router.send_whatsapp_primary_file $path $caption)))

(= (send-whatsapp-file-to $jid $path)
   (py-call (router.send_chat_file $jid $path)))

(= (send-whatsapp-file-caption-to $jid $path $caption)
   (py-call (router.send_chat_file $jid $path $caption)))

(= (reply-whatsapp-file-to $jid $path)
   (py-call (router.reply_chat_file $jid $path)))

(= (reply-whatsapp-file-caption-to $jid $path $caption)
   (py-call (router.reply_chat_file $jid $path $caption)))


(= (whatsapp-chats)
   (py-call (whatsapp.list_chats)))

(= (whatsapp-inbox)
   (py-call (whatsapp.inbox)))

(= (read-whatsapp-chat $jid)
   (py-call (whatsapp.read_chat $jid)))

(= (read-whatsapp-chat-recent $jid)
   (read-whatsapp-chat $jid))

(= (read-whatsapp-chat-full $jid)
   (py-call (whatsapp.read_chat_full $jid)))

(= (mark-whatsapp-read $jid)
   (py-call (whatsapp.mark_read $jid)))

(= (mark-whatsapp-unread $jid)
   (py-call (whatsapp.mark_unread $jid)))

(= (set-whatsapp-primary $jid)
   (py-call (whatsapp.set_primary $jid)))

(= (send-whatsapp-to $jid $msg)
   (py-call (whatsapp.send_to_chat $jid $msg)))

(= (send-whatsapp-to-base64 $jid $payload)
   (py-call (router.send_chat_base64 $jid $payload)))

(= (reply-whatsapp-to $jid $msg)
   (py-call (whatsapp.reply_to_chat $jid $msg)))

(= (reply-whatsapp-to-base64 $jid $payload)
   (py-call (router.reply_chat_base64 $jid $payload)))

(= (reply-whatsapp-to-message $jid $message_id $msg)
   (py-call (whatsapp.reply_to_message $jid $message_id $msg)))

(= (reply-whatsapp-to-message-base64 $jid $message_id $payload)
   (py-call (router.reply_to_message_base64 $jid $message_id $payload)))

(= (react-whatsapp-message $jid $message_id $emoji)
   (py-call (whatsapp.react_message $jid $message_id $emoji)))

(= (unreact-whatsapp-message $jid $message_id)
   (py-call (whatsapp.unreact_message $jid $message_id)))

(= (edit-whatsapp-message $message_id $msg)
   (py-call (whatsapp.edit_message $message_id $msg)))

(= (edit-whatsapp-message-base64 $message_id $payload)
   (py-call (router.edit_message_base64 $message_id $payload)))

(= (delete-whatsapp-message $message_id)
   (py-call (whatsapp.delete_message $message_id)))

(= (whatsapp-status)
   (py-call (whatsapp.status)))
