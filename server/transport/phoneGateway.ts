// Text through the approving counselor's own iPhone. Implements Transport, and
// like every transport is called by the dispatcher only, after the allowlist
// check.
//
// It sends nothing itself. It makes one job for the phone of the counselor who
// approved the row (the outbox row's approved_by), holding the exact recipient
// and the exact final text the dispatcher built, then asks for the phone to be
// woken. The phone's Shortcut claims the job from /api/phone, sends it with
// Messages, and reports back. Until then the outbox row stays "sending", so
// the dispatcher never picks it up again.
//
// Every failure is thrown as a short, plain sentence, which the dispatcher
// records on the row together with `deliveryDetail`, so the Messages screen can
// offer "Open in Messages" instead. A key, a number or message text is never
// put in an error or a log.

import { randomUUID } from 'node:crypto'
import { normalizePhone } from '../../shared/dispatch.js'
import { HAND_SENT_NOTE, PHONE_REASON, type DeliveryDetail } from '../../shared/phoneGateway.js'
import { gmailOf, onAllowlist } from '../phoneGateway/config.js'
import { createJob, deviceHasStopped } from '../phoneGateway/jobs.js'
import { wakeDevice } from '../phoneGateway/wake.js'
import { serviceClient } from '../supabase.js'
import type { Transport, TransportResult, TransportSend } from './types.js'

/** A text that will not go to the phone, with what the outbox row should say about it. */
export class PhoneGatewayRefusal extends Error {
  deliveryDetail: DeliveryDetail
  constructor(message: string, detail: DeliveryDetail = 'phone_none') {
    super(message)
    this.deliveryDetail = detail
  }
}

export class PhoneGatewayTransport implements Transport {
  async send(input: TransportSend): Promise<TransportResult> {
    if (input.channel !== 'text') throw new Error('The phone sends texts only')
    // The counselor already sent this one from their own phone ("Open in Messages" or Copy).
    // The row is the record of that; handing it to the phone would send it twice.
    if (input.note === HAND_SENT_NOTE) return { providerMessageId: `hand_${randomUUID()}` }
    if (!input.outboxId) throw new Error('The phone needs the message it is sending')
    if (!input.senderUserId) throw new PhoneGatewayRefusal(PHONE_REASON.noCounselor)
    const toPhone = normalizePhone(input.to)
    if (!toPhone || !/^\+[0-9]{7,15}$/.test(toPhone)) throw new Error('not a valid phone number')

    const db = serviceClient()
    const member = await db.from('firm_members').select('firm_id').eq('user_id', input.senderUserId).maybeSingle()
    if (member.error) throw new Error('could not read the counselor')
    // Someone who is no longer in a firm sends nothing.
    if (!member.data) throw new PhoneGatewayRefusal(PHONE_REASON.noCounselor)
    const who = { userId: input.senderUserId, firmId: member.data.firm_id }

    const found = await db.from('phone_devices').select('*').eq('counselor_id', who.userId).eq('firm_id', who.firmId).is('revoked_at', null).maybeSingle()
    if (found.error) throw new Error('could not read the phone')
    const device = found.data
    if (!device) throw new PhoneGatewayRefusal(PHONE_REASON.noDevice)
    if (await deviceHasStopped(device.id)) throw new PhoneGatewayRefusal(PHONE_REASON.stopped)
    // Without Gmail the phone cannot be woken, so no job is made.
    if (!(await gmailOf(who)).connected) throw new PhoneGatewayRefusal(PHONE_REASON.noGmail)
    if (!onAllowlist('email', device.wake_email)) throw new PhoneGatewayRefusal(PHONE_REASON.wakeNotAllowed)

    const made = await createJob({ outboxId: input.outboxId, deviceId: device.id, toPhone, body: input.body }, { actor: 'dispatcher' })
    if ('conflict' in made) {
      // This row already has its one job. Nothing new is made and no wake is sent.
      const existing = await db.from('phone_send_jobs').select('id, status').eq('outbox_id', input.outboxId).maybeSingle()
      if (existing.data && (existing.data.status === 'pending' || existing.data.status === 'claimed')) return { providerMessageId: `phone_${existing.data.id}`, waiting: true }
      throw new Error(PHONE_REASON.alreadyHanded)
    }
    // A wake that fails does not fail the job: the phone may still ask, and if it does not the job expires.
    await wakeDevice(device, who)
    return { providerMessageId: `phone_${made.job.id}`, waiting: true }
  }
}
