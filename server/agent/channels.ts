// Which channels can actually leave the firm. Read from the same settings the
// dispatcher uses. WeChat never sends. LINE has no transport, so a LINE id on
// the parent does not make it sendable. Email and text follow the configured
// transport: Gmail only when that is the email transport and this counselor is
// connected, the phone gateway only when text is set to the phone and a device
// is connected, and otherwise the log transport, which accepts the channel.

import { activeDevice, gmailOf, textViaPhone } from '../phoneGateway/config.js'

export type SendChannel = 'email' | 'text' | 'line' | 'wechat'

export type ChannelState = { channel: SendChannel; sendable: boolean; why: string }

type Person = { email?: string | null; phone?: string | null; lineId?: string | null }

type Caps = { email: { ok: boolean; why: string }; text: { ok: boolean; why: string } }

const gmailTransport = () => (process.env.TRANSPORT_EMAIL || '').trim().toLowerCase() === 'gmail'

/** Firm-wide: can this counselor's configured transports carry email and text. */
export async function transportCaps(firmId: string, counselorId: string): Promise<Caps> {
  if (gmailTransport()) {
    const gmail = await gmailOf({ userId: counselorId, firmId })
    const email = gmail.connected
      ? { ok: true, why: 'Gmail is connected' }
      : { ok: false, why: 'Gmail is not connected for you' }
    return { email, text: await textCap(firmId, counselorId) }
  }
  return {
    email: { ok: true, why: 'Email uses the log transport' },
    text: await textCap(firmId, counselorId),
  }
}

async function textCap(firmId: string, counselorId: string): Promise<{ ok: boolean; why: string }> {
  if (!textViaPhone()) return { ok: true, why: 'Text uses the log transport' }
  const device = await activeDevice({ userId: counselorId, firmId })
  return device ? { ok: true, why: 'Your phone is connected' } : { ok: false, why: 'Your phone is not connected' }
}

/** Per person: a transport that works still needs an address on the record. */
export function channelsFor(person: Person, caps: Caps): ChannelState[] {
  const email = person.email?.trim()
    ? caps.email
    : { ok: false, why: caps.email.ok ? 'No email address on this person' : caps.email.why }
  const text = person.phone?.trim()
    ? caps.text
    : { ok: false, why: caps.text.ok ? 'No phone number on this person' : caps.text.why }
  return [
    { channel: 'email', sendable: email.ok, why: email.why },
    { channel: 'text', sendable: text.ok, why: text.why },
    { channel: 'line', sendable: false, why: person.lineId?.trim() ? 'LINE has no sending transport' : 'LINE is not connected' },
    { channel: 'wechat', sendable: false, why: 'WeChat is not connected' },
  ]
}

export function sendableNames(states: ChannelState[]): string[] {
  return states.filter((state) => state.sendable).map((state) => state.channel)
}
