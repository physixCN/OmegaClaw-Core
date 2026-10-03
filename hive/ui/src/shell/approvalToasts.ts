import { useEffect } from 'react'
import { navigate } from '../lib/router'
import { hiveBus, useHive } from '../store/store'

/** A new approval raises a toast that opens the inbox (unless the inbox is already open). */
export function useApprovalToasts(): void {
  useEffect(
    () =>
      hiveBus.on((e) => {
        if (e.type !== 'approval.created' || e.approval.status !== 'pending') return
        if (window.location.hash.startsWith('#/approvals')) return
        const s = useHive.getState()
        const a = s.agents[e.approval.agent_id]
        s.toast({
          tone: 'info',
          icon: 'shield',
          hue: a?.hue,
          title: `${a?.name ?? 'A dot'} asks to run ${e.approval.skill}`,
          body: e.approval.command,
          action: { label: 'Review', run: () => navigate({ name: 'approvals', focus: e.approval.id }) },
          ttl: 7000,
        })
      }),
    [],
  )
}
