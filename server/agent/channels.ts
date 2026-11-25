// Which channels can actually leave the firm. Read from the same settings the
// dispatcher uses. WeChat never sends. LINE has no transport, so a LINE id on
// the parent does not make it sendable. Email sends when Gmail is the transport
// and this counselor is connected. Text sends when the phone gateway is the
// transport and a device is connected. The log transport counts only when
// ALLOW_LOG_TRANSPORT=true, which is for development.

import { activeDevice, gmailOf, textViaPhone } from '../phoneGateway/config.js'

export type SendChannel = 'email' | 'text' | 'line' | 'wechat'

export type ChannelState = { channel: SendChannel; sendable: boolean; why: string }

type Person = { email?: string | null; phone?: string | null; lineId?: string | null }

type Caps = { email: { ok: boolean; why: string }; text: { ok: boolean; why: string } }

const gmailTransport = () => (process.env.TRANSPORT_EMAIL || '').trim().toLowerCase() === 'gmail'

/** Development only. Empty or anything but true means the log transport cannot send. */
export const logTransportAllowed = () => (process.env.ALLOW_LOG_TRANSPORT || '').trim().toLowerCase() === 'true'

/** Firm-wide: can this counselor's configured transports carry email and text. */
export async function transportCaps(firmId: string, counselorId: string): Promise<Caps> {
  const email = gmailTransport()
    ? await gmailCap(firmId, counselorId)
    : logTransportAllowed()
      ? { ok: true, why: 'Email uses the log transport' }
      : { ok: false, why: 'Gmail is not connected' }
  return { email, text: await textCap(firmId, counselorId) }
}

async function gmailCap(firmId: string, counselorId: string): Promise<{ ok: boolean; why: string }> {
  const gmail = await gmailOf({ userId: counselorId, firmId })
  return gmail.connected ? { ok: true, why: 'Gmail is connected' } : { ok: false, why: 'Gmail is not connected' }
}

async function textCap(firmId: string, counselorId: string): Promise<{ ok: boolean; why: string }> {
  if (textViaPhone()) {
    const device = await activeDevice({ userId: counselorId, firmId })
    return device ? { ok: true, why: 'Your phone is connected' } : { ok: false, why: 'The phone gateway is not connected' }
  }
  return logTransportAllowed()
    ? { ok: true, why: 'Text uses the log transport' }
    : { ok: false, why: 'The phone gateway is not connected' }
}

/**
 * A channel the message can actually use. A requested channel wins when it can
 * send. Otherwise the preferred channel, then the first that can. Fails only
 * when nothing can send, so a blocked name does not force another model round.
 */
export function pickSendable(
  states: ChannelState[],
  preferred: string | undefined,
  requested: string | undefined,
): { channel: SendChannel } | { error: string } {
  const sendable = states.filter((state) => state.sendable)
  const named = requested ? sendable.find((state) => state.channel === requested) : undefined
  if (named) return { channel: named.channel }
  const pref = preferred ? sendable.find((state) => state.channel === preferred) : undefined
  if (pref) return { channel: pref.channel }
  if (sendable[0]) return { channel: sendable[0].channel }
  return {
    error: `No sendable channel. ${states.map((state) => `${state.channel}: ${state.why}`).join('; ')}. Tell the counselor and do not propose.`,
  }
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
