import { appConfig } from './config'

// Transactional email (invites, password resets) through Resend's HTTP API.
// Without RESEND_API_KEY + MAIL_FROM the message is written to the server log,
// so a self-hosted install still works (the operator can pass the link on).

export type Mail = { to: string; subject: string; text: string }

const OUTBOX_SIZE = 50
const outbox: Mail[] = []

/** Messages that were logged instead of sent (newest last); tests read links from here. */
export function mailOutbox(): readonly Mail[] {
  return outbox
}

export function clearMailOutbox(): void {
  outbox.length = 0
}

export async function sendMail(mail: Mail): Promise<'sent' | 'logged' | 'failed'> {
  const config = appConfig().mail
  if (!config) {
    outbox.push(mail)
    if (outbox.length > OUTBOX_SIZE) outbox.shift()
    if (!process.env.VITEST) console.info(`[flowpilot] email not sent (no RESEND_API_KEY); to ${mail.to}: ${mail.subject}\n${mail.text}`)
    return 'logged'
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) return 'sent'
    console.error(`[flowpilot] email to ${mail.to} failed: HTTP ${res.status}`)
  } catch (err) {
    console.error(`[flowpilot] email to ${mail.to} failed:`, (err as Error).message)
  }
  return 'failed'
}
